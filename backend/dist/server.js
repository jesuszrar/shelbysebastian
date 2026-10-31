import express from "express";
import cors from "cors";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { resolvePreferredPaymentMethod } from "./lib/mercadopago.js";
import { isAllowedCorsOrigin } from "./lib/cors.js";
import { calculateOrderPricing, hasSameOrderLines } from "./lib/order-pricing.js";
import { decrementOrderInventory } from "./lib/order-inventory.js";
import { buildMercadoPagoPreferencePayload } from "./lib/mercadopagoPreference.js";
import { isAdminUserRecord } from "./lib/auth.js";
import { canLookupCedulaEmail, canManagePrivateData, canSyncProfile, hasAdminRoleMutation, resolveDataReadAccess } from "./lib/access-control.js";
import { buildWompiAuthorizationHeader, extractWompiMerchantMethods, getWompiConfig, getWompiPaymentConfigError, isWompiPaymentSimulationEnabled, isWompiPublicEnvironment, mapWompiStatusToOrderStatus, normalizePhoneNumber, normalizeWompiPaymentMethod, verifyWompiEventSignature } from "./lib/wompi.js";
import { markWompiAttemptSending, markWompiAttemptUncertain, persistWompiWebhookReceipt, recordWompiAttemptLink, reserveWompiPaymentAttempt } from "./lib/wompi-persistence.js";
import { wrap } from "./lib/serialize.js";
import { createLegacyVariantUnlessExcluded, deleteProductsWithExclusions } from "./lib/product-exclusions.js";
import { lockProductCatalogIds } from "./lib/productCatalogLock.js";
import { deleteOmittedProductVariants, findStockSnapshotConflict, readProductWithCatalogRelations, readProductsWithCatalogRelations, removeExcludedProductVariants, replaceProductImagesIfChanged, replaceVariantImagesIfChanged, resolveAdminStock, resolveProductPatchTarget, resolveProductVariants, resolveVariantImageUrls, validateProductPatch, withProductCatalogBatchTransaction } from "./lib/product-variant-persistence.js";
import cookieParser from "cookie-parser";
import { products as staticProducts } from "./scripts/product-catalog-data.js";
import { buildCatalogSyncPlan } from "./scripts/catalog-sync-plan.js";
import { syncProductCatalog } from "./scripts/sync-product-catalog.js";
export const createApp = (dependencies) => {
    const { prisma, jwtSecret } = dependencies;
    if (!jwtSecret.trim())
        throw new Error("JWT_SECRET must be configured before starting the backend");
    const niimbotPageImageStore = prisma.niimbotPageImage;
    const app = express();
    const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "uploads");
    const assetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "assets");
    const NIIMBOT_PAGE_IMAGE_KEYS = new Set([
        "hero_desktop",
        "hero_mobile",
        "hardware_b1",
        "hardware_d110",
        "hardware_d11h",
        "consumables",
        "solution_comercio",
        "solution_inventario",
        "solution_organizacion",
        "solution_identificacion",
        "trust",
    ]);
    const NIIMBOT_STORAGE_PREFIX = "niimbot-editorial";
    const NIIMBOT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
    const NIIMBOT_ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
    const revenueStatuses = new Set(["paid", "approved", "completed", "payment_approved"]);
    const allowedOrderStatuses = new Set([
        "payment_pending",
        "payment_approved",
        "payment_failed",
        "pending",
        "paid",
        "approved",
        "shipped",
        "delivered",
        "cancelled",
        "failed",
        "completed",
    ]);
    class ProductBatchAbort extends Error {
        statusCode;
        responseBody;
        constructor(statusCode, responseBody) {
            super(String(responseBody.error ?? "No se pudo guardar el lote de productos"));
            this.statusCode = statusCode;
            this.responseBody = responseBody;
        }
    }
    const normalizeCedula = (value) => value.replace(/\D/g, "").trim();
    const createGeneratedPasswordHash = () => bcrypt.hash(crypto.randomUUID(), 10);
    const parseBoolean = (value) => {
        if (typeof value === "boolean")
            return value;
        if (typeof value === "number")
            return value !== 0;
        const normalized = String(value ?? "").trim().toLowerCase();
        return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "si" || normalized === "sí";
    };
    const asRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    const isProduction = process.env.NODE_ENV === "production" || process.env.RENDER === "true";
    const cookieSecure = process.env.COOKIE_SECURE !== undefined ? parseBoolean(process.env.COOKIE_SECURE) : isProduction;
    const configuredSameSite = process.env.COOKIE_SAMESITE?.trim().toLowerCase();
    const cookieSameSite = configuredSameSite === "strict" || configuredSameSite === "lax" || configuredSameSite === "none"
        ? configuredSameSite
        : isProduction ? "none" : "lax";
    const REFRESH_TOKEN_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
    const buildRefreshCookieOptions = () => ({ httpOnly: true, secure: cookieSecure, sameSite: cookieSameSite, path: "/", maxAge: REFRESH_TOKEN_MAX_AGE });
    const parseCouponData = (row) => ({
        code: String(row.code ?? "").trim().toUpperCase(),
        type: String(row.type ?? "fixed").trim().toLowerCase() === "percent" ? "percent" : "fixed",
        value: parseDecimal(row.value) ?? new Prisma.Decimal(0),
        active: row.active !== undefined ? parseBoolean(row.active) : true,
        minimumSubtotal: parseDecimal(row.minimumSubtotal ?? row.minimum_subtotal),
        expiresAt: row.expiresAt ? new Date(String(row.expiresAt)) : row.expires_at ? new Date(String(row.expires_at)) : undefined,
    });
    const recordCouponAudit = async (data) => {
        if (!data.couponCode)
            return;
        try {
            console.debug("Coupon audit skipped", {
                action: data.action,
                actorPresent: Boolean(data.performedByUserId || data.performedByEmail),
            });
        }
        catch {
            console.error("Failed to record coupon audit");
        }
    };
    const corsOrigins = process.env.CORS_ORIGIN?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
    const isAllowedCorsOriginForRequest = (origin) => isAllowedCorsOrigin(origin, corsOrigins);
    app.use(cors({
        origin: (origin, callback) => {
            if (!origin)
                return callback(null, true);
            if (isAllowedCorsOriginForRequest(origin)) {
                return callback(null, true);
            }
            return callback(new Error(`Origin not allowed by CORS: ${origin}`));
        },
        credentials: true,
        allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With", "X-Access-Token"],
    }));
    app.use(express.json({
        limit: "15mb",
        verify: (req, _res, buffer) => {
            req.rawBody = buffer.toString("utf8");
        },
    }));
    app.use(cookieParser());
    app.use("/uploads", express.static(uploadsDir));
    app.use("/assets", express.static(assetsDir, { fallthrough: false }));
    const parseDecimal = (value) => {
        if (value === null)
            return null;
        const normalized = String(value ?? "").trim();
        if (normalized === "")
            return undefined;
        return new Prisma.Decimal(normalized);
    };
    const computeWholesalePricing = ({ basePrice, quantity, activateWholesale, wholesaleMinQty, wholesaleDiscountPercent, }) => {
        const decimalBasePrice = basePrice instanceof Prisma.Decimal ? basePrice : new Prisma.Decimal(Number(basePrice ?? 0));
        const normalizedQuantity = Number(quantity) || 0;
        const minQty = Number(wholesaleMinQty ?? 0) || 0;
        const discountPercent = Number(wholesaleDiscountPercent ?? 0) || 0;
        const isWholesale = Boolean(activateWholesale) && minQty > 0 && discountPercent > 0 && normalizedQuantity >= minQty;
        const discountMultiplier = isWholesale ? new Prisma.Decimal(1).sub(new Prisma.Decimal(discountPercent).div(new Prisma.Decimal(100))) : new Prisma.Decimal(1);
        const finalUnitPrice = decimalBasePrice.mul(discountMultiplier);
        const lineTotal = finalUnitPrice.mul(normalizedQuantity);
        const totalDiscount = decimalBasePrice.mul(normalizedQuantity).sub(lineTotal);
        return {
            isWholesale,
            minQty,
            discountPercent,
            finalUnitPrice,
            lineTotal,
            totalDiscount,
        };
    };
    const dbCallWithRetry = async (fn, attempts = 3, delayMs = 250) => {
        let lastErr = null;
        for (let i = 0; i < attempts; i++) {
            try {
                return await fn();
            }
            catch (err) {
                lastErr = err;
                if (i < attempts - 1)
                    await new Promise((r) => setTimeout(r, delayMs));
            }
        }
        throw lastErr;
    };
    const serializeUser = (user) => user
        ? {
            id: user.id,
            name: user.name,
            email: user.email,
            cedula: user.cedula,
            is_admin: user.isAdmin,
        }
        : null;
    const serializeProduct = (product) => {
        const categories = (product.categories ?? []).map((item) => item && typeof item === "object" && "category" in item
            ? item.category
            : item);
        return wrap({ ...product, price: product.price, categories, variants: product.variants ?? [], images: product.images ?? [] });
    };
    const serializeOrder = (order) => wrap({
        ...order,
        total: order.total,
        shipping_name: order.shipping_name ?? null,
        shipping_email: order.shipping_email ?? null,
        shipping_phone: order.shipping_phone ?? null,
        shipping_department: order.shipping_department ?? null,
        shipping_city: order.shipping_city ?? null,
        shipping_address: order.shipping_address ?? null,
        shipping_reference: order.shipping_reference ?? null,
    });
    const serializeCoupon = (coupon) => wrap({ ...coupon, value: coupon.value, minimumSubtotal: coupon.minimumSubtotal });
    const serializeCouponAudit = (row) => wrap(row);
    const serializeCedulaEmail = (row) => wrap(row);
    const serializeUserAddress = (row) => ({
        id: row.id,
        label: row.label,
        fullName: row.fullName,
        cedula: row.cedula,
        email: row.email,
        phone: row.phone,
        department: row.department,
        city: row.city,
        address: row.address,
        reference: row.reference,
        isDefault: row.isDefault,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    });
    const getMailer = () => {
        const host = process.env.SMTP_HOST;
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;
        if (!host || !user || !pass)
            return null;
        return nodemailer.createTransport({
            host,
            port: Number(process.env.SMTP_PORT || 587),
            secure: String(process.env.SMTP_SECURE || "false") === "true",
            auth: { user, pass },
        });
    };
    const moneyFormatter = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
    const buildInvoiceText = (order) => {
        const items = Array.isArray(order.items) ? order.items : [];
        const itemLines = items.map((item) => {
            const title = String(item.title ?? item.name ?? "Producto");
            const quantity = Number(item.quantity ?? 1);
            const lineTotal = Number(item.lineTotal ?? item.total ?? Number(item.unit_price ?? item.price ?? 0) * quantity);
            return `- ${quantity} x ${title} = ${moneyFormatter.format(lineTotal)}`;
        });
        return [
            `Hola ${order.customerName || "cliente"},`,
            "",
            `Tu factura del pedido ${order.id} está lista.`,
            "",
            `Cliente: ${order.customerName || ""}`,
            `Correo: ${order.customerEmail || ""}`,
            `Ciudad: ${order.customerCity || ""}`,
            `Dirección: ${order.customerAddress || ""}`,
            `Teléfono: ${order.customerPhone || ""}`,
            `Pago: ${order.paymentMethod || order.status}`,
            "",
            "Productos:",
            ...(itemLines.length ? itemLines : ["- Sin detalle de productos"]),
            "",
            `Envío: ${moneyFormatter.format(Number(order.shipping || 0))}`,
            `Total: ${moneyFormatter.format(Number(order.total || 0))}`,
            "",
            "Gracias por comprar con Shelby.",
        ].join("\n");
    };
    const sendInvoiceEmail = async (order) => {
        const customerEmail = String(order.customerEmail || "").trim().toLowerCase();
        if (!customerEmail)
            return;
        const mailer = getMailer();
        if (!mailer) {
            console.warn("SMTP no configurado; no se envió la factura");
            return;
        }
        const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
        if (!fromEmail)
            return;
        await mailer.sendMail({
            from: `"${process.env.SMTP_FROM_NAME || "Shelby Importaciones"}" <${fromEmail}>`,
            to: customerEmail,
            subject: `Factura Shelby - Pedido ${order.id}`,
            text: buildInvoiceText(order),
        });
    };
    const normalizeOrderCreateData = (row) => ({
        items: Array.isArray(row.items) ? row.items : [],
        total: new Prisma.Decimal(0),
        shipping: 0,
        status: String(row.status ?? "pending"),
        paymentMethod: row.paymentMethod !== undefined ? String(row.paymentMethod) : row.payment_method !== undefined ? String(row.payment_method) : undefined,
        couponCode: null,
        discountAmount: null,
        customerName: row.customerName !== undefined ? String(row.customerName) : row.customer_name !== undefined ? String(row.customer_name) : undefined,
        customerEmail: row.customerEmail !== undefined ? String(row.customerEmail).trim().toLowerCase() : row.customer_email !== undefined ? String(row.customer_email).trim().toLowerCase() : undefined,
        customerPhone: row.customerPhone !== undefined ? String(row.customerPhone) : row.customer_phone !== undefined ? String(row.customer_phone) : undefined,
        customerCity: row.customerCity !== undefined ? String(row.customerCity) : row.customer_city !== undefined ? String(row.customer_city) : undefined,
        customerAddress: row.customerAddress !== undefined ? String(row.customerAddress) : row.customer_address !== undefined ? String(row.customer_address) : undefined,
        notes: row.notes !== undefined ? String(row.notes) : undefined,
        userId: row.userId !== undefined ? String(row.userId) : row.user_id !== undefined ? String(row.user_id) : undefined,
        shipping_name: row.shipping_name !== undefined ? String(row.shipping_name) : undefined,
        shipping_email: row.shipping_email !== undefined ? String(row.shipping_email).trim().toLowerCase() : undefined,
        shipping_phone: row.shipping_phone !== undefined ? String(row.shipping_phone) : undefined,
        shipping_department: row.shipping_department !== undefined ? String(row.shipping_department) : undefined,
        shipping_city: row.shipping_city !== undefined ? String(row.shipping_city) : undefined,
        shipping_address: row.shipping_address !== undefined ? String(row.shipping_address) : undefined,
        shipping_reference: row.shipping_reference !== undefined ? String(row.shipping_reference) : undefined,
    });
    const normalizeOrderUpdateData = (row) => {
        const data = {};
        if (row.items !== undefined)
            data.items = Array.isArray(row.items) ? row.items : [];
        if (row.total !== undefined)
            data.total = new Prisma.Decimal(Number(row.total));
        if (row.shipping !== undefined)
            data.shipping = Number(row.shipping);
        if (row.status !== undefined)
            data.status = String(row.status);
        if (row.paymentMethod !== undefined)
            data.paymentMethod = String(row.paymentMethod);
        if (row.payment_method !== undefined)
            data.paymentMethod = String(row.payment_method);
        if (row.couponCode !== undefined)
            data.couponCode = String(row.couponCode).trim().toUpperCase();
        if (row.coupon_code !== undefined)
            data.couponCode = String(row.coupon_code).trim().toUpperCase();
        if (row.discountAmount !== undefined)
            data.discountAmount = parseDecimal(row.discountAmount);
        if (row.discount_amount !== undefined)
            data.discountAmount = parseDecimal(row.discount_amount);
        if (row.customerName !== undefined)
            data.customerName = String(row.customerName);
        if (row.customer_name !== undefined)
            data.customerName = String(row.customer_name);
        if (row.customerEmail !== undefined)
            data.customerEmail = String(row.customerEmail).trim().toLowerCase();
        if (row.customer_email !== undefined)
            data.customerEmail = String(row.customer_email).trim().toLowerCase();
        if (row.customerPhone !== undefined)
            data.customerPhone = String(row.customerPhone);
        if (row.customer_phone !== undefined)
            data.customerPhone = String(row.customer_phone);
        if (row.customerCity !== undefined)
            data.customerCity = String(row.customerCity);
        if (row.customer_city !== undefined)
            data.customerCity = String(row.customer_city);
        if (row.customerAddress !== undefined)
            data.customerAddress = String(row.customerAddress);
        if (row.customer_address !== undefined)
            data.customerAddress = String(row.customer_address);
        if (row.notes !== undefined)
            data.notes = String(row.notes);
        if (row.userId !== undefined)
            data.userId = String(row.userId);
        if (row.user_id !== undefined)
            data.userId = String(row.user_id);
        if (row.shipping_name !== undefined)
            data.shipping_name = String(row.shipping_name);
        if (row.shipping_email !== undefined)
            data.shipping_email = String(row.shipping_email).trim().toLowerCase();
        if (row.shipping_phone !== undefined)
            data.shipping_phone = String(row.shipping_phone);
        if (row.shipping_department !== undefined)
            data.shipping_department = String(row.shipping_department);
        if (row.shipping_city !== undefined)
            data.shipping_city = String(row.shipping_city);
        if (row.shipping_address !== undefined)
            data.shipping_address = String(row.shipping_address);
        if (row.shipping_reference !== undefined)
            data.shipping_reference = String(row.shipping_reference);
        return data;
    };
    // User addresses endpoints
    app.get("/api/user/addresses", async (req, res) => {
        const auth = requireAuth(req, res);
        if (!auth)
            return;
        const rows = await prisma.userAddress.findMany({ where: { userId: auth.sub }, orderBy: { createdAt: "desc" } });
        return res.json((rows ?? []).map(serializeUserAddress));
    });
    app.post("/api/user/addresses", async (req, res) => {
        const auth = requireAuth(req, res);
        if (!auth)
            return;
        const body = req.body;
        const data = {
            label: String(body.label ?? "Casa"),
            fullName: String(body.fullName ?? body.full_name ?? ""),
            cedula: String(body.cedula ?? ""),
            email: body.email ? String(body.email).trim().toLowerCase() : "",
            phone: body.phone ? String(body.phone) : "",
            department: String(body.department ?? ""),
            city: String(body.city ?? ""),
            address: String(body.address ?? ""),
            reference: body.reference ? String(body.reference) : null,
            isDefault: Boolean(body.isDefault ?? false),
            user: { connect: { id: auth.sub } },
        };
        if (data.isDefault) {
            await prisma.userAddress.updateMany({ where: { userId: auth.sub, isDefault: true }, data: { isDefault: false } });
        }
        else {
            const count = await prisma.userAddress.count({ where: { userId: auth.sub } });
            if (count === 0)
                data.isDefault = true;
        }
        const created = await prisma.userAddress.create({ data });
        return res.json(serializeUserAddress(created));
    });
    app.patch("/api/user/addresses/:id", async (req, res) => {
        const auth = requireAuth(req, res);
        if (!auth)
            return;
        const { id } = req.params;
        const existing = await prisma.userAddress.findUnique({ where: { id } });
        if (!existing)
            return res.status(404).json({ error: "Not found" });
        if (existing.userId !== auth.sub)
            return res.status(403).json({ error: "No autorizado" });
        const body = req.body;
        const data = {};
        if (body.label !== undefined)
            data.label = String(body.label);
        if (body.fullName !== undefined)
            data.fullName = String(body.fullName);
        if (body.cedula !== undefined)
            data.cedula = String(body.cedula);
        if (body.email !== undefined)
            data.email = String(body.email).trim().toLowerCase();
        if (body.phone !== undefined)
            data.phone = String(body.phone);
        if (body.department !== undefined)
            data.department = String(body.department);
        if (body.city !== undefined)
            data.city = String(body.city);
        if (body.address !== undefined)
            data.address = String(body.address);
        if (body.reference !== undefined)
            data.reference = body.reference ? String(body.reference) : null;
        if (body.isDefault !== undefined)
            data.isDefault = Boolean(body.isDefault);
        if (data.isDefault === true) {
            await prisma.userAddress.updateMany({ where: { userId: auth.sub, isDefault: true }, data: { isDefault: false } });
        }
        const updated = await prisma.userAddress.update({ where: { id }, data });
        return res.json(serializeUserAddress(updated));
    });
    app.delete("/api/user/addresses/:id", async (req, res) => {
        const auth = requireAuth(req, res);
        if (!auth)
            return;
        const { id } = req.params;
        const existing = await prisma.userAddress.findUnique({ where: { id } });
        if (!existing)
            return res.status(404).json({ error: "Not found" });
        if (existing.userId !== auth.sub)
            return res.status(403).json({ error: "No autorizado" });
        // If the address being deleted is the default, pick another address of the user
        // and mark it as default to preserve a principal address when possible.
        const wasDefault = Boolean(existing.isDefault);
        await prisma.userAddress.delete({ where: { id } });
        if (wasDefault) {
            const another = await prisma.userAddress.findFirst({ where: { userId: auth.sub }, orderBy: { createdAt: "desc" } });
            if (another) {
                await prisma.userAddress.update({ where: { id: another.id }, data: { isDefault: true } });
            }
        }
        return res.json({ ok: true });
    });
    app.patch("/api/user/addresses/:id/default", async (req, res) => {
        const auth = requireAuth(req, res);
        if (!auth)
            return;
        const { id } = req.params;
        const existing = await prisma.userAddress.findUnique({ where: { id } });
        if (!existing)
            return res.status(404).json({ error: "Not found" });
        if (existing.userId !== auth.sub)
            return res.status(403).json({ error: "No autorizado" });
        await prisma.userAddress.updateMany({ where: { userId: auth.sub, isDefault: true }, data: { isDefault: false } });
        const updated = await prisma.userAddress.update({ where: { id }, data: { isDefault: true } });
        return res.json(serializeUserAddress(updated));
    });
    const issueSession = (user) => {
        const payload = {
            sub: user.id,
            email: user.email,
            name: user.name,
            cedula: user.cedula,
            isAdmin: user.isAdmin,
        };
        const accessToken = jwt.sign(payload, jwtSecret, { expiresIn: "15m" });
        return {
            access_token: accessToken,
            user: {
                id: user.id,
                email: user.email,
                user_metadata: { name: user.name, cedula: user.cedula, is_admin: user.isAdmin },
            },
        };
    };
    const createAndSetRefreshToken = async (userId, res) => {
        const expiresAt = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE);
        let token;
        if (dependencies.createRefreshToken) {
            token = await dependencies.createRefreshToken(userId, expiresAt);
        }
        else {
            token = await createRefreshTokenForUser(userId, expiresAt);
        }
        res.cookie("refresh_token", token, buildRefreshCookieOptions());
    };
    const createRefreshTokenForUser = async (userId, expiresAt, transaction) => {
        if (dependencies.createRefreshToken) {
            return dependencies.createRefreshToken(userId, expiresAt, transaction);
        }
        const refreshTokens = await import("./lib/refreshTokens.js");
        const token = refreshTokens.generateRefreshToken();
        await refreshTokens.createRefreshTokenWithClient(transaction ?? prisma, userId, token, expiresAt);
        return token;
    };
    const getAuthorizationHeader = (req) => {
        const directHeader = req.headers.authorization;
        const accessTokenHeader = req.headers["x-access-token"];
        if (Array.isArray(directHeader))
            return directHeader[0];
        if (Array.isArray(accessTokenHeader))
            return accessTokenHeader[0];
        if (typeof directHeader === "string")
            return directHeader;
        if (typeof accessTokenHeader === "string")
            return accessTokenHeader;
        return undefined;
    };
    const readAuth = (authorization) => {
        const authValue = authorization?.trim();
        const bearerMatch = authValue?.match(/^Bearer\s+(.+)$/i);
        const tokenCandidate = bearerMatch?.[1] ?? authValue;
        const hasBearerToken = Boolean(tokenCandidate);
        if (!hasBearerToken)
            return null;
        const token = tokenCandidate ?? "";
        try {
            const decoded = jwt.verify(token, jwtSecret);
            return decoded;
        }
        catch {
            console.warn("[auth] token verification failed");
            return null;
        }
    };
    const requireAuth = (req, res) => {
        const authHeader = getAuthorizationHeader(req);
        const auth = readAuth(authHeader);
        if (!auth) {
            const reason = !authHeader ? "missing-header" : authHeader.startsWith("Bearer ") ? "invalid-token" : "invalid-header-format";
            console.log("[auth] requireAuth failed", {
                method: req.method,
                path: req.path,
                authorizationHeader: Boolean(authHeader),
                receivedHeaderType: authHeader?.startsWith("Bearer ") ? "bearer" : authHeader ? "raw" : "missing",
                reason,
            });
            res.status(401).json({ error: "No autorizado", reason });
            return null;
        }
        return auth;
    };
    const logAdminDecision = async (req, auth, user) => {
        const isAdminByRecord = isAdminUserRecord(user);
        console.log("[auth] admin decision", {
            method: req.method,
            path: req.path,
            hasAuthorization: Boolean(getAuthorizationHeader(req)),
            authIsAdmin: auth.isAdmin,
            dbIsAdmin: user?.isAdmin ?? null,
            isAdminByRecord,
            rule: isAdminByRecord ? "admin-cedula-or-db-flag" : "denied",
        });
    };
    const readWompiPaymentMethodAvailability = async () => {
        const { baseUrl, publicKey } = getWompiConfig();
        if (!publicKey) {
            console.warn("[wompi] payment methods unavailable because WOMPI_PUBLIC_KEY is missing; returning empty methods list for local dev");
            return {
                payload: {},
                methods: [],
                acceptanceToken: "",
            };
        }
        const response = await fetch(`${baseUrl}/merchants/${encodeURIComponent(publicKey)}`, {
            headers: buildWompiAuthorizationHeader(),
            signal: AbortSignal.timeout(10000),
        });
        const text = await response.text();
        let payload = {};
        try {
            payload = text ? JSON.parse(text) : {};
        }
        catch {
            payload = { raw: text };
        }
        if (!response.ok) {
            throw new Error(`Wompi merchant lookup failed: ${response.status}`);
        }
        return {
            payload,
            methods: extractWompiMerchantMethods(payload),
        };
    };
    const createWompiTransaction = async (body) => {
        const config = getWompiConfig();
        const { baseUrl, publicKey } = config;
        const paymentMethod = normalizeWompiPaymentMethod(body.paymentMethod ?? body.payment_method) ?? "CARD";
        const reference = String(body.reference ?? body.referencePedido ?? body.orderId ?? "").trim();
        const redirectUrl = String(body.redirectUrl ?? body.redirect_url ?? "").trim() || undefined;
        const customerEmail = String(body.customerEmail ?? body.customer_email ?? "").trim().toLowerCase();
        const configurationError = getWompiPaymentConfigError(config, process.env.NODE_ENV, process.env.WOMPI_SIMULATE_PAYMENTS, isWompiPublicEnvironment(process.env.NODE_ENV, process.env.RENDER));
        if (configurationError) {
            const error = new Error(configurationError);
            error.status = 503;
            error.code = "payment_provider_not_configured";
            throw error;
        }
        if (!publicKey) {
            if (!isWompiPaymentSimulationEnabled(process.env.NODE_ENV, process.env.WOMPI_SIMULATE_PAYMENTS, isWompiPublicEnvironment(process.env.NODE_ENV, process.env.RENDER))) {
                const error = new Error("Wompi payment simulation is disabled");
                error.status = 503;
                error.code = "payment_provider_not_configured";
                throw error;
            }
            console.warn("[wompi] explicit development payment simulation enabled");
            return {
                payload: { data: { id: `LOCAL-${reference || "ORDER"}`, status: "PENDING" } },
                transaction: {
                    id: `LOCAL-${reference || "ORDER"}`,
                    status: "PENDING",
                    payment_method_type: paymentMethod,
                    payment_method: paymentMethod,
                    next_action: null,
                    redirect_url: null,
                    checkout_url: null,
                    payment_url: null,
                    reference,
                },
                methods: [],
            };
        }
        const amountInCents = Math.round(Number(body.total ?? 0) * 100);
        const customerPhoneRaw = String(body.customerPhone ?? body.customer_phone ?? "").trim();
        const customerPhoneDigits = normalizePhoneNumber(customerPhoneRaw);
        const missingFields = [];
        if (!body.total && body.total !== 0)
            missingFields.push("amount");
        if (!customerEmail)
            missingFields.push("customerEmail");
        if (!reference)
            missingFields.push("reference");
        if (missingFields.length > 0) {
            const error = Object.assign(new Error("required_fields_missing"), { missingFields });
            throw error;
        }
        const currency = String(body.currency ?? "COP").trim().toUpperCase();
        if (currency !== "COP" || !Number.isSafeInteger(amountInCents) || amountInCents <= 0) {
            const error = new Error("El importe o la moneda del pedido no son válidos.");
            error.status = 422;
            throw error;
        }
        if (amountInCents < 15000000) {
            const error = Object.assign(new Error("Wompi requiere un pedido mínimo de $ 150.000 para pagos electrónicos."), {
                status: 422,
                payload: {
                    error: {
                        type: "UNPROCESSABLE",
                        reason: "La base de la transacción debe ser igual o mayor a 150000",
                    },
                },
            });
            throw error;
        }
        const merchant = await readWompiPaymentMethodAvailability();
        const requestBody = {
            name: `Pedido ${reference}`,
            description: `Checkout de pago para pedido ${reference}`,
            single_use: true,
            collect_shipping: false,
            currency,
            amount_in_cents: amountInCents,
            reference,
            redirect_url: redirectUrl,
            payment_method_types: [paymentMethod],
            customer_email: customerEmail,
            customer_data: {
                full_name: String(body.customerName ?? body.customer_name ?? "").trim() || undefined,
            },
            metadata: {
                products: Array.isArray(body.products) ? body.products : [],
            },
        };
        console.log("[wompi] create payment link request", {
            currency,
            paymentMethod,
            hasCustomerEmail: Boolean(customerEmail),
            hasCustomerPhone: Boolean(customerPhoneDigits),
            productsCount: Array.isArray(body.products) ? body.products.length : 0,
            hasPrivateKey: Boolean(config.privateKey),
        });
        const paymentLinkUrl = `${baseUrl}/payment_links`;
        const response = await fetch(paymentLinkUrl, {
            method: "POST",
            headers: {
                ...buildWompiAuthorizationHeader(),
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(20000),
        });
        const text = await response.text();
        let payload = {};
        try {
            payload = text ? JSON.parse(text) : {};
        }
        catch {
            payload = { raw: text };
        }
        if (!response.ok) {
            console.error("[wompi] payment link request failed", { status: response.status });
            const err = new Error(`Wompi transaction failed: ${response.status}`);
            err.status = response.status;
            throw err;
        }
        const transaction = payload.data ?? payload;
        const paymentLinkId = String(transaction.id ?? "").trim() || null;
        const paymentUrl = paymentLinkId ? `https://checkout.wompi.co/l/${paymentLinkId}` : null;
        console.log("[wompi] payment link response", { created: Boolean(paymentLinkId) });
        return { payload, transaction, methods: merchant.methods, paymentLinkId, paymentUrl, transactionId: null, status: null };
    };
    const readWompiPaymentLink = async (paymentLinkId) => {
        const { baseUrl } = getWompiConfig();
        const response = await fetch(`${baseUrl}/payment_links/${encodeURIComponent(paymentLinkId)}`, {
            headers: buildWompiAuthorizationHeader(),
            signal: AbortSignal.timeout(10000),
        });
        const text = await response.text();
        let payload = {};
        try {
            payload = text ? JSON.parse(text) : {};
        }
        catch {
            throw new Error("Wompi returned an invalid payment-link response");
        }
        if (!response.ok)
            throw new Error(`Wompi payment-link lookup failed: ${response.status}`);
        const link = (payload.data && typeof payload.data === "object" ? payload.data : payload);
        const expiresAtValue = typeof link.expires_at === "string" ? link.expires_at : "";
        const expiresAt = expiresAtValue ? new Date(expiresAtValue) : null;
        const rawAmount = link.amount_in_cents;
        return {
            active: link.active === true,
            expiresAt: expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt : null,
            paymentUrl: `https://checkout.wompi.co/l/${encodeURIComponent(paymentLinkId)}`,
            reference: typeof link.reference === "string" ? link.reference : null,
            amountInCents: typeof rawAmount === "number" && Number.isSafeInteger(rawAmount) ? rawAmount : null,
            currency: typeof link.currency === "string" ? link.currency.trim().toUpperCase() : null,
        };
    };
    const requireAdmin = async (req, res) => {
        const auth = requireAuth(req, res);
        if (!auth)
            return null;
        const user = await prisma.user.findUnique({ where: { id: auth.sub } });
        const isAdminByRecord = isAdminUserRecord(user);
        await logAdminDecision(req, auth, user);
        if (user && isAdminByRecord && canManagePrivateData({ id: user.id, isAdmin: isAdminByRecord }))
            return user;
        res.status(403).json({ error: "Solo administradores" });
        return null;
    };
    const readNiimbotStorageConfig = () => {
        const supabaseUrl = String(process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
        const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
        const bucket = String(process.env.SUPABASE_STORAGE_BUCKET ?? "").trim();
        if (!supabaseUrl || !serviceRoleKey || !bucket) {
            throw new Error("NIIMBOT storage is not configured");
        }
        return { supabaseUrl, serviceRoleKey, bucket };
    };
    const isAllowedNiimbotPageImageKey = (key) => NIIMBOT_PAGE_IMAGE_KEYS.has(key);
    const isSafeNiimbotPageImagePath = (key, value) => {
        const expectedPrefix = `${NIIMBOT_STORAGE_PREFIX}/${key}/`;
        if (!value.startsWith(expectedPrefix) || value.includes("%") || value.includes("\\") || value.includes("//"))
            return false;
        const segments = value.split("/");
        return segments.length === 3 && segments[0] === NIIMBOT_STORAGE_PREFIX && segments[1] === key && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segments[2]);
    };
    const decodeStrictBase64 = (value) => {
        if (typeof value !== "string" || !value || /\s/.test(value))
            return null;
        if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
            return null;
        const decoded = Buffer.from(value, "base64");
        if (!decoded.length || decoded.toString("base64") !== value)
            return null;
        return decoded;
    };
    const detectNiimbotImageType = (content) => {
        const isJpeg = content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
        const isPng = content.length >= 8 && Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).equals(content.subarray(0, 8));
        const isWebp = content.length >= 12 && content.toString("ascii", 0, 4) === "RIFF" && content.toString("ascii", 8, 12) === "WEBP";
        if (isJpeg)
            return { mimeType: "image/jpeg", extension: "jpg" };
        if (isPng)
            return { mimeType: "image/png", extension: "png" };
        if (isWebp)
            return { mimeType: "image/webp", extension: "webp" };
        return null;
    };
    const serializeNiimbotPageImage = (record, includeUpdatedAt = false) => ({
        key: record.key,
        path: record.path,
        alt: record.alt,
        ...(includeUpdatedAt ? { updatedAt: record.updatedAt.toISOString() } : {}),
    });
    const uploadNiimbotStorageObject = async (objectPath, content, mimeType) => {
        const { supabaseUrl, serviceRoleKey, bucket } = readNiimbotStorageConfig();
        const encodedPath = objectPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
        const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`, {
            method: "POST",
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                "Content-Type": mimeType,
                "x-upsert": "false",
            },
            body: Uint8Array.from(content),
        });
        if (!response.ok) {
            throw new Error("Supabase Storage upload failed");
        }
    };
    const createNiimbotSignedUrl = async (objectPath, expiresIn) => {
        const { supabaseUrl, serviceRoleKey, bucket } = readNiimbotStorageConfig();
        const encodedPath = objectPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
        const response = await fetch(`${supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`, {
            method: "POST",
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ expiresIn }),
        });
        if (!response.ok)
            throw new Error("Supabase Storage signed URL failed");
        const payload = await response.json();
        if (!payload.signedURL)
            throw new Error("Supabase Storage returned no signed URL");
        return new URL(payload.signedURL, `${supabaseUrl}/`).toString();
    };
    app.get("/api/niimbot/page-images", async (_req, res) => {
        try {
            const records = await niimbotPageImageStore.findMany({ orderBy: { key: "asc" } });
            return res.json(records.map((record) => serializeNiimbotPageImage(record)));
        }
        catch (error) {
            console.error("NIIMBOT page images read failed", error instanceof Error ? error.message : "unknown error");
            return res.status(500).json({ error: "No se pudieron cargar las imágenes de NIIMBOT" });
        }
    });
    app.get("/api/niimbot/page-images/:key/url", async (req, res) => {
        const key = String(req.params.key ?? "").trim();
        if (!isAllowedNiimbotPageImageKey(key))
            return res.status(400).json({ error: "Clave de imagen no permitida" });
        try {
            const record = await niimbotPageImageStore.findUnique({ where: { key } });
            if (!record || !isSafeNiimbotPageImagePath(key, record.path))
                return res.status(404).json({ error: "Imagen de NIIMBOT no configurada" });
            const expiresIn = 60 * 60;
            const url = await createNiimbotSignedUrl(record.path, expiresIn);
            return res.json({ url, expiresIn });
        }
        catch (error) {
            console.error("NIIMBOT signed URL failed", error instanceof Error ? error.message : "unknown error");
            return res.status(502).json({ error: "No se pudo resolver la imagen de NIIMBOT" });
        }
    });
    app.put("/api/niimbot/page-images/:key", async (req, res) => {
        const authUser = await requireAdmin(req, res);
        if (!authUser)
            return;
        const key = String(req.params.key ?? "").trim();
        const body = req.body;
        const imagePath = String(body.path ?? "").trim();
        if (!isAllowedNiimbotPageImageKey(key))
            return res.status(400).json({ error: "Clave de imagen no permitida" });
        if (!isSafeNiimbotPageImagePath(key, imagePath))
            return res.status(400).json({ error: "Ruta de imagen no permitida" });
        if (body.alt !== undefined && body.alt !== null && String(body.alt).length > 200)
            return res.status(400).json({ error: "Texto alternativo demasiado largo" });
        try {
            const record = await niimbotPageImageStore.upsert({
                where: { key },
                create: { key, path: imagePath, alt: body.alt ? String(body.alt).trim() : null },
                update: { path: imagePath, alt: body.alt ? String(body.alt).trim() : null },
            });
            return res.json(serializeNiimbotPageImage(record, true));
        }
        catch (error) {
            console.error("NIIMBOT page image update failed", error instanceof Error ? error.message : "unknown error");
            return res.status(500).json({ error: "No se pudo guardar la imagen de NIIMBOT" });
        }
    });
    app.post("/api/niimbot/page-images/upload", async (req, res) => {
        const authUser = await requireAdmin(req, res);
        if (!authUser)
            return;
        const body = req.body;
        const key = String(body.key ?? "").trim();
        const declaredMimeType = String(body.mimeType ?? "").trim().toLowerCase();
        const encodedContent = body.contentBase64;
        if (!isAllowedNiimbotPageImageKey(key))
            return res.status(400).json({ error: "Clave de imagen no permitida" });
        if (!NIIMBOT_ALLOWED_MIME_TYPES.has(declaredMimeType))
            return res.status(415).json({ error: "Tipo de imagen no permitido" });
        if (body.alt !== undefined && body.alt !== null && String(body.alt).length > 200)
            return res.status(400).json({ error: "Texto alternativo demasiado largo" });
        if (typeof encodedContent !== "string" || !encodedContent)
            return res.status(400).json({ error: "Contenido de imagen inválido" });
        let base64 = encodedContent;
        if (encodedContent.startsWith("data:")) {
            const dataUrlMatch = encodedContent.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/);
            if (!dataUrlMatch || dataUrlMatch[1].toLowerCase() !== declaredMimeType)
                return res.status(400).json({ error: "Contenido de imagen inválido" });
            base64 = dataUrlMatch[2];
        }
        const content = decodeStrictBase64(base64);
        if (!content)
            return res.status(400).json({ error: "Contenido de imagen inválido" });
        if (!content.length || content.length > NIIMBOT_MAX_IMAGE_BYTES)
            return res.status(413).json({ error: "La imagen supera el tamaño permitido" });
        const detectedType = detectNiimbotImageType(content);
        if (!detectedType || detectedType.mimeType !== declaredMimeType)
            return res.status(415).json({ error: "El contenido no coincide con el tipo de imagen declarado" });
        const extension = detectedType.extension;
        const imagePath = `${NIIMBOT_STORAGE_PREFIX}/${key}/${crypto.randomUUID()}.${extension}`;
        try {
            await uploadNiimbotStorageObject(imagePath, content, detectedType.mimeType);
            const record = await niimbotPageImageStore.upsert({
                where: { key },
                create: { key, path: imagePath, alt: body.alt ? String(body.alt).trim() : null },
                update: { path: imagePath, alt: body.alt ? String(body.alt).trim() : null },
            });
            return res.status(201).json(serializeNiimbotPageImage(record, true));
        }
        catch (error) {
            console.error("NIIMBOT page image upload failed", error instanceof Error ? error.message : "unknown error");
            return res.status(502).json({ error: "No se pudo almacenar la imagen de NIIMBOT" });
        }
    });
    if (process.env.CATALOG_DRY_RUN_ROUTE === "true") {
        app.get("/internal/catalog-sync-dry-run", async (req, res) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return;
            const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { cedula: true, isAdmin: true } });
            if (!isAdminUserRecord(user))
                return res.status(403).json({ error: "Solo administradores" });
            try {
                const plan = await buildCatalogSyncPlan(prisma, staticProducts);
                return res.json(plan);
            }
            catch (error) {
                console.error("Catalog dry-run failed", error);
                return res.status(500).json({ error: "catalog_dry_run_failed" });
            }
        });
    }
    let catalogSyncRunning = false;
    if (process.env.CATALOG_REAL_SYNC_ROUTE === "true") {
        app.post("/internal/catalog-sync-run", async (req, res) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return;
            const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { cedula: true, isAdmin: true } });
            if (!isAdminUserRecord(user))
                return res.status(403).json({ error: "Solo administradores" });
            if (catalogSyncRunning)
                return res.status(409).json({ error: "catalog_sync_already_running" });
            catalogSyncRunning = true;
            try {
                const summary = await syncProductCatalog(prisma);
                return res.json(summary);
            }
            catch (error) {
                console.error("Catalog sync failed", error);
                return res.status(500).json({ error: "catalog_sync_failed" });
            }
            finally {
                catalogSyncRunning = false;
            }
        });
    }
    const parseFilters = (filtersRaw) => {
        if (!filtersRaw)
            return [];
        try {
            const parsed = JSON.parse(filtersRaw);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    };
    const productDeleteFilterTypes = new Map([
        ["id", "string"],
        ["name", "string"],
        ["category", "string"],
        ["price", "number"],
        ["stock", "number"],
        ["image", "string"],
        ["description", "string"],
        ["badge", "string"],
        ["highlight", "boolean"],
        ["oldPrice", "number"],
        ["activateWholesale", "boolean"],
        ["wholesaleMinQty", "number"],
        ["wholesaleDiscountPercent", "number"],
        ["createdAt", "string"],
        ["updatedAt", "string"],
    ]);
    const parseProductDeleteFilters = (filtersRaw) => {
        if (typeof filtersRaw !== "string" || !filtersRaw.trim())
            return null;
        let parsed;
        try {
            parsed = JSON.parse(filtersRaw);
        }
        catch {
            return null;
        }
        if (!Array.isArray(parsed) || parsed.length === 0)
            return null;
        const seenColumns = new Set();
        const filters = [];
        for (const candidate of parsed) {
            if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
                return null;
            const keys = Object.keys(candidate);
            if (keys.length !== 2 || !keys.includes("column") || !keys.includes("value"))
                return null;
            const filter = candidate;
            if (typeof filter.column !== "string" || seenColumns.has(filter.column))
                return null;
            const expectedType = productDeleteFilterTypes.get(filter.column);
            if (!expectedType)
                return null;
            const value = filter.value;
            if (expectedType === "string" && (typeof value !== "string" || value.trim() === ""))
                return null;
            if (expectedType === "number" && (typeof value !== "number" || !Number.isFinite(value)))
                return null;
            if (expectedType === "boolean" && typeof value !== "boolean")
                return null;
            seenColumns.add(filter.column);
            filters.push({ column: filter.column, value: value });
        }
        return filters;
    };
    const applyFilters = (rows, filters) => filters.reduce((filtered, filter) => filtered.filter((row) => String(row[filter.column]) === String(filter.value)), rows);
    const updateProfileName = async (auth, req, res, payload) => {
        const userId = typeof payload.user_id === "string" ? payload.user_id.trim() : "";
        const name = typeof payload.user_name === "string" ? payload.user_name.trim() : "";
        if (!userId || !name) {
            res.status(400).json({ error: "user_id y user_name son requeridos" });
            return null;
        }
        const administrator = userId === auth.sub ? null : await requireAdmin(req, res);
        if (userId !== auth.sub && !administrator)
            return null;
        const principal = { id: auth.sub, isAdmin: Boolean(administrator) };
        if (!canSyncProfile(principal, userId)) {
            res.status(403).json({ error: "No autorizado para sincronizar este perfil" });
            return null;
        }
        const existingUser = await prisma.user.findUnique({ where: { id: userId } });
        if (!existingUser) {
            res.status(404).json({ error: "Usuario no encontrado" });
            return null;
        }
        return prisma.user.update({ where: { id: userId }, data: { name } });
    };
    const findEmailByCedula = async (cedula) => {
        const normalizedCedula = normalizeCedula(cedula);
        const cedulaRow = await prisma.cedulaEmail.findUnique({ where: { cedula: normalizedCedula } });
        if (cedulaRow?.email)
            return cedulaRow.email;
        const profile = await prisma.user.findFirst({ where: { cedula: normalizedCedula } });
        if (profile?.email)
            return profile.email;
        return null;
    };
    app.get("/health", (_req, res) => {
        res.json({ ok: true, service: "shelby-postgresql-backend" });
    });
    app.get("/", (_req, res) => {
        res.json({ ok: true, message: "Shelby PostgreSQL backend is running" });
    });
    app.post("/api/auth/register", async (req, res) => {
        const { email, password, data = {} } = req.body;
        if (!email || !password || typeof data.name !== "string" || data.name.trim() === "" || !data.cedula) {
            return res.status(400).json({ error: "email, password, name y cedula son requeridos" });
        }
        const normalizedCedula = normalizeCedula(data.cedula);
        try {
            const registration = await prisma.$transaction(async (transaction) => {
                const normalizedEmail = email.trim().toLowerCase();
                const existingEmail = await transaction.user.findUnique({ where: { email: normalizedEmail } });
                if (existingEmail)
                    return { conflict: "email" };
                const existingCedula = await transaction.user.findFirst({ where: { cedula: normalizedCedula } });
                if (existingCedula)
                    return { conflict: "cedula" };
                const hashed = await bcrypt.hash(password, 10);
                const user = await transaction.user.create({
                    data: {
                        name: data.name.trim(),
                        email: normalizedEmail,
                        password: hashed,
                        cedula: normalizedCedula,
                        isAdmin: false,
                    },
                });
                await transaction.cedulaEmail.upsert({
                    where: { cedula: normalizedCedula },
                    update: { email: user.email, userId: user.id },
                    create: { cedula: normalizedCedula, email: user.email, userId: user.id },
                });
                const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE);
                const refreshToken = await createRefreshTokenForUser(user.id, refreshExpiresAt, transaction);
                return { user, refreshToken, session: issueSession(user) };
            });
            if ("conflict" in registration) {
                return res.status(409).json({
                    error: registration.conflict === "email"
                        ? "Ya existe un usuario con ese correo"
                        : "Ya existe un usuario con esa cédula",
                });
            }
            res.cookie("refresh_token", registration.refreshToken, buildRefreshCookieOptions());
            return res.json({ session: registration.session, user: serializeUser(registration.user) });
        }
        catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                return res.status(409).json({ error: "Ya existe un usuario con ese correo o cédula" });
            }
            console.error("failed to register user", {
                error: error instanceof Error ? error.name : "unknown",
            });
            return res.status(500).json({ error: "No se pudo completar el registro" });
        }
    });
    app.post("/api/auth/login", async (req, res) => {
        const { email, cedula, password } = req.body;
        if ((!email && !cedula) || !password) {
            return res.status(400).json({ error: "correo o cédula y password son requeridos" });
        }
        let user = null;
        if (cedula) {
            const normalizedCedula = normalizeCedula(cedula);
            if (!normalizedCedula)
                return res.status(401).json({ error: "Cédula o contraseña incorrectas" });
            const cedulaMapping = await prisma.cedulaEmail.findUnique({ where: { cedula: normalizedCedula } });
            if (cedulaMapping?.userId) {
                user = await prisma.user.findUnique({ where: { id: cedulaMapping.userId } });
                if (user && normalizeCedula(user.cedula) !== normalizedCedula) {
                    return res.status(401).json({ error: "Cédula o contraseña incorrectas" });
                }
            }
            if (!user && cedulaMapping?.email) {
                const mappedUser = await prisma.user.findUnique({ where: { email: cedulaMapping.email } });
                if (mappedUser && normalizeCedula(mappedUser.cedula) === normalizedCedula)
                    user = mappedUser;
            }
            if (!user) {
                user = await prisma.user.findFirst({ where: { cedula: normalizedCedula } });
            }
        }
        else {
            user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
        }
        if (!user)
            return res.status(401).json({ error: "Cédula o contraseña incorrectas" });
        const valid = await bcrypt.compare(password, user.password);
        if (!valid)
            return res.status(401).json({ error: "Cédula o contraseña incorrectas" });
        try {
            await createAndSetRefreshToken(user.id, res);
        }
        catch {
            console.error("failed to create refresh token on login");
            return res.status(500).json({ error: "No se pudo establecer la sesión renovable" });
        }
        return res.json({ session: issueSession(user), user: serializeUser(user) });
    });
    app.post("/api/auth/refresh", async (req, res) => {
        // Read refresh token from cookie
        const token = req.cookies?.refresh_token ?? req.headers["x-refresh-token"] ?? null;
        if (!token)
            return res.status(401).json({ error: "missing_refresh_token" });
        try {
            const { verifyRefreshToken, rotateRefreshToken, generateRefreshToken, createRefreshToken } = await import("./lib/refreshTokens.js");
            const verification = await verifyRefreshToken(String(token));
            if (!verification || !verification.valid)
                return res.status(401).json({ error: "invalid_refresh_token" });
            const existing = verification.record;
            const user = await prisma.user.findUnique({ where: { id: existing.userId } });
            if (!user)
                return res.status(404).json({ error: "Usuario no encontrado" });
            // rotate
            const newToken = generateRefreshToken();
            const newExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            const created = await rotateRefreshToken(existing.id, newToken, newExpires);
            // set cookie
            res.cookie("refresh_token", newToken, buildRefreshCookieOptions());
            return res.json({ session: issueSession(user) });
        }
        catch {
            console.error("refresh token rotation failed");
            return res.status(500).json({ error: "refresh_failed" });
        }
    });
    app.post("/api/auth/logout", async (req, res) => {
        const token = req.cookies?.refresh_token ?? req.headers["x-refresh-token"] ?? null;
        if (token) {
            try {
                const { verifyRefreshToken, revokeRefreshToken } = await import("./lib/refreshTokens.js");
                const verification = await verifyRefreshToken(String(token));
                if (verification && verification.record) {
                    await revokeRefreshToken(verification.record.id);
                }
            }
            catch {
                console.error("refresh token revocation failed");
            }
        }
        res.clearCookie("refresh_token", { httpOnly: true, secure: cookieSecure, sameSite: cookieSameSite, path: "/" });
        return res.json({ ok: true });
    });
    app.post("/api/auth/verify", async (req, res) => {
        const { email } = req.body;
        if (!email)
            return res.status(400).json({ error: "email es requerido" });
        const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
        if (!user)
            return res.status(404).json({ error: "Usuario no encontrado" });
        try {
            await createAndSetRefreshToken(user.id, res);
        }
        catch {
            console.error("failed to create refresh token on verify");
            return res.status(500).json({ error: "No se pudo establecer la sesión renovable" });
        }
        return res.json({ session: issueSession(user), user: serializeUser(user) });
    });
    app.post("/api/users/cedula-email", async (req, res) => {
        const auth = requireAuth(req, res);
        if (!auth)
            return;
        const { cedula, email } = req.body;
        if (!cedula || !email)
            return res.status(400).json({ error: "cedula y email son requeridos" });
        const user = await prisma.user.findUnique({ where: { id: auth.sub } });
        if (!user)
            return res.status(404).json({ error: "Usuario no encontrado" });
        const normalizedCedula = normalizeCedula(cedula);
        const normalizedEmail = String(email).trim().toLowerCase();
        const userCedula = normalizeCedula(user.cedula);
        const userEmail = user.email.trim().toLowerCase();
        if (normalizedCedula !== userCedula || normalizedEmail !== userEmail) {
            return res.status(403).json({ error: "Solo puedes asociar la cédula y el correo de tu propia cuenta" });
        }
        const existingMapping = await prisma.cedulaEmail.findUnique({ where: { cedula: userCedula } });
        if (existingMapping?.userId && existingMapping.userId !== user.id) {
            return res.status(409).json({ error: "La cédula ya está asociada a otra cuenta" });
        }
        await prisma.cedulaEmail.upsert({
            where: { cedula: userCedula },
            update: { email: userEmail, userId: user.id },
            create: { cedula: userCedula, email: userEmail, userId: user.id },
        });
        return res.json({ ok: true });
    });
    app.post("/api/profile/sync", async (req, res) => {
        const auth = requireAuth(req, res);
        if (!auth)
            return;
        const user = await updateProfileName(auth, req, res, req.body);
        if (!user)
            return;
        return res.json({ ok: true });
    });
    app.get("/api/profile", async (req, res) => {
        const auth = requireAuth(req, res);
        if (!auth)
            return;
        const user = await prisma.user.findUnique({ where: { id: auth.sub } });
        if (!user)
            return res.status(404).json({ error: "Usuario no encontrado" });
        return res.json({ user: serializeUser(user) });
    });
    app.post("/api/rpc/:name", async (req, res) => {
        const { name } = req.params;
        const auth = requireAuth(req, res);
        if (!auth)
            return;
        if (name === "sync_profile") {
            const user = await updateProfileName(auth, req, res, req.body);
            if (!user)
                return;
            return res.json({ data: null, error: null });
        }
        if (name === "get_email_by_cedula") {
            const { lookup_cedula } = req.body;
            if (!lookup_cedula) {
                return res.status(400).json({ error: "lookup_cedula es requerido" });
            }
            const requester = await prisma.user.findUnique({ where: { id: auth.sub } });
            if (!requester)
                return res.status(401).json({ error: "No autorizado" });
            const normalizedLookupCedula = normalizeCedula(lookup_cedula);
            const principal = { id: requester.id, isAdmin: isAdminUserRecord(requester) };
            if (!canLookupCedulaEmail(principal, normalizeCedula(requester.cedula), normalizedLookupCedula)) {
                return res.status(403).json({ error: "No autorizado para consultar ese correo" });
            }
            const email = await findEmailByCedula(normalizedLookupCedula);
            return res.json(email ?? null);
        }
        return res.status(404).json({ error: "RPC no soportado" });
    });
    app.patch("/api/auth/me", async (req, res) => {
        const auth = requireAuth(req, res);
        if (!auth)
            return;
        const body = req.body;
        const incoming = body.data && typeof body.data === "object" ? body.data : body;
        if (hasAdminRoleMutation(incoming)) {
            return res.status(403).json({ error: "El rol de administrador no se puede modificar desde el perfil propio" });
        }
        const user = await prisma.user.findUnique({ where: { id: auth.sub } });
        if (!user)
            return res.status(404).json({ error: "Usuario no encontrado" });
        return res.json({ user: serializeUser(user) });
    });
    app.get("/api/data/:table", async (req, res) => {
        const { table } = req.params;
        const filters = parseFilters(req.query.filters);
        const limit = req.query.limit ? Number(req.query.limit) : undefined;
        const ascending = req.query.ascending !== "false";
        const orderBy = req.query.orderBy;
        const single = req.query.single === "true";
        const maybeSingle = req.query.maybeSingle === "true";
        const exactOrderId = filters.length === 1 && filters[0].column === "id" && typeof filters[0].value === "string"
            ? String(filters[0].value)
            : null;
        if (table === "orders") {
            const tokenAuth = readAuth(getAuthorizationHeader(req));
            const user = tokenAuth ? await prisma.user.findUnique({ where: { id: tokenAuth.sub } }) : null;
            if (tokenAuth && !user)
                return res.status(401).json({ error: "No autorizado" });
            const principal = user
                ? { id: user.id, isAdmin: isAdminUserRecord(user) }
                : null;
            const access = resolveDataReadAccess(table, principal, Boolean(exactOrderId));
            if (access === "denied") {
                if (!tokenAuth)
                    return res.status(401).json({ error: "No autorizado" });
                return res.status(403).json({ error: "No autorizado para consultar pedidos" });
            }
            if (access === "public-order-status" && exactOrderId) {
                const order = await prisma.order.findUnique({
                    where: { id: exactOrderId },
                    select: { id: true, status: true },
                });
                const result = order ? wrap(order) : null;
                if (single || maybeSingle)
                    return res.json(result);
                return res.json(result ? [result] : []);
            }
            const orderRows = await prisma.order.findMany({
                ...(access === "owner-orders" ? { where: { userId: principal.id } } : {}),
            });
            const filteredOrders = applyFilters(orderRows.map(serializeOrder), filters);
            const orderedOrders = orderBy ? [...filteredOrders].sort((a, b) => {
                const left = String(a[orderBy] ?? "");
                const right = String(b[orderBy] ?? "");
                return ascending ? left.localeCompare(right) : right.localeCompare(left);
            }) : filteredOrders;
            const slicedOrders = typeof limit === "number" ? orderedOrders.slice(0, limit) : orderedOrders;
            if (single || maybeSingle)
                return res.json(slicedOrders[0] ?? null);
            return res.json(slicedOrders);
        }
        if (["profiles", "coupons", "coupon_audit", "cedula_emails"].includes(table)) {
            const auth = requireAuth(req, res);
            if (!auth)
                return;
            const user = await prisma.user.findUnique({ where: { id: auth.sub } });
            const principal = user ? { id: user.id, isAdmin: isAdminUserRecord(user) } : null;
            if (resolveDataReadAccess(table, principal) !== "admin") {
                return res.status(403).json({ error: "Solo administradores" });
            }
        }
        let rows = [];
        if (table === "products")
            rows = (await readProductsWithCatalogRelations(prisma)).map((row) => serializeProduct(row));
        else if (table === "categories")
            rows = (await prisma.category.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }] })).map((row) => wrap(row));
        else if (table === "profiles")
            rows = (await prisma.user.findMany()).map((row) => serializeUser(row));
        else if (table === "coupons")
            rows = (await prisma.coupon.findMany()).map((row) => serializeCoupon(row));
        else if (table === "coupon_audit")
            rows = [];
        else if (table === "cedula_emails")
            rows = (await prisma.cedulaEmail.findMany()).map((row) => serializeCedulaEmail(row));
        else
            return res.status(404).json({ error: "Tabla no soportada" });
        const filtered = applyFilters(rows, filters);
        const ordered = orderBy ? [...filtered].sort((a, b) => {
            const left = String(a[orderBy] ?? "");
            const right = String(b[orderBy] ?? "");
            return ascending ? left.localeCompare(right) : right.localeCompare(left);
        }) : filtered;
        const sliced = typeof limit === "number" ? ordered.slice(0, limit) : ordered;
        if (single || maybeSingle)
            return res.json(sliced[0] ?? null);
        return res.json(sliced);
    });
    app.post("/api/data/:table", async (req, res) => {
        const { table } = req.params;
        const body = req.body;
        if (table === "categories") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            const rows = Array.isArray(body) ? body : [body];
            const categoryInputs = rows.map((row) => ({ name: String(row.name ?? "").trim(), slug: String(row.slug ?? "").trim().toLowerCase() }));
            if (categoryInputs.some((category) => !category.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category.slug))) {
                return res.status(422).json({ error: "Cada categoría necesita nombre y slug válido" });
            }
            try {
                const saved = await prisma.$transaction(categoryInputs.map((category) => prisma.category.create({ data: category })));
                return res.json(saved.map((category) => wrap(category)));
            }
            catch (error) {
                if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                    return res.status(409).json({ error: "Ya existe una categoría con ese slug" });
                }
                throw error;
            }
        }
        if (table === "products") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            const rows = Array.isArray(body) ? body : [body];
            const productRows = rows;
            const stockInputs = new Map();
            for (const row of productRows) {
                const variants = resolveProductVariants(row);
                try {
                    const productStock = resolveAdminStock(row.stock);
                    if (Object.prototype.hasOwnProperty.call(row, "expectedStock"))
                        resolveAdminStock(row.expectedStock);
                    const variantStocks = new Map();
                    for (const variant of variants ?? []) {
                        variantStocks.set(variant, resolveAdminStock(variant.stock));
                        if (Object.prototype.hasOwnProperty.call(variant, "expectedStock"))
                            resolveAdminStock(variant.expectedStock);
                    }
                    stockInputs.set(row, { productStock, variantStocks });
                }
                catch (error) {
                    return res.status(422).json({ error: error instanceof Error ? error.message : "El stock no es válido" });
                }
            }
            const productIds = productRows.map((row) => String(row.id || crypto.randomUUID()));
            const saved = [];
            try {
                await withProductCatalogBatchTransaction(prisma, productIds, async (transaction) => {
                    for (const [index, row] of productRows.entries()) {
                        const id = productIds[index];
                        const variants = resolveProductVariants(row);
                        const rowStockInputs = stockInputs.get(row);
                        if (!rowStockInputs)
                            throw new Error("No se pudieron validar los valores de stock del producto");
                        const categoryIds = Array.isArray(row.categories)
                            ? Array.from(new Set(row.categories.map((category) => String(category ?? "").trim())))
                            : null;
                        if (categoryIds?.some((categoryId) => !categoryId)) {
                            throw new ProductBatchAbort(422, { error: "Las categorías asignadas deben tener un ID válido" });
                        }
                        if (variants !== null) {
                            const incompleteVariant = variants.find((variant) => variant.price === undefined || variant.price === null);
                            if (incompleteVariant) {
                                throw new ProductBatchAbort(422, {
                                    error: "Cada variante necesita un precio válido antes de guardarse",
                                    variantId: incompleteVariant.id ?? null,
                                });
                            }
                        }
                        const productExclusion = await transaction.productExclusion.findUnique({
                            where: { productId: id },
                            select: { productId: true },
                        });
                        if (productExclusion) {
                            throw new ProductBatchAbort(409, {
                                error: "El producto está excluido por una eliminación anterior y requiere restauración explícita",
                                productId: productExclusion.productId,
                            });
                        }
                        const currentProduct = await transaction.product.findUnique({ where: { id }, select: { stock: true } });
                        const productStockConflict = findStockSnapshotConflict("product", id, row.expectedStock, currentProduct?.stock, rowStockInputs.productStock !== undefined);
                        if (productStockConflict) {
                            const error = productStockConflict.reason === "snapshot-required"
                                ? `Se requiere expectedStock para actualizar el stock del ${productStockConflict.entity}`
                                : productStockConflict.reason === "missing"
                                    ? `El ${productStockConflict.entity} ${productStockConflict.id} ya no existe`
                                    : `El stock del ${productStockConflict.entity} ${productStockConflict.id} cambió desde que se cargó`;
                            throw new ProductBatchAbort(409, { error, ...productStockConflict });
                        }
                        let variantsToSave = variants;
                        if (categoryIds !== null && categoryIds.length > 0) {
                            const existingCategories = await transaction.category.findMany({
                                where: { id: { in: categoryIds } },
                                select: { id: true },
                            });
                            const existingCategoryIds = new Set(existingCategories.map((category) => category.id));
                            const invalidCategoryIds = categoryIds.filter((categoryId) => !existingCategoryIds.has(categoryId));
                            if (invalidCategoryIds.length > 0) {
                                throw new ProductBatchAbort(422, { error: "Una o más categorías no existen", categoryIds: invalidCategoryIds });
                            }
                        }
                        if (variants !== null) {
                            const variantIdsToCheck = variants.map((variant) => String(variant.id ?? "").trim()).filter(Boolean);
                            const existingVariants = variantIdsToCheck.length > 0
                                ? await transaction.productVariant.findMany({
                                    where: { id: { in: variantIdsToCheck } },
                                    select: { id: true, productId: true, stock: true },
                                })
                                : [];
                            const foreignVariant = existingVariants.find((variant) => variant.productId !== id);
                            if (foreignVariant) {
                                throw new ProductBatchAbort(409, {
                                    error: "La variante no pertenece al producto que se está guardando",
                                    variantId: foreignVariant.id,
                                });
                            }
                            const excludedVariants = variantIdsToCheck.length > 0
                                ? await transaction.productVariantExclusion.findMany({
                                    where: { variantId: { in: variantIdsToCheck } },
                                    select: { variantId: true, productId: true },
                                })
                                : [];
                            const excludedForAnotherProduct = excludedVariants.find((variant) => variant.productId !== id);
                            if (excludedForAnotherProduct) {
                                throw new ProductBatchAbort(409, {
                                    error: "La variante no pertenece al producto que se está guardando",
                                    variantId: excludedForAnotherProduct.variantId,
                                });
                            }
                            const excludedVariantIds = new Set(excludedVariants.map((variant) => variant.variantId));
                            variantsToSave = removeExcludedProductVariants(variants, excludedVariantIds);
                            const existingVariantsById = new Map(existingVariants.map((variant) => [variant.id, variant]));
                            for (const variant of variantsToSave) {
                                const variantId = String(variant.id ?? "").trim();
                                const existingVariant = existingVariantsById.get(variantId);
                                const stockConflict = findStockSnapshotConflict("variant", variantId, variant.expectedStock, existingVariant?.productId === id ? existingVariant.stock : undefined, rowStockInputs.variantStocks.get(variant) !== undefined);
                                if (stockConflict) {
                                    const error = stockConflict.reason === "snapshot-required"
                                        ? `Se requiere expectedStock para actualizar el stock del ${stockConflict.entity}`
                                        : stockConflict.reason === "missing"
                                            ? `El ${stockConflict.entity} ${stockConflict.id} ya no existe`
                                            : `El stock del ${stockConflict.entity} ${stockConflict.id} cambió desde que se cargó`;
                                    throw new ProductBatchAbort(409, { error, ...stockConflict });
                                }
                            }
                        }
                        await transaction.product.upsert({
                            where: { id },
                            update: {
                                name: String(row.name ?? ""),
                                category: String(row.category ?? ""),
                                price: parseDecimal(row.price) ?? new Prisma.Decimal(0),
                                oldPrice: parseDecimal(row.oldPrice),
                                badge: row.badge ? String(row.badge) : null,
                                highlight: row.highlight !== undefined ? Boolean(row.highlight) : undefined,
                                ...(rowStockInputs.productStock !== undefined ? { stock: rowStockInputs.productStock } : {}),
                                image: row.image ? String(row.image) : null,
                                description: row.description ? String(row.description) : null,
                                specs: row.specs ?? [],
                                activateWholesale: row.activateWholesale !== undefined ? Boolean(row.activateWholesale) : undefined,
                                wholesaleMinQty: row.wholesaleMinQty !== undefined ? Math.max(0, Number(row.wholesaleMinQty ?? 0)) : undefined,
                                wholesaleDiscountPercent: row.wholesaleDiscountPercent !== undefined ? Math.max(0, Math.min(100, Number(row.wholesaleDiscountPercent ?? 0))) : undefined,
                            },
                            create: {
                                id,
                                name: String(row.name ?? ""),
                                category: String(row.category ?? ""),
                                price: parseDecimal(row.price) ?? new Prisma.Decimal(0),
                                oldPrice: parseDecimal(row.oldPrice),
                                badge: row.badge ? String(row.badge) : null,
                                highlight: row.highlight !== undefined ? Boolean(row.highlight) : false,
                                stock: rowStockInputs.productStock ?? 0,
                                image: row.image ? String(row.image) : null,
                                description: row.description ? String(row.description) : null,
                                specs: row.specs ?? [],
                                activateWholesale: row.activateWholesale !== undefined ? Boolean(row.activateWholesale) : false,
                                wholesaleMinQty: Math.max(0, Number(row.wholesaleMinQty ?? 0)),
                                wholesaleDiscountPercent: Math.max(0, Math.min(100, Number(row.wholesaleDiscountPercent ?? 0))),
                            },
                        });
                        if (categoryIds !== null) {
                            await transaction.productCategory.deleteMany({ where: { productId: id } });
                            if (categoryIds.length > 0) {
                                await transaction.productCategory.createMany({ data: categoryIds.map((categoryId) => ({ productId: id, categoryId })) });
                            }
                        }
                        if (variantsToSave !== null) {
                            const variantIds = [];
                            for (const [sortOrder, variantRow] of variantsToSave.entries()) {
                                const variantId = String(variantRow.id || crypto.randomUUID());
                                variantIds.push(variantId);
                                const variantImageUrls = resolveVariantImageUrls(variantRow);
                                const variantImage = variantImageUrls !== null ? variantImageUrls[0] ?? null : variantRow.image ? String(variantRow.image) : null;
                                const savedVariant = await transaction.productVariant.upsert({
                                    where: { id: variantId, productId: id },
                                    update: {
                                        name: String(variantRow.name ?? "Variante"),
                                        description: variantRow.description ? String(variantRow.description) : null,
                                        price: parseDecimal(variantRow.price) ?? new Prisma.Decimal(0),
                                        ...(rowStockInputs.variantStocks.get(variantRow) !== undefined ? { stock: rowStockInputs.variantStocks.get(variantRow) } : {}),
                                        image: variantImage,
                                        active: variantRow.active !== undefined ? Boolean(variantRow.active) : true,
                                        sortOrder,
                                    },
                                    create: {
                                        id: variantId,
                                        productId: id,
                                        name: String(variantRow.name ?? "Variante"),
                                        description: variantRow.description ? String(variantRow.description) : null,
                                        price: parseDecimal(variantRow.price) ?? new Prisma.Decimal(0),
                                        stock: rowStockInputs.variantStocks.get(variantRow) ?? 0,
                                        image: variantImage,
                                        active: variantRow.active !== undefined ? Boolean(variantRow.active) : true,
                                        sortOrder,
                                    },
                                });
                                if (variantImageUrls !== null) {
                                    await replaceVariantImagesIfChanged(transaction, id, savedVariant.id, variantImageUrls);
                                }
                            }
                            await deleteOmittedProductVariants(transaction, id, variantIds);
                        }
                        if (Array.isArray(row.images)) {
                            const productImageUrls = [];
                            for (const imageRow of row.images) {
                                const url = typeof imageRow === "string" ? imageRow : String(imageRow?.url ?? "").trim();
                                if (url)
                                    productImageUrls.push(url);
                            }
                            await replaceProductImagesIfChanged(transaction, id, productImageUrls);
                        }
                        const savedProduct = await readProductWithCatalogRelations(transaction, id);
                        if (!savedProduct)
                            throw new Error(`No se pudo releer el producto ${id} después de guardarlo`);
                        saved.push(savedProduct);
                    }
                });
            }
            catch (error) {
                if (error instanceof ProductBatchAbort) {
                    return res.status(error.statusCode).json(error.responseBody);
                }
                if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                    return res.status(409).json({ error: "Conflicto de unicidad al guardar el producto o sus variantes" });
                }
                throw error;
            }
            return res.json(saved.map(serializeProduct));
        }
        if (table === "orders") {
            const rows = Array.isArray(body) ? body : [body];
            const saved = [];
            for (const row of rows) {
                const orderId = String(row.id || crypto.randomUUID());
                const rawUserId = row.userId !== undefined ? String(row.userId) : row.user_id !== undefined ? String(row.user_id) : undefined;
                const candidateUserId = rawUserId && rawUserId !== "null" && rawUserId !== "undefined" ? rawUserId : null;
                const resolvedUserId = candidateUserId ? await prisma.user.findUnique({ where: { id: candidateUserId } }).then((user) => user?.id ?? null) : null;
                const normalizedOrderData = {
                    ...normalizeOrderCreateData(row),
                    userId: resolvedUserId ?? null,
                };
                console.log("[orders] processing order", {
                    hasAccount: Boolean(resolvedUserId),
                    itemCount: Array.isArray(normalizedOrderData.items) ? normalizedOrderData.items.length : 0,
                });
                let order;
                try {
                    const requestedStatus = String(row.status ?? "pending");
                    if (requestedStatus !== "pending" && requestedStatus !== "payment_pending") {
                        throw new Error("El estado inicial del pedido no es válido");
                    }
                    order = await prisma.$transaction(async (transaction) => {
                        const existingOrder = await transaction.order.findUnique({ where: { id: orderId } });
                        const pricing = await calculateOrderPricing({
                            items: normalizedOrderData.items,
                            couponCode: row.couponCode !== undefined ? row.couponCode : row.coupon_code,
                            clientShipping: row.shipping,
                            clientDiscountAmount: row.discountAmount !== undefined ? row.discountAmount : row.discount_amount,
                            clientTotal: row.total,
                            reservedItems: existingOrder?.items,
                        }, {
                            findProduct: async (id) => (await transaction.product.findUnique({ where: { id } })),
                            findVariant: async (id) => (await transaction.productVariant.findUnique({ where: { id } })),
                            findCoupon: async (code) => (await transaction.coupon.findUnique({ where: { code } })),
                        });
                        if (existingOrder) {
                            if (existingOrder.status !== "pending" && existingOrder.status !== "payment_pending") {
                                throw new Error("No se puede modificar un pedido que ya avanzó en el pago");
                            }
                            if (!hasSameOrderLines(existingOrder.items, pricing.items)) {
                                throw new Error("No se pueden cambiar las líneas de un pedido existente");
                            }
                        }
                        const pricingData = {
                            items: pricing.items,
                            total: pricing.total,
                            shipping: Number(pricing.shipping),
                            discountAmount: pricing.discountAmount.isZero() ? null : pricing.discountAmount,
                            couponCode: pricing.couponCode,
                        };
                        if (existingOrder) {
                            return transaction.order.update({ where: { id: orderId }, data: pricingData });
                        }
                        await decrementOrderInventory(transaction, pricing.items.map((item) => ({
                            productId: String(item.productId),
                            variantId: item.variantId ? String(item.variantId) : null,
                            quantity: Number(item.quantity),
                        })));
                        return transaction.order.create({ data: { id: orderId, ...normalizedOrderData, status: requestedStatus, ...pricingData } });
                    });
                }
                catch (error) {
                    const errorDetails = error && typeof error === "object"
                        ? error
                        : {};
                    console.error("[orders] prisma.upsert failed", {
                        code: String(error?.code ?? "unknown"),
                    });
                    return res.status(400).json({
                        error: error instanceof Error ? error.message : String(error),
                        code: errorDetails.code,
                        meta: errorDetails.meta,
                    });
                }
                console.log("[orders] order saved", { status: order.status });
                if (revenueStatuses.has(order.status.toLowerCase()) && order.customerEmail && !order.invoiceSentAt) {
                    await sendInvoiceEmail(order);
                    await prisma.order.update({ where: { id: order.id }, data: { invoiceSentAt: new Date() } });
                }
                saved.push(order);
            }
            console.log("[orders] responding", { count: saved.length });
            return res.json(saved.map(serializeOrder));
        }
        if (table === "profiles") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            const rows = Array.isArray(body) ? body : [body];
            const saved = [];
            for (const row of rows) {
                const id = String(row.id || crypto.randomUUID());
                const user = await prisma.user.upsert({
                    where: { id },
                    update: {
                        name: String(row.name ?? "Cliente"),
                        email: String(row.email ?? "").trim().toLowerCase(),
                        cedula: normalizeCedula(String(row.cedula ?? "")),
                        isAdmin: Boolean(row.is_admin ?? row.isAdmin),
                    },
                    create: {
                        id,
                        name: String(row.name ?? "Cliente"),
                        email: String(row.email ?? "").trim().toLowerCase(),
                        password: await createGeneratedPasswordHash(),
                        cedula: normalizeCedula(String(row.cedula ?? "")),
                        isAdmin: Boolean(row.is_admin ?? row.isAdmin),
                    },
                });
                saved.push(user);
            }
            return res.json(saved.map(serializeUser));
        }
        if (table === "coupons") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            const rows = Array.isArray(body) ? body : [body];
            const saved = [];
            for (const row of rows) {
                const couponData = parseCouponData(row);
                if (!couponData.code)
                    continue;
                const coupon = await prisma.coupon.upsert({
                    where: { code: couponData.code },
                    update: couponData,
                    create: couponData,
                });
                saved.push(coupon);
                await recordCouponAudit({
                    couponCode: coupon.code,
                    action: "upsert",
                    performedByUserId: authUser.id,
                    performedByEmail: authUser.email,
                    details: {
                        type: coupon.type,
                        value: coupon.value.toString(),
                        active: coupon.active,
                        minimumSubtotal: coupon.minimumSubtotal?.toString(),
                        expiresAt: coupon.expiresAt?.toISOString(),
                    },
                });
            }
            return res.json(saved.map(serializeCoupon));
        }
        if (table === "cedula_emails") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            const rows = Array.isArray(body) ? body : [body];
            const saved = [];
            for (const row of rows) {
                const savedRow = await prisma.cedulaEmail.upsert({
                    where: { cedula: normalizeCedula(String(row.cedula ?? "")) },
                    update: { email: String(row.email ?? "").trim().toLowerCase(), userId: row.user_id ? String(row.user_id) : null },
                    create: { cedula: normalizeCedula(String(row.cedula ?? "")), email: String(row.email ?? "").trim().toLowerCase(), userId: row.user_id ? String(row.user_id) : null },
                });
                saved.push(savedRow);
            }
            return res.json(saved.map(serializeCedulaEmail));
        }
        return res.status(404).json({ error: "Tabla no soportada" });
    });
    app.patch("/api/data/:table", async (req, res) => {
        const { table } = req.params;
        const filters = parseFilters(req.query.filters);
        const payload = req.body;
        if (table === "categories") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            if (filters.length === 0)
                return res.status(400).json({ error: "Se requiere un filtro para actualizar categorías" });
            const name = payload.name !== undefined ? String(payload.name).trim() : undefined;
            const slug = payload.slug !== undefined ? String(payload.slug).trim().toLowerCase() : undefined;
            if (name === "" || (slug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))) {
                return res.status(422).json({ error: "Nombre o slug de categoría no válido" });
            }
            const rows = await prisma.category.findMany();
            const matched = applyFilters(rows.map((row) => wrap(row)), filters);
            try {
                const updated = await prisma.$transaction(matched.map((row) => prisma.category.update({
                    where: { id: String(row.id) },
                    data: { name, slug },
                })));
                return res.json(updated.map((category) => wrap(category)));
            }
            catch (error) {
                if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                    return res.status(409).json({ error: "Ya existe una categoría con ese slug" });
                }
                throw error;
            }
        }
        if (table === "products") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            const hasExpectedStock = Object.prototype.hasOwnProperty.call(payload, "expectedStock");
            const patchPayload = { ...payload };
            delete patchPayload.expectedStock;
            if (hasExpectedStock && !Object.prototype.hasOwnProperty.call(patchPayload, "stock")) {
                return res.status(400).json({ error: "expectedStock solo se permite cuando se actualiza stock" });
            }
            if (Object.prototype.hasOwnProperty.call(patchPayload, "stock") && !hasExpectedStock) {
                return res.status(400).json({ error: "Se requiere expectedStock para actualizar stock" });
            }
            let expectedStock;
            if (hasExpectedStock) {
                try {
                    expectedStock = resolveAdminStock(payload.expectedStock);
                }
                catch (error) {
                    return res.status(400).json({ error: error instanceof Error ? `expectedStock ${error.message}` : "expectedStock no es válido" });
                }
                if (expectedStock === undefined) {
                    return res.status(400).json({ error: "expectedStock debe ser un entero válido" });
                }
            }
            const patchValidation = validateProductPatch(patchPayload, filters);
            if ("error" in patchValidation)
                return res.status(400).json(patchValidation);
            const productId = patchValidation.filters[0].value;
            const patchResult = await prisma.$transaction(async (transaction) => {
                await lockProductCatalogIds(transaction, [productId]);
                const currentRows = await transaction.product.findMany({ where: { id: productId } });
                const currentMatches = applyFilters(currentRows.map(serializeProduct), patchValidation.filters);
                const target = resolveProductPatchTarget(currentMatches);
                if (target.kind !== "found")
                    return target;
                const stockConflict = findStockSnapshotConflict("product", productId, expectedStock, typeof target.product.stock === "number" ? target.product.stock : undefined, Object.prototype.hasOwnProperty.call(patchPayload, "stock"));
                if (stockConflict)
                    return { kind: "stock-conflict", conflict: stockConflict };
                const product = await transaction.product.update({ where: { id: productId }, data: patchValidation.data });
                return { kind: "updated", product };
            });
            if (patchResult.kind === "not-found") {
                return res.status(404).json({ error: "No existe un producto con el ID indicado", productId });
            }
            if (patchResult.kind === "non-unique") {
                throw new Error(`El filtro ID devolvió más de un producto: ${productId}`);
            }
            if (patchResult.kind === "stock-conflict") {
                return res.status(409).json({
                    error: "El stock del producto cambió desde que se cargó",
                    ...patchResult.conflict,
                });
            }
            return res.json([serializeProduct(patchResult.product)]);
        }
        if (table === "orders") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            if (Object.keys(payload).some((key) => key !== "status") || payload.status === undefined) {
                return res.status(400).json({ error: "Esta ruta solo permite actualizar el estado del pedido" });
            }
            if (typeof payload.status !== "string" || !allowedOrderStatuses.has(payload.status)) {
                return res.status(400).json({ error: "Estado de pedido no válido" });
            }
            const rows = await prisma.order.findMany();
            const matched = applyFilters(rows.map(serializeOrder), filters);
            const updated = [];
            for (const row of matched) {
                const existing = await prisma.order.findUnique({ where: { id: String(row.id) } });
                const next = await prisma.order.update({
                    where: { id: String(row.id) },
                    data: normalizeOrderUpdateData(payload),
                });
                if (existing && !revenueStatuses.has(existing.status.toLowerCase()) && revenueStatuses.has(next.status.toLowerCase()) && next.customerEmail) {
                    try {
                        await sendInvoiceEmail(next);
                        await prisma.order.update({ where: { id: next.id }, data: { invoiceSentAt: new Date() } });
                    }
                    catch (error) {
                        console.error("Error enviando factura");
                    }
                }
                updated.push(next);
            }
            return res.json(updated.map(serializeOrder));
        }
        if (table === "profiles") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            if (filters.length === 0)
                return res.status(400).json({ error: "Se requiere un filtro para actualizar perfiles" });
            const rows = await prisma.user.findMany();
            const matched = applyFilters(rows.map(serializeUser), filters);
            const updated = [];
            for (const row of matched) {
                const nextName = payload.name !== undefined ? String(payload.name) : undefined;
                const nextEmail = payload.email !== undefined ? String(payload.email).trim().toLowerCase() : undefined;
                const nextCedula = payload.cedula !== undefined ? normalizeCedula(String(payload.cedula)) : undefined;
                const nextIsAdmin = payload.is_admin !== undefined ? Boolean(payload.is_admin) : payload.isAdmin !== undefined ? Boolean(payload.isAdmin) : undefined;
                const next = await prisma.user.update({
                    where: { id: String(row.id) },
                    data: {
                        name: nextName,
                        email: nextEmail,
                        cedula: nextCedula,
                        isAdmin: nextIsAdmin,
                    },
                });
                updated.push(next);
            }
            return res.json(updated.map(serializeUser));
        }
        if (table === "coupons") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            const rows = await prisma.coupon.findMany();
            const matched = applyFilters(rows.map(serializeCoupon), filters);
            const updated = [];
            for (const row of matched) {
                const next = await prisma.coupon.update({
                    where: { code: String(row.code) },
                    data: {
                        ...payload,
                        value: payload.value !== undefined ? parseDecimal(payload.value) ?? undefined : undefined,
                        minimumSubtotal: payload.minimumSubtotal !== undefined ? parseDecimal(payload.minimumSubtotal) ?? undefined : undefined,
                        expiresAt: payload.expiresAt !== undefined ? (payload.expiresAt ? new Date(String(payload.expiresAt)) : null) : undefined,
                        active: payload.active !== undefined ? Boolean(payload.active) : undefined,
                    },
                });
                updated.push(next);
                await recordCouponAudit({
                    couponCode: next.code,
                    action: "update",
                    performedByUserId: authUser.id,
                    performedByEmail: authUser.email,
                    details: {
                        changed: payload,
                    },
                });
            }
            return res.json(updated.map(serializeCoupon));
        }
        return res.status(404).json({ error: "Tabla no soportada" });
    });
    app.delete("/api/data/:table", async (req, res) => {
        const { table } = req.params;
        const filters = parseFilters(req.query.filters);
        if (table === "categories") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            if (filters.length === 0)
                return res.status(400).json({ error: "Se requiere un filtro para eliminar categorías" });
            const rows = await prisma.category.findMany();
            const matched = applyFilters(rows.map((row) => wrap(row)), filters);
            const categoryIds = matched.map((row) => String(row.id));
            const deletion = categoryIds.length
                ? await prisma.$transaction(async (transaction) => {
                    const lockedCategories = await transaction.$queryRaw(Prisma.sql `
          SELECT "id"
          FROM "public"."Category"
          WHERE "id" IN (${Prisma.join(categoryIds)})
          FOR UPDATE
        `);
                    const lockedCategoryIds = lockedCategories.map((category) => category.id);
                    const assignmentCount = lockedCategoryIds.length
                        ? await transaction.productCategory.count({ where: { categoryId: { in: lockedCategoryIds } } })
                        : 0;
                    if (assignmentCount > 0)
                        return { conflict: true, deleted: 0 };
                    const deleted = lockedCategoryIds.length
                        ? await transaction.category.deleteMany({ where: { id: { in: lockedCategoryIds } } })
                        : { count: 0 };
                    return { conflict: false, deleted: deleted.count };
                })
                : { conflict: false, deleted: 0 };
            if (deletion.conflict) {
                return res.status(409).json({ error: "No se puede eliminar una categoría que está asignada a productos" });
            }
            return res.json({ deleted: deletion.deleted });
        }
        if (table === "products") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            const productDeleteFilters = parseProductDeleteFilters(req.query.filters);
            if (!productDeleteFilters)
                return res.status(400).json({ error: "Se requieren filtros de producto válidos para eliminar" });
            const rows = await prisma.product.findMany();
            const matched = applyFilters(rows.map(serializeProduct), productDeleteFilters);
            const matchedProductIds = matched.map((row) => String(row.id));
            const explicitlyRequestedIds = productDeleteFilters.length === 1 && productDeleteFilters[0].column === "id"
                ? [productDeleteFilters[0].value]
                : [];
            const productIds = Array.from(new Set([...matchedProductIds, ...explicitlyRequestedIds]));
            if (productIds.length === 0)
                return res.json({ deleted: 0 });
            const deletedCount = await prisma.$transaction((transaction) => deleteProductsWithExclusions(transaction, productIds));
            return res.json({ deleted: deletedCount });
        }
        if (table === "orders") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            if (filters.length === 0)
                return res.status(400).json({ error: "Se requiere un filtro para eliminar pedidos" });
            const rows = await prisma.order.findMany();
            const matched = applyFilters(rows.map(serializeOrder), filters);
            for (const row of matched)
                await prisma.order.delete({ where: { id: String(row.id) } });
            return res.json({ deleted: matched.length });
        }
        if (table === "profiles") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            if (filters.length === 0)
                return res.status(400).json({ error: "Se requiere un filtro para eliminar perfiles" });
            const rows = await prisma.user.findMany();
            const matched = applyFilters(rows.map(serializeUser), filters);
            for (const row of matched)
                await prisma.user.delete({ where: { id: String(row.id) } });
            return res.json({ deleted: matched.length });
        }
        if (table === "coupons") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            const rows = await prisma.coupon.findMany();
            const matched = applyFilters(rows.map(serializeCoupon), filters);
            for (const row of matched) {
                await prisma.coupon.delete({ where: { code: String(row.code) } });
                await recordCouponAudit({
                    couponCode: String(row.code),
                    action: "delete",
                    performedByUserId: authUser.id,
                    performedByEmail: authUser.email,
                    details: { deleted: true },
                });
            }
            return res.json({ deleted: matched.length });
        }
        if (table === "cedula_emails") {
            const authUser = await requireAdmin(req, res);
            if (!authUser)
                return;
            if (filters.length === 0)
                return res.status(400).json({ error: "Se requiere un filtro para eliminar asociaciones de cédula" });
            const rows = await prisma.cedulaEmail.findMany();
            const matched = applyFilters(rows.map(serializeCedulaEmail), filters);
            for (const row of matched)
                await prisma.cedulaEmail.delete({ where: { cedula: String(row.cedula) } });
            return res.json({ deleted: matched.length });
        }
        return res.status(404).json({ error: "Tabla no soportada" });
    });
    app.post("/api/storage/upload", async (req, res) => {
        const { path: filePath, contentBase64, mimeType } = req.body;
        if (!filePath || !contentBase64)
            return res.status(400).json({ error: "path y contentBase64 son requeridos" });
        const fullPath = path.join(uploadsDir, filePath);
        await mkdir(path.dirname(fullPath), { recursive: true });
        const content = contentBase64.includes(",") ? contentBase64.split(",").at(-1) ?? contentBase64 : contentBase64;
        await writeFile(fullPath, Buffer.from(content, "base64"));
        return res.json({ path: filePath, publicUrl: `${req.protocol}://${req.get("host")}/uploads/${filePath}`, mimeType: mimeType ?? "application/octet-stream" });
    });
    app.get("/api/functions/mp-webhook", async (req, res) => {
        console.info("Mercado Pago webhook received", { method: req.method });
        return res.status(200).json({ ok: true, received: true });
    });
    app.post("/api/functions/mp-webhook", async (req, res) => {
        console.info("Mercado Pago webhook received", { method: req.method });
        return res.status(200).json({ ok: true, received: true });
    });
    app.post("/api/functions/check-mp-methods", async (_req, res) => {
        // Prefer the server access token; fall back to client token only if server token is absent.
        const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN ?? process.env.MERCADOPAGO_ACCESS_TOKEN_CLIENT;
        if (!accessToken)
            return res.status(500).json({ error: "mercadopago_token_missing", message: "MERCADOPAGO_ACCESS_TOKEN (server) o MERCADOPAGO_ACCESS_TOKEN_CLIENT (client) no está configurado" });
        try {
            const methodsResponse = await fetch("https://api.mercadopago.com/v1/payment_methods", {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            const methodsData = await methodsResponse.json();
            if (!methodsResponse.ok) {
                return res.status(methodsResponse.status).json({ error: "mp_error", details: methodsData });
            }
            const methods = Array.isArray(methodsData) ? methodsData.map((method) => ({ id: method.id, name: method.name })) : [];
            return res.json({ methods });
        }
        catch (error) {
            console.error("Could not check MP payment methods");
            return res.status(500).json({ error: "mp_error", message: error instanceof Error ? error.message : String(error) });
        }
    });
    app.post("/api/functions/redeem-coupon", async (req, res) => {
        const auth = requireAuth(req, res);
        if (!auth)
            return;
        const { code, subtotal = 0, shipping = 0 } = req.body;
        if (!code) {
            return res.status(400).json({ error: "Se requiere el código del cupón" });
        }
        const normalizedCode = String(code).trim().toUpperCase();
        const coupon = await prisma.coupon.findUnique({ where: { code: normalizedCode } });
        if (!coupon) {
            return res.status(404).json({ error: "Cupón no encontrado" });
        }
        if (!coupon.active) {
            return res.status(409).json({ error: "El cupón ya no está activo" });
        }
        if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
            return res.status(409).json({ error: "El cupón ha expirado" });
        }
        const minimumSubtotal = coupon.minimumSubtotal ? Number(coupon.minimumSubtotal) : null;
        if (minimumSubtotal !== null && Number(subtotal) < minimumSubtotal) {
            return res.status(409).json({ error: `Este cupón requiere un subtotal mínimo de ${minimumSubtotal}` });
        }
        const discount = coupon.type === "percent"
            ? Math.round((Number(subtotal) + Number(shipping)) * (Number(coupon.value) / 100))
            : Number(coupon.value || 0);
        return res.json({
            ok: true,
            coupon: {
                code: coupon.code,
                type: coupon.type,
                value: Number(coupon.value),
                minimumSubtotal: minimumSubtotal ?? null,
                expiresAt: coupon.expiresAt?.toISOString() ?? null,
            },
            discount: Math.min(discount, Number(subtotal) + Number(shipping)),
        });
    });
    app.post("/api/functions/normalize-legacy-variants", async (req, res) => {
        const authUser = await requireAdmin(req, res);
        if (!authUser)
            return;
        const body = req.body;
        const legacyProducts = Array.isArray(body.products) ? body.products : [];
        const report = { products: 0, legacy: 0, existing: 0, excluded: 0, excludedProducts: 0, created: 0, missingValues: [], conflicts: [] };
        const planned = [];
        for (const product of legacyProducts) {
            const productId = String(product.id ?? "").trim();
            if (!productId)
                continue;
            if (await prisma.productExclusion.findUnique({ where: { productId }, select: { productId: true } })) {
                report.excludedProducts += 1;
                continue;
            }
            if (!(await prisma.product.findUnique({ where: { id: productId }, select: { id: true } })))
                continue;
            report.products += 1;
            for (const [index, legacy] of (Array.isArray(product.variants) ? product.variants : []).entries()) {
                const variantId = String(legacy.id ?? "").trim();
                if (!variantId)
                    continue;
                report.legacy += 1;
                const exclusion = await prisma.productVariantExclusion.findUnique({ where: { variantId }, select: { productId: true } });
                if (exclusion) {
                    report.excluded += 1;
                    planned.push({ productId, variantId, name: String(legacy.name ?? "Subproducto"), description: legacy.description ? String(legacy.description) : null, image: legacy.image ? String(legacy.image) : null, price: legacy.price, stock: legacy.stock, active: legacy.active, sortOrder: Number(legacy.sortOrder ?? index), action: "excluded" });
                    if (exclusion.productId !== productId)
                        report.conflicts.push(`${variantId}: está excluida para ${exclusion.productId}, no para ${productId}`);
                    continue;
                }
                if (legacy.price === undefined || legacy.stock === undefined)
                    report.missingValues.push(`${productId}/${variantId}`);
                const existing = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { id: true, productId: true } });
                if (existing) {
                    report.existing += 1;
                    if (existing.productId !== productId)
                        report.conflicts.push(`${variantId}: pertenece a ${existing.productId}, no a ${productId}`);
                }
                planned.push({ productId, variantId, name: String(legacy.name ?? "Subproducto"), description: legacy.description ? String(legacy.description) : null, image: legacy.image ? String(legacy.image) : null, price: legacy.price, stock: legacy.stock, active: legacy.active, sortOrder: Number(legacy.sortOrder ?? index), action: existing ? "existing" : "create" });
            }
        }
        if (body.dryRun !== false)
            return res.json({ ok: true, dryRun: true, report, planned });
        if (report.conflicts.length)
            return res.status(409).json({ error: "Hay IDs legacy en conflicto", report, planned });
        if (report.missingValues.length)
            return res.status(422).json({ error: "Faltan precios o stocks reales para algunas variantes legacy", report, planned });
        for (const item of planned) {
            if (item.action === "existing")
                continue;
            if (item.action === "excluded")
                continue;
            const result = await prisma.$transaction((transaction) => createLegacyVariantUnlessExcluded(transaction, {
                productId: item.productId,
                variantId: item.variantId,
                name: item.name,
                description: item.description,
                image: item.image,
                price: item.price,
                stock: item.stock,
                active: item.active,
                sortOrder: item.sortOrder,
            }));
            if (result === "created")
                report.created += 1;
            if (result === "excluded-variant")
                report.excluded += 1;
            if (result === "excluded-product")
                report.excludedProducts += 1;
        }
        return res.json({ ok: true, dryRun: false, report });
    });
    app.post("/api/payments/create-wompi-payment", async (req, res) => {
        let attemptId = null;
        try {
            const body = req.body;
            const providedReferences = [body.reference, body.referencePedido, body.orderId]
                .filter((value) => value !== undefined && value !== null);
            const references = providedReferences.map((value) => typeof value === "string" ? value.trim() : "");
            if (references.length === 0 || references.some((reference) => !reference) || new Set(references).size !== 1) {
                return res.status(400).json({ error: "Se requiere una única referencia de pedido válida" });
            }
            const requestReference = references[0];
            const reservation = await reserveWompiPaymentAttempt(prisma, requestReference, {
                reference: requestReference,
                total: body.total,
                currency: body.currency,
            });
            if (reservation.kind === "not_found")
                return res.status(404).json({ error: "order_not_found" });
            if (reservation.kind === "not_payable")
                return res.status(409).json({ error: reservation.reason });
            if (reservation.kind === "invalid_request") {
                return res.status(409).json({ error: "payment_order_mismatch", reason: reservation.reason });
            }
            if (reservation.kind === "blocked") {
                return res.status(409).json({ error: reservation.reason, attemptId: reservation.attempt.id });
            }
            if (reservation.kind === "existing") {
                const { attempt } = reservation;
                if (!attempt.paymentLinkId) {
                    await prisma.wompiPaymentAttempt.update({
                        where: { id: attempt.id },
                        data: { status: "REVIEW", resolutionNote: "link_created_attempt_missing_provider_link_id" },
                    });
                    return res.status(409).json({ error: "payment_requires_review", attemptId: attempt.id });
                }
                if (attempt.paymentLinkId.startsWith("LOCAL-")) {
                    return res.json({
                        success: true,
                        reused: true,
                        paymentLinkId: attempt.paymentLinkId,
                        paymentUrl: attempt.paymentUrl,
                        reference: reservation.order.id,
                        orderId: reservation.order.id,
                        attemptId: attempt.id,
                    });
                }
                const knownLink = await readWompiPaymentLink(attempt.paymentLinkId);
                if (!knownLink.active ||
                    !knownLink.expiresAt ||
                    knownLink.expiresAt <= new Date() ||
                    knownLink.reference !== attempt.reference ||
                    knownLink.amountInCents !== Number(attempt.amountInCents) ||
                    knownLink.currency !== attempt.currency) {
                    await prisma.wompiPaymentAttempt.updateMany({
                        where: { id: attempt.id, status: "LINK_CREATED" },
                        data: { status: "REVIEW", resolutionNote: "known_link_not_confirmed_active_and_unexpired" },
                    });
                    return res.status(409).json({ error: "payment_requires_review", attemptId: attempt.id });
                }
                return res.json({
                    success: true,
                    reused: true,
                    paymentLinkId: attempt.paymentLinkId,
                    paymentUrl: knownLink.paymentUrl,
                    reference: reservation.order.id,
                    orderId: reservation.order.id,
                    attemptId: attempt.id,
                    status: "PENDING",
                    transactionId: null,
                });
            }
            attemptId = reservation.attempt.id;
            const sendingAttempt = await markWompiAttemptSending(prisma, attemptId);
            if (!sendingAttempt) {
                return res.status(409).json({ error: "payment_attempt_already_claimed", attemptId });
            }
            const snapshot = sendingAttempt.snapshot;
            const orderItems = Array.isArray(snapshot.items) ? snapshot.items : [];
            const products = orderItems.flatMap((item) => {
                if (!item || typeof item !== "object" || Array.isArray(item))
                    return [];
                const line = item;
                const quantity = Number(line.quantity);
                const unitPrice = Number(line.unit_price);
                if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0)
                    return [];
                return [{
                        id: String(line.productId ?? ""),
                        name: String(line.title ?? "Producto"),
                        quantity,
                        unit_price: unitPrice,
                        variantId: line.variantId ? String(line.variantId) : null,
                    }];
            });
            const created = await createWompiTransaction({
                products,
                total: Number(sendingAttempt.amountInCents) / 100,
                currency: sendingAttempt.currency,
                reference: sendingAttempt.reference,
                customerEmail: reservation.order.customerEmail ?? "",
                customerName: reservation.order.customerName ?? "",
                customerPhone: reservation.order.customerPhone ?? "",
                paymentMethod: body.paymentMethod ?? body.payment_method,
                redirectUrl: body.redirectUrl ?? body.redirect_url,
            });
            const transaction = created.transaction;
            const wompiStatus = typeof transaction?.status === "string" ? transaction.status : "PENDING";
            const returnedPaymentUrl = created.paymentUrl || null;
            const paymentMethod = normalizeWompiPaymentMethod(body.paymentMethod ?? body.payment_method) ?? "CARD";
            if (!created.paymentLinkId) {
                const simulatedId = typeof transaction?.id === "string" && transaction.id.startsWith("LOCAL-")
                    ? transaction.id
                    : null;
                if (simulatedId) {
                    await prisma.wompiPaymentAttempt.updateMany({
                        where: { id: attemptId, status: "SENDING" },
                        data: { status: "CLOSED", paymentLinkId: simulatedId, resolutionNote: "development_simulation_only" },
                    });
                }
                else {
                    await markWompiAttemptUncertain(prisma, attemptId, "provider_response_missing_payment_link_id");
                    return res.status(502).json({ error: "payment_result_uncertain", attemptId });
                }
            }
            else {
                const data = created.payload.data;
                const expiresAtValue = typeof data?.expires_at === "string" ? data.expires_at : "";
                const parsedExpiry = expiresAtValue ? new Date(expiresAtValue) : null;
                await recordWompiAttemptLink(prisma, attemptId, {
                    paymentLinkId: created.paymentLinkId,
                    paymentUrl: returnedPaymentUrl ?? `https://checkout.wompi.co/l/${encodeURIComponent(created.paymentLinkId)}`,
                    expiresAt: parsedExpiry && Number.isFinite(parsedExpiry.getTime()) ? parsedExpiry : null,
                });
            }
            const externalRedirectMethods = new Set(["NEQUI", "DAVIPLATA", "PSE"]);
            const pendingWithoutPaymentUrl = Boolean(!returnedPaymentUrl && wompiStatus.toUpperCase() === "PENDING" && externalRedirectMethods.has(paymentMethod));
            const safeTransaction = transaction ? {
                id: typeof transaction.id === "string" ? transaction.id : null,
                status: wompiStatus,
                payment_method_type: typeof transaction.payment_method_type === "string" ? transaction.payment_method_type : null,
            } : null;
            const responseBody = {
                success: true,
                paymentLinkId: created.paymentLinkId ?? null,
                transactionId: null,
                attemptId,
                wompiReference: sendingAttempt.reference,
                reference: reservation.order.id,
                orderId: reservation.order.id,
                status: wompiStatus,
                paymentUrl: returnedPaymentUrl || null,
                pendingWithoutPaymentUrl,
                transaction: safeTransaction,
                methods: created.methods,
            };
            console.log("[wompi] payment link created", { created: Boolean(created.paymentLinkId), paymentMethod });
            return res.json(responseBody);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const errorStatus = Number(error.status);
            if (attemptId) {
                try {
                    if (errorStatus >= 400 && errorStatus < 500) {
                        await prisma.wompiPaymentAttempt.updateMany({
                            where: { id: attemptId, status: "SENDING" },
                            data: { status: "REJECTED", resolutionNote: `provider_rejected_request_${errorStatus}` },
                        });
                    }
                    else {
                        await markWompiAttemptUncertain(prisma, attemptId, "provider_result_not_durably_confirmed");
                    }
                }
                catch (persistenceError) {
                    console.error("[wompi] could not update attempt after provider error", {
                        attemptId,
                        error: persistenceError instanceof Error ? persistenceError.name : "unknown",
                    });
                }
            }
            console.error("[wompi] payment creation failed", {
                status: Number.isInteger(errorStatus) ? errorStatus : null,
                code: String(error.code ?? "payment_creation_failed"),
            });
            if (message === "required_fields_missing") {
                const missingFields = error.missingFields ?? [];
                return res.status(422).json({ error: "campo requerido faltante", missingFields });
            }
            if (errorStatus === 422) {
                return res.status(422).json({ error: "wompi_unprocessable", message });
            }
            if (errorStatus === 503) {
                return res.status(503).json({ error: "payment_provider_not_configured", message: "El servicio de pagos no está configurado correctamente." });
            }
            return res.status(500).json({ error: "wompi_error", message: "No se pudo iniciar el pago. Intenta nuevamente." });
        }
    });
    app.post("/api/admin/payments/wompi-attempts/:attemptId/resolve", async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin)
            return;
        const attemptId = String(req.params.attemptId ?? "").trim();
        const action = String(req.body?.action ?? "").trim();
        const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
        const evidenceReference = typeof req.body?.evidenceReference === "string" ? req.body.evidenceReference.trim() : "";
        const paymentLinkId = typeof req.body?.paymentLinkId === "string" ? req.body.paymentLinkId.trim() : "";
        if (!attemptId || !["link_confirmed", "no_transaction_confirmed"].includes(action)) {
            return res.status(400).json({ error: "invalid_resolution_request" });
        }
        if (note.length < 10 || evidenceReference.length < 4 || note.length > 2000 || evidenceReference.length > 500) {
            return res.status(400).json({ error: "resolution_evidence_required" });
        }
        try {
            const attempt = await prisma.wompiPaymentAttempt.findUnique({ where: { id: attemptId } });
            if (!attempt)
                return res.status(404).json({ error: "payment_attempt_not_found" });
            if (!["UNCERTAIN", "REVIEW"].includes(attempt.status)) {
                return res.status(409).json({ error: "payment_attempt_not_resolvable", status: attempt.status });
            }
            let verifiedLink = null;
            if (action === "link_confirmed") {
                if (!paymentLinkId)
                    return res.status(400).json({ error: "payment_link_id_required" });
                verifiedLink = await readWompiPaymentLink(paymentLinkId);
                if (!verifiedLink.active ||
                    !verifiedLink.expiresAt ||
                    verifiedLink.expiresAt <= new Date() ||
                    verifiedLink.reference !== attempt.reference ||
                    verifiedLink.amountInCents !== Number(attempt.amountInCents) ||
                    verifiedLink.currency !== attempt.currency) {
                    return res.status(409).json({ error: "payment_link_evidence_mismatch" });
                }
            }
            const resolved = await prisma.$transaction(async (tx) => {
                await tx.$queryRaw `
        SELECT "id" FROM "Order" WHERE "id" = ${attempt.orderId} FOR UPDATE
      `;
                const current = await tx.wompiPaymentAttempt.findUnique({ where: { id: attemptId } });
                if (!current || !["UNCERTAIN", "REVIEW"].includes(current.status))
                    return null;
                const nextStatus = action === "link_confirmed" ? "LINK_CREATED" : "CLOSED";
                const update = await tx.wompiPaymentAttempt.updateMany({
                    where: { id: attemptId, status: current.status },
                    data: {
                        status: nextStatus,
                        resolutionNote: note,
                        ...(verifiedLink ? {
                            paymentLinkId,
                            paymentUrl: verifiedLink.paymentUrl,
                            expiresAt: verifiedLink.expiresAt,
                        } : {}),
                    },
                });
                if (update.count !== 1)
                    return null;
                await tx.wompiPaymentAttemptResolution.create({
                    data: {
                        attemptId,
                        performedByUserId: admin.id,
                        previousStatus: current.status,
                        nextStatus,
                        evidenceReference,
                        note,
                    },
                });
                return { nextStatus };
            });
            if (!resolved)
                return res.status(409).json({ error: "payment_attempt_changed_during_resolution" });
            console.info("[wompi] payment attempt manually resolved", { attemptId, action, adminId: admin.id });
            return res.json({ ok: true, attemptId, status: resolved.nextStatus });
        }
        catch (error) {
            console.error("[wompi] payment attempt resolution failed", {
                attemptId,
                error: error instanceof Error ? error.name : "unknown",
            });
            return res.status(500).json({ error: "payment_attempt_resolution_failed" });
        }
    });
    app.post("/api/payments/wompi/webhook", async (req, res) => {
        const event = req.body;
        const checksumHeader = req.headers["x-event-checksum"];
        if (!verifyWompiEventSignature(event, checksumHeader)) {
            console.warn("Wompi webhook signature rejected", {
                method: req.method,
                path: req.path,
                hasChecksum: Boolean(checksumHeader),
            });
            return res.status(401).json({ error: "invalid_signature" });
        }
        try {
            const rawBody = req.rawBody ?? JSON.stringify(event);
            const receipt = await persistWompiWebhookReceipt(prisma, rawBody, event);
            return res.status(200).json({ ok: true, accepted: true, duplicate: receipt.duplicate });
        }
        catch (error) {
            console.error("[wompi webhook] durable receipt persistence failed", {
                error: error instanceof Error ? error.name : "unknown",
            });
            return res.status(500).json({ error: "wompi_error" });
        }
    });
    // Status lookups are read-only and use only a known provider transaction ID.
    app.get("/api/payments/transaction-status", async (req, res) => {
        try {
            const orderId = String(req.query.orderId ?? "").trim();
            let transactionId = String(req.query.transactionId ?? "").trim();
            let orderExists = null;
            if (orderId && !transactionId) {
                const order = await prisma.order.findUnique({ where: { id: orderId } });
                orderExists = Boolean(order);
                transactionId = String(order?.wompiTransactionId ?? "").trim();
            }
            const { baseUrl } = getWompiConfig();
            let payload = {};
            let transaction = {};
            const lookupId = transactionId;
            const lookupMode = "transaction-id";
            let lookupErrorType = null;
            if (lookupId) {
                const response = await fetch(`${baseUrl}/transactions/${encodeURIComponent(lookupId)}`, { headers: buildWompiAuthorizationHeader() });
                const text = await response.text();
                try {
                    payload = text ? asRecord(JSON.parse(text)) : {};
                }
                catch {
                    payload = { raw: text };
                }
                transaction = asRecord(payload.data ?? payload);
                lookupErrorType = asRecord(payload.error).type?.toString() ?? null;
            }
            if (!lookupId) {
                if (orderExists === false)
                    return res.status(404).json({ error: "order_not_found" });
                if (orderId) {
                    return res.json({
                        ok: true,
                        transaction: null,
                        status: "PENDING",
                        mappedStatus: "payment_pending",
                        orderId,
                        paymentMethod: null,
                        pendingWithoutPaymentUrl: false,
                        reason: "transaction_id_not_available",
                        transactionNotFound: false,
                        lookupMode: "transaction-id",
                        lookupId: null,
                    });
                }
                return res.status(400).json({ error: "missing_transaction_id", message: "transactionId or orderId with a stored transaction ID is required" });
            }
            const isTransactionNotFound = !Object.keys(transaction).length || Boolean(lookupErrorType?.toUpperCase().includes("NOT_FOUND"));
            const wompiStatus = String(transaction?.status ?? "").trim();
            const orderStatus = mapWompiStatusToOrderStatus(wompiStatus) || null;
            const normalizedPaymentMethod = normalizeWompiPaymentMethod(String(transaction?.payment_method_type ?? transaction?.payment_method ?? transaction?.type ?? "")) ?? undefined;
            const externalRedirectMethods = new Set(["NEQUI", "DAVIPLATA", "PSE"]);
            const rawPaymentUrl = String(transaction?.next_action?.redirect_to_url
                ?? transaction?.redirect_url
                ?? transaction?.checkout_url
                ?? transaction?.payment_url
                ?? "").trim();
            const pendingWithoutPaymentUrl = Boolean(!rawPaymentUrl && String(wompiStatus).toUpperCase() === "PENDING" && externalRedirectMethods.has(String(normalizedPaymentMethod ?? "").toUpperCase()));
            const reconciliationState = isTransactionNotFound
                ? { status: "payment_pending", mappedStatus: "payment_pending", reason: "transaction_not_found" }
                : { status: wompiStatus || "PENDING", mappedStatus: orderStatus, reason: "transaction_lookup" };
            if (pendingWithoutPaymentUrl) {
                console.warn('[wompi] transaction-status: pending without payment URL', { paymentMethod: normalizedPaymentMethod, status: wompiStatus, lookupMode });
            }
            const safeTransaction = Object.fromEntries(["id", "reference", "status", "amount_in_cents", "currency", "payment_method_type", "payment_method", "type"]
                .flatMap((key) => transaction[key] === undefined ? [] : [[key, transaction[key]]]));
            return res.json({ ok: true, transaction: safeTransaction, status: reconciliationState.status, mappedStatus: reconciliationState.mappedStatus, orderId: orderId || null, paymentMethod: normalizedPaymentMethod?.toLowerCase() ?? null, pendingWithoutPaymentUrl, reason: reconciliationState.reason, transactionNotFound: isTransactionNotFound, lookupMode, lookupId });
        }
        catch (error) {
            console.error("Failed to fetch Wompi transaction status");
            return res.status(500).json({ error: 'wompi_error', message: error instanceof Error ? error.message : String(error) });
        }
    });
    app.post("/api/functions/create-mp-preference", async (req, res) => {
        const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
        if (!accessToken)
            return res.status(500).json({ error: "mercadopago_token_missing", message: "MERCADOPAGO_ACCESS_TOKEN no está configurado" });
        const body = req.body;
        if (!body.orderId || !body.items?.length)
            return res.status(400).json({ error: "items y orderId son requeridos" });
        const preference = buildMercadoPagoPreferencePayload(body, "");
        if (body.shipping && body.shipping > 0) {
            preference.items.push({
                id: "shipping",
                title: "Envío",
                quantity: 1,
                unit_price: Math.round(body.shipping),
                currency_id: "COP",
            });
        }
        if (body.preferredPayment) {
            try {
                const methodsResponse = await fetch("https://api.mercadopago.com/v1/payment_methods", {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
                const methodsData = await methodsResponse.json();
                const preferredMethodId = resolvePreferredPaymentMethod(Array.isArray(methodsData) ? methodsData : [], body.preferredPayment);
                if (!preferredMethodId) {
                    return res.status(422).json({ error: "payment_method_not_available", message: `El método ${body.preferredPayment} no está habilitado en la cuenta de Mercado Pago.` });
                }
                preference.payment_methods = { default_payment_method_id: preferredMethodId };
            }
            catch (err) {
                console.warn("Could not resolve preferred Mercado Pago payment method", err);
            }
        }
        const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(preference),
        });
        const text = await response.text().catch(() => "");
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        }
        catch {
            data = { raw: text };
        }
        if (!response.ok) {
            const tokenSource = process.env.MERCADOPAGO_ACCESS_TOKEN ? "server" : "none";
            console.error("Mercado Pago preference creation failed", {
                status: response.status,
                tokenConfigured: Boolean(accessToken),
                tokenSource,
            });
            return res.status(response.status).json({
                error: String(data.message || "Error creando preferencia"),
                details: data,
                fallback: "No pudimos iniciar el pago. Puedes completar tu pedido por WhatsApp.",
            });
        }
        return res.json({ id: data.id, init_point: data.init_point, sandbox_init_point: data.sandbox_init_point });
    });
    return app;
};
