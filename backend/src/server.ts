import express from "express";
import cors from "cors";
import { Prisma, type PrismaClient, type Product, type Order, type User, type Coupon, type CedulaEmail, type UserAddress } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { resolvePreferredPaymentMethod } from "./lib/mercadopago.js";
import { isAllowedCorsOrigin } from "./lib/cors.js";
import { calculateOrderPricing, hasSameOrderLines, type OrderPricingRepository } from "./lib/order-pricing.js";
import { decrementOrderInventory } from "./lib/order-inventory.js";
import { buildMercadoPagoPreferencePayload } from "./lib/mercadopagoPreference.js";
import { isAdminUserRecord } from "./lib/auth.js";
import { canLookupCedulaEmail, canManagePrivateData, canSyncProfile, hasAdminRoleMutation, resolveDataReadAccess } from "./lib/access-control.js";
import { buildWompiAuthorizationHeader, extractWebhookSignature, extractWompiMerchantMethods, getWompiConfig, mapWompiStatusToOrderStatus, normalizePhoneNumber, normalizeWompiPaymentMethod, verifyWompiEventSignature } from "./lib/wompi.js";
import { wrap } from "./lib/serialize.js";
import { createLegacyVariantUnlessExcluded, deleteProductsWithExclusions } from "./lib/product-exclusions.js";
import { lockProductCatalogIds } from "./lib/productCatalogLock.js";
import { deleteOmittedProductVariants, findStockSnapshotConflict, readProductWithCatalogRelations, readProductsWithCatalogRelations, removeExcludedProductVariants, replaceProductImagesIfChanged, replaceVariantImagesIfChanged, resolveAdminStock, resolveProductPatchTarget, resolveProductVariants, resolveVariantImageUrls, validateProductPatch, withProductCatalogBatchTransaction, type ProductCatalogRecord } from "./lib/product-variant-persistence.js";
import cookieParser from "cookie-parser";
import { products as staticProducts } from "./scripts/product-catalog-data.js";
import { buildCatalogSyncPlan } from "./scripts/catalog-sync-plan.js";
import { syncProductCatalog } from "./scripts/sync-product-catalog.js";

export type ServerDependencies = {
  prisma: PrismaClient;
  jwtSecret: string;
  createRefreshToken?: (userId: string, expiresAt: Date) => Promise<string>;
};

export const createApp = (dependencies: ServerDependencies) => {
const { prisma, jwtSecret } = dependencies;
if (!jwtSecret.trim()) throw new Error("JWT_SECRET must be configured before starting the backend");
const niimbotPageImageStore = (prisma as unknown as { niimbotPageImage: NiimbotPageImageStore }).niimbotPageImage;
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

type AuthPayload = { sub: string; email: string; name: string; cedula: string; isAdmin: boolean };
type StoredSession = { user: { id: string; email: string; user_metadata: Record<string, unknown> }; access_token: string } | null;
type NiimbotPageImageRecord = { id: string; key: string; path: string; alt: string | null; createdAt: Date; updatedAt: Date };
class ProductBatchAbort extends Error {
  constructor(readonly statusCode: number, readonly responseBody: Record<string, unknown>) {
    super(String(responseBody.error ?? "No se pudo guardar el lote de productos"));
  }
}
type NiimbotPageImageStore = {
  findMany: (args: { orderBy: { key: "asc" } }) => Promise<NiimbotPageImageRecord[]>;
  findUnique: (args: { where: { key: string } }) => Promise<NiimbotPageImageRecord | null>;
  upsert: (args: { where: { key: string }; create: { key: string; path: string; alt?: string | null }; update: { path?: string; alt?: string | null } }) => Promise<NiimbotPageImageRecord>;
};

const normalizeCedula = (value: string) => value.replace(/\D/g, "").trim();
const createGeneratedPasswordHash = () => bcrypt.hash(crypto.randomUUID(), 10);

const parseBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "si" || normalized === "sí";
};

const isProduction = process.env.NODE_ENV === "production" || process.env.RENDER === "true";
const cookieSecure = process.env.COOKIE_SECURE !== undefined ? parseBoolean(process.env.COOKIE_SECURE) : isProduction;
const cookieSameSite = (process.env.COOKIE_SAMESITE as any) ?? (isProduction ? "none" : "lax");
const REFRESH_TOKEN_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const buildRefreshCookieOptions = () => ({ httpOnly: true, secure: cookieSecure, sameSite: cookieSameSite as any, path: "/", maxAge: REFRESH_TOKEN_MAX_AGE });

const parseCouponData = (row: Record<string, unknown>) => ({
  code: String(row.code ?? "").trim().toUpperCase(),
  type: String(row.type ?? "fixed").trim().toLowerCase() === "percent" ? "percent" : "fixed",
  value: parseDecimal(row.value) ?? new Prisma.Decimal(0),
  active: row.active !== undefined ? parseBoolean(row.active) : true,
  minimumSubtotal: parseDecimal(row.minimumSubtotal ?? row.minimum_subtotal),
  expiresAt: row.expiresAt ? new Date(String(row.expiresAt)) : row.expires_at ? new Date(String(row.expires_at)) : undefined,
});

const recordCouponAudit = async (data: {
  couponCode: string;
  action: string;
  performedByUserId?: string | null;
  performedByEmail?: string | null;
  details?: Record<string, unknown>;
}) => {
  if (!data.couponCode) return;
  try {
    console.debug("Coupon audit skipped", {
      couponCode: data.couponCode,
      action: data.action,
      performedByUserId: data.performedByUserId ?? null,
      performedByEmail: data.performedByEmail ?? null,
    });
  } catch (error) {
    console.error("Failed to record coupon audit", error);
  }
};

const corsOrigins = process.env.CORS_ORIGIN?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];

const isAllowedCorsOriginForRequest = (origin: string) => isAllowedCorsOrigin(origin, corsOrigins);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (isAllowedCorsOriginForRequest(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With", "X-Access-Token"],
  }),
);
app.use(express.json({
  limit: "15mb",
  verify: (req, _res, buffer) => {
    (req as express.Request & { rawBody?: string }).rawBody = buffer.toString("utf8");
  },
}));
app.use(cookieParser());
app.use("/uploads", express.static(uploadsDir));
app.use("/assets", express.static(assetsDir, { fallthrough: false }));

const parseDecimal = (value: unknown): Prisma.Decimal | null | undefined => {
  if (value === null) return null;
  const normalized = String(value ?? "").trim();
  if (normalized === "") return undefined;
  return new Prisma.Decimal(normalized);
};

const computeWholesalePricing = ({
  basePrice,
  quantity,
  activateWholesale,
  wholesaleMinQty,
  wholesaleDiscountPercent,
}: {
  basePrice: Prisma.Decimal | number;
  quantity: number;
  activateWholesale?: boolean | null;
  wholesaleMinQty?: number | null;
  wholesaleDiscountPercent?: number | null;
}) => {
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

const dbCallWithRetry = async <T>(fn: () => Promise<T>, attempts = 3, delayMs = 250): Promise<T> => {
  let lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
};

const serializeUser = (user: User | null) =>
  user
    ? {
        id: user.id,
        name: user.name,
        email: user.email,
        cedula: user.cedula,
        is_admin: user.isAdmin,
      }
    : null;

const serializeProduct = (product: Product & { variants?: unknown[]; categories?: unknown[]; images?: unknown[] }) => {
  const categories = (product.categories ?? []).map((item) =>
    item && typeof item === "object" && "category" in item
      ? (item as { category: unknown }).category
      : item,
  );
  return wrap({ ...product, price: product.price, categories, variants: product.variants ?? [], images: product.images ?? [] });
};
const serializeOrder = (order: Order) => wrap({
  ...order,
  total: order.total,
  shipping_name: (order as any).shipping_name ?? null,
  shipping_email: (order as any).shipping_email ?? null,
  shipping_phone: (order as any).shipping_phone ?? null,
  shipping_department: (order as any).shipping_department ?? null,
  shipping_city: (order as any).shipping_city ?? null,
  shipping_address: (order as any).shipping_address ?? null,
  shipping_reference: (order as any).shipping_reference ?? null,
});
const serializeCoupon = (coupon: Coupon) => wrap({ ...coupon, value: coupon.value, minimumSubtotal: coupon.minimumSubtotal });
const serializeCouponAudit = (row: Record<string, unknown>) => wrap(row);
const serializeCedulaEmail = (row: CedulaEmail) => wrap(row) as CedulaEmail;

const serializeUserAddress = (row: UserAddress) => ({
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
  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: { user, pass },
  });
};

const moneyFormatter = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

const buildInvoiceText = (order: Order) => {
  const items = Array.isArray(order.items) ? (order.items as Array<Record<string, unknown>>) : [];
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

const sendInvoiceEmail = async (order: Order) => {
  const customerEmail = String(order.customerEmail || "").trim().toLowerCase();
  if (!customerEmail) return;

  const mailer = getMailer();
  if (!mailer) {
    console.warn(`SMTP no configurado, no se envió factura para el pedido ${order.id}`);
    return;
  }

  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!fromEmail) return;

  await mailer.sendMail({
    from: `"${process.env.SMTP_FROM_NAME || "Shelby Importaciones"}" <${fromEmail}>`,
    to: customerEmail,
    subject: `Factura Shelby - Pedido ${order.id}`,
    text: buildInvoiceText(order),
  });
};

const normalizeOrderCreateData = (row: Record<string, unknown>) => ({
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

const normalizeOrderUpdateData = (row: Record<string, unknown>) => {
  const data: Record<string, unknown> = {};
  if (row.items !== undefined) data.items = Array.isArray(row.items) ? row.items : [];
  if (row.total !== undefined) data.total = new Prisma.Decimal(Number(row.total));
  if (row.shipping !== undefined) data.shipping = Number(row.shipping);
  if (row.status !== undefined) data.status = String(row.status);
  if (row.paymentMethod !== undefined) data.paymentMethod = String(row.paymentMethod);
  if (row.payment_method !== undefined) data.paymentMethod = String(row.payment_method);
  if (row.couponCode !== undefined) data.couponCode = String(row.couponCode).trim().toUpperCase();
  if (row.coupon_code !== undefined) data.couponCode = String(row.coupon_code).trim().toUpperCase();
  if (row.discountAmount !== undefined) data.discountAmount = parseDecimal(row.discountAmount);
  if (row.discount_amount !== undefined) data.discountAmount = parseDecimal(row.discount_amount);
  if (row.customerName !== undefined) data.customerName = String(row.customerName);
  if (row.customer_name !== undefined) data.customerName = String(row.customer_name);
  if (row.customerEmail !== undefined) data.customerEmail = String(row.customerEmail).trim().toLowerCase();
  if (row.customer_email !== undefined) data.customerEmail = String(row.customer_email).trim().toLowerCase();
  if (row.customerPhone !== undefined) data.customerPhone = String(row.customerPhone);
  if (row.customer_phone !== undefined) data.customerPhone = String(row.customer_phone);
  if (row.customerCity !== undefined) data.customerCity = String(row.customerCity);
  if (row.customer_city !== undefined) data.customerCity = String(row.customer_city);
  if (row.customerAddress !== undefined) data.customerAddress = String(row.customerAddress);
  if (row.customer_address !== undefined) data.customerAddress = String(row.customer_address);
  if (row.notes !== undefined) data.notes = String(row.notes);
  if (row.userId !== undefined) data.userId = String(row.userId);
  if (row.user_id !== undefined) data.userId = String(row.user_id);
  if (row.shipping_name !== undefined) data.shipping_name = String(row.shipping_name);
  if (row.shipping_email !== undefined) data.shipping_email = String(row.shipping_email).trim().toLowerCase();
  if (row.shipping_phone !== undefined) data.shipping_phone = String(row.shipping_phone);
  if (row.shipping_department !== undefined) data.shipping_department = String(row.shipping_department);
  if (row.shipping_city !== undefined) data.shipping_city = String(row.shipping_city);
  if (row.shipping_address !== undefined) data.shipping_address = String(row.shipping_address);
  if (row.shipping_reference !== undefined) data.shipping_reference = String(row.shipping_reference);
  return data;
};

// User addresses endpoints
app.get("/api/user/addresses", async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const rows = await prisma.userAddress.findMany({ where: { userId: auth.sub }, orderBy: { createdAt: "desc" } });
  return res.json((rows ?? []).map(serializeUserAddress));
});

app.post("/api/user/addresses", async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const body = req.body as Record<string, unknown>;
  const data = {
    userId: auth.sub,
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
  } as any;

  if (data.isDefault) {
    await prisma.userAddress.updateMany({ where: { userId: auth.sub, isDefault: true }, data: { isDefault: false } });
  } else {
    const count = await prisma.userAddress.count({ where: { userId: auth.sub } });
    if (count === 0) data.isDefault = true;
  }

  // ensure relation connect by id to satisfy Prisma relation input
  const createData = { ...data } as any;
  delete createData.userId;
  createData.user = { connect: { id: auth.sub } };
  const created = await prisma.userAddress.create({ data: createData });
  return res.json(serializeUserAddress(created));
});

app.patch("/api/user/addresses/:id", async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { id } = req.params;
  const existing = await prisma.userAddress.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.userId !== auth.sub) return res.status(403).json({ error: "No autorizado" });
  const body = req.body as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (body.label !== undefined) data.label = String(body.label);
  if (body.fullName !== undefined) data.fullName = String(body.fullName);
  if (body.cedula !== undefined) data.cedula = String(body.cedula);
  if (body.email !== undefined) data.email = String(body.email).trim().toLowerCase();
  if (body.phone !== undefined) data.phone = String(body.phone);
  if (body.department !== undefined) data.department = String(body.department);
  if (body.city !== undefined) data.city = String(body.city);
  if (body.address !== undefined) data.address = String(body.address);
  if (body.reference !== undefined) data.reference = body.reference ? String(body.reference) : null;
  if (body.isDefault !== undefined) data.isDefault = Boolean(body.isDefault);

  if (data.isDefault === true) {
    await prisma.userAddress.updateMany({ where: { userId: auth.sub, isDefault: true }, data: { isDefault: false } });
  }

  const updated = await prisma.userAddress.update({ where: { id }, data });
  return res.json(serializeUserAddress(updated));
});

app.delete("/api/user/addresses/:id", async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { id } = req.params;
  const existing = await prisma.userAddress.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.userId !== auth.sub) return res.status(403).json({ error: "No autorizado" });
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
  if (!auth) return;
  const { id } = req.params;
  const existing = await prisma.userAddress.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.userId !== auth.sub) return res.status(403).json({ error: "No autorizado" });
  await prisma.userAddress.updateMany({ where: { userId: auth.sub, isDefault: true }, data: { isDefault: false } });
  const updated = await prisma.userAddress.update({ where: { id }, data: { isDefault: true } });
  return res.json(serializeUserAddress(updated));
});

const issueSession = (user: User): StoredSession => {
  const payload: AuthPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    cedula: user.cedula,
    isAdmin: user.isAdmin,
  };

  console.log("[auth] issueSession", {
    jwtSecretLength: jwtSecret.length,
    sub: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
  });
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

const createAndSetRefreshToken = async (userId: string, res: express.Response) => {
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE);
  let token: string;
  if (dependencies.createRefreshToken) {
    token = await dependencies.createRefreshToken(userId, expiresAt);
  } else {
    const refreshTokens = await import("./lib/refreshTokens.js");
    token = refreshTokens.generateRefreshToken();
    await refreshTokens.createRefreshToken(userId, token, expiresAt);
  }
  res.cookie("refresh_token", token, buildRefreshCookieOptions());
};

const getAuthorizationHeader = (req: express.Request): string | undefined => {
  const directHeader = req.headers.authorization;
  const accessTokenHeader = req.headers["x-access-token"];

  if (Array.isArray(directHeader)) return directHeader[0];
  if (Array.isArray(accessTokenHeader)) return accessTokenHeader[0];
  if (typeof directHeader === "string") return directHeader;
  if (typeof accessTokenHeader === "string") return accessTokenHeader;
  return undefined;
};

const readAuth = (authorization?: string) => {
  const authValue = authorization?.trim();
  const hasAuthorizationHeader = Boolean(authValue);
  const bearerMatch = authValue?.match(/^Bearer\s+(.+)$/i);
  const tokenCandidate = bearerMatch?.[1] ?? authValue;
  const hasBearerToken = Boolean(tokenCandidate);
  console.log("[auth] readAuth header present:", hasAuthorizationHeader, "bearer:", hasBearerToken, "header length:", authValue?.length ?? 0);
  if (!hasBearerToken) return null;

  const token = tokenCandidate ?? "";
  try {
    const decoded = jwt.verify(token, jwtSecret) as AuthPayload;
    console.log("[auth] jwt verify success", {
      sub: decoded?.sub ?? null,
      email: decoded?.email ?? null,
      isAdmin: decoded?.isAdmin ?? null,
      tokenLength: token.length,
    });
    return decoded;
  } catch (error) {
    console.log("verify error:", error instanceof Error ? error.message : String(error));
    console.log("token first 20:", token.substring(0, 20));
    console.log("[auth] readAuth invalid token", { tokenLength: token.length, jwtSecretLength: jwtSecret.length });
    return null;
  }
};

const requireAuth = (req: express.Request, res: express.Response) => {
  const authHeader = getAuthorizationHeader(req);
  const auth = readAuth(authHeader);
  if (!auth) {
    const reason = !authHeader ? "missing-header" : authHeader.startsWith("Bearer ") ? "invalid-token" : "invalid-header-format";
    console.log("[auth] requireAuth failed", {
      method: req.method,
      path: req.path,
      authorizationHeader: Boolean(authHeader),
      authorizationHeaderLength: authHeader?.length ?? 0,
      receivedHeaderType: authHeader?.startsWith("Bearer ") ? "bearer" : authHeader ? "raw" : "missing",
      reason,
    });
    res.status(401).json({ error: "No autorizado", reason });
    return null;
  }
  console.log("[auth] requireAuth success", { sub: auth.sub, email: auth.email, isAdmin: auth.isAdmin });
  return auth;
};

const logAdminDecision = async (req: express.Request, auth: AuthPayload, user: User | null) => {
  const isAdminByRecord = isAdminUserRecord(user);
  console.log("[auth] admin decision", {
    method: req.method,
    path: req.path,
    hasAuthorization: Boolean(getAuthorizationHeader(req)),
    authSub: auth.sub,
    authEmail: auth.email,
    authIsAdmin: auth.isAdmin,
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    dbIsAdmin: user?.isAdmin ?? null,
    isAdminByRecord,
    rule: isAdminByRecord ? "admin-cedula-or-db-flag" : "denied",
  });
};

type WompiCreatePaymentBody = {
  products?: Array<{ id?: string; name?: string; quantity?: number; unit_price?: number }>;
  total?: number;
  customerEmail?: string;
  customer_email?: string;
  reference?: string;
  referencePedido?: string;
  orderId?: string;
  paymentMethod?: string;
  payment_method?: string;
  redirectUrl?: string;
  redirect_url?: string;
  customerName?: string;
  customer_name?: string;
  customerPhone?: string;
  customer_phone?: string;
};

const readWompiPaymentMethodAvailability = async () => {
  const { baseUrl, publicKey } = getWompiConfig();
  if (!publicKey) {
    console.warn("[wompi] payment methods unavailable because WOMPI_PUBLIC_KEY is missing; returning empty methods list for local dev");
    return {
      payload: {},
      methods: [] as Array<{ id: string; name: string; available: boolean }>,
      acceptanceToken: "",
    };
  }

  const response = await fetch(`${baseUrl}/merchants/${encodeURIComponent(publicKey)}`, {
    headers: buildWompiAuthorizationHeader(),
  });
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
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

const createWompiTransaction = async (body: WompiCreatePaymentBody) => {
  const { baseUrl, publicKey, privateKey } = getWompiConfig();
  const paymentMethod = normalizeWompiPaymentMethod(body.paymentMethod ?? body.payment_method) ?? "CARD";
  const reference = String(body.reference ?? body.referencePedido ?? body.orderId ?? "").trim();
  const redirectUrl = String(body.redirectUrl ?? body.redirect_url ?? "").trim() || undefined;
  const customerEmail = String(body.customerEmail ?? body.customer_email ?? "").trim().toLowerCase();

  console.log("[wompi] create transaction request body", {
    paymentMethod,
    amount: body.total ?? null,
    orderId: body.orderId ?? null,
    reference,
    customerEmail,
    redirectUrl,
  });

  if (!publicKey) {
    console.warn("[wompi] local dev fallback activated because WOMPI_PUBLIC_KEY is missing", {
      reference,
      paymentMethod,
      amount: Number(body.total ?? 0),
    });

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
      methods: [] as Array<{ id: string; name: string; available: boolean }>,
    };
  }

  const merchant = await readWompiPaymentMethodAvailability();
  const amountInCents = Math.round(Number(body.total ?? 0) * 100);
  const customerPhoneRaw = String(body.customerPhone ?? body.customer_phone ?? "").trim();
  const customerPhoneDigits = normalizePhoneNumber(customerPhoneRaw);

  const missingFields: string[] = [];
  if (!body.total && body.total !== 0) missingFields.push("amount");
  if (!customerEmail) missingFields.push("customerEmail");
  if (!reference) missingFields.push("reference");

  if (missingFields.length > 0) {
    const error = new Error("required_fields_missing");
    (error as any).missingFields = missingFields;
    (error as any).received = {
      paymentMethod,
      amount: body.total ?? null,
      orderId: body.orderId ?? null,
      customerEmail,
      reference,
      redirectUrl,
    };
    throw error;
  }

  if (amountInCents < 15000000) {
    const error = new Error("Wompi requiere un pedido mínimo de $ 150.000 para pagos electrónicos.");
    (error as any).status = 422;
    (error as any).payload = {
      error: {
        type: "UNPROCESSABLE",
        reason: "La base de la transacción debe ser igual o mayor a 150000",
      },
    };
    throw error;
  }

  const requestBody = {
    name: `Pedido ${reference}`,
    description: `Checkout de pago para pedido ${reference}`,
    single_use: true,
    collect_shipping: false,
    currency: "COP",
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
  } as Record<string, unknown>;

  console.log("[wompi] create transaction request summary", {
    reference,
    amountInCents,
    currency: "COP",
    paymentMethod,
    customerEmail,
    publicKeySuffix: publicKey ? publicKey.slice(-6) : null,
    hasPrivateKey: Boolean(privateKey),
  });

  try {
    console.log("[wompi] create transaction - request summary", {
      amountInCents,
      currency: "COP",
      reference,
      customerEmail,
      paymentMethod,
      phoneNumberPresent: Boolean(customerPhoneDigits),
      phoneNumberLength: customerPhoneDigits.length,
      authorizationHeaderPresent: Boolean(buildWompiAuthorizationHeader().Authorization),
      productsCount: Array.isArray(body.products) ? body.products.length : 0,
    });
  } catch (logErr) {
    console.warn('[wompi] failed to log request summary', String(logErr));
  }

  const paymentLinkUrl = `${baseUrl}/payment_links`;
  console.log("[wompi] creating payment link", { url: paymentLinkUrl, requestBody });
  const response = await fetch(paymentLinkUrl, {
    method: "POST",
    headers: {
      ...buildWompiAuthorizationHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    payload = { raw: text };
  }

  try {
    console.log("[wompi payment link response]", JSON.stringify(payload, null, 2));
  } catch (e) {
    /* ignore logging errors */
  }


  if (!response.ok) {
    const errorDetails = {
      url: paymentLinkUrl,
      status: response.status,
      statusText: response.statusText,
      payload,
      rawText: text,
    };
    if (response.status === 422) {
      try {
        console.error('[wompi] transaction 422 response', JSON.stringify(errorDetails, null, 2));
      } catch (err) {
        console.error('[wompi] transaction 422 response (failed to stringify payload)', { status: response.status, raw: String(text).slice(0, 2000) });
      }
    } else {
      console.error('[wompi] transaction failed', errorDetails);
    }
    const err: any = new Error(`Wompi transaction failed: ${response.status}`);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }

  const transaction = (payload.data as Record<string, unknown> | undefined) ?? payload;
  const paymentLinkId = String((payload as any)?.data?.id ?? transaction?.id ?? "").trim() || null;
  const paymentUrl = paymentLinkId ? `https://checkout.wompi.co/l/${paymentLinkId}` : null;

  try {
    console.log("[wompi payment link created]", {
      id: paymentLinkId,
      url: paymentUrl,
    });
  } catch (e) {
    /* ignore */
  }

  try {
    console.log("[wompi] transaction response", {
      id: paymentLinkId,
      status: null,
      payment_method: null,
      paymentLinkId,
      paymentUrl,
    });
  } catch (e) {
    /* ignore */
  }

  return { payload, transaction, methods: merchant.methods, paymentLinkId, paymentUrl, transactionId: null, status: null };
};

const requireAdmin = async (req: express.Request, res: express.Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  const user = await prisma.user.findUnique({ where: { id: auth.sub } });
  const isAdminByRecord = isAdminUserRecord(user);
  await logAdminDecision(req, auth, user);
  if (user && isAdminByRecord && canManagePrivateData({ id: user.id, isAdmin: isAdminByRecord })) return user;

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

const isAllowedNiimbotPageImageKey = (key: string) => NIIMBOT_PAGE_IMAGE_KEYS.has(key);

const isSafeNiimbotPageImagePath = (key: string, value: string) => {
  const expectedPrefix = `${NIIMBOT_STORAGE_PREFIX}/${key}/`;
  if (!value.startsWith(expectedPrefix) || value.includes("%") || value.includes("\\") || value.includes("//")) return false;
  const segments = value.split("/");
  return segments.length === 3 && segments[0] === NIIMBOT_STORAGE_PREFIX && segments[1] === key && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segments[2]);
};

const decodeStrictBase64 = (value: unknown) => {
  if (typeof value !== "string" || !value || /\s/.test(value)) return null;
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || decoded.toString("base64") !== value) return null;
  return decoded;
};

const detectNiimbotImageType = (content: Buffer) => {
  const isJpeg = content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  const isPng = content.length >= 8 && Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).equals(content.subarray(0, 8));
  const isWebp = content.length >= 12 && content.toString("ascii", 0, 4) === "RIFF" && content.toString("ascii", 8, 12) === "WEBP";
  if (isJpeg) return { mimeType: "image/jpeg", extension: "jpg" };
  if (isPng) return { mimeType: "image/png", extension: "png" };
  if (isWebp) return { mimeType: "image/webp", extension: "webp" };
  return null;
};

const serializeNiimbotPageImage = (record: NiimbotPageImageRecord, includeUpdatedAt = false) => ({
  key: record.key,
  path: record.path,
  alt: record.alt,
  ...(includeUpdatedAt ? { updatedAt: record.updatedAt.toISOString() } : {}),
});

const uploadNiimbotStorageObject = async (objectPath: string, content: Buffer, mimeType: string) => {
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

const createNiimbotSignedUrl = async (objectPath: string, expiresIn: number) => {
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
  if (!response.ok) throw new Error("Supabase Storage signed URL failed");
  const payload = await response.json() as { signedURL?: string };
  if (!payload.signedURL) throw new Error("Supabase Storage returned no signed URL");
  return new URL(payload.signedURL, `${supabaseUrl}/`).toString();
};

app.get("/api/niimbot/page-images", async (_req, res) => {
  try {
    const records = await niimbotPageImageStore.findMany({ orderBy: { key: "asc" } });
    return res.json(records.map((record) => serializeNiimbotPageImage(record)));
  } catch (error) {
    console.error("NIIMBOT page images read failed", error instanceof Error ? error.message : "unknown error");
    return res.status(500).json({ error: "No se pudieron cargar las imágenes de NIIMBOT" });
  }
});

app.get("/api/niimbot/page-images/:key/url", async (req, res) => {
  const key = String(req.params.key ?? "").trim();
  if (!isAllowedNiimbotPageImageKey(key)) return res.status(400).json({ error: "Clave de imagen no permitida" });

  try {
    const record = await niimbotPageImageStore.findUnique({ where: { key } });
    if (!record || !isSafeNiimbotPageImagePath(key, record.path)) return res.status(404).json({ error: "Imagen de NIIMBOT no configurada" });

    const expiresIn = 60 * 60;
    const url = await createNiimbotSignedUrl(record.path, expiresIn);
    return res.json({ url, expiresIn });
  } catch (error) {
    console.error("NIIMBOT signed URL failed", error instanceof Error ? error.message : "unknown error");
    return res.status(502).json({ error: "No se pudo resolver la imagen de NIIMBOT" });
  }
});

app.put("/api/niimbot/page-images/:key", async (req, res) => {
  const authUser = await requireAdmin(req, res);
  if (!authUser) return;

  const key = String(req.params.key ?? "").trim();
  const body = req.body as { path?: string; alt?: string | null };
  const imagePath = String(body.path ?? "").trim();
  if (!isAllowedNiimbotPageImageKey(key)) return res.status(400).json({ error: "Clave de imagen no permitida" });
  if (!isSafeNiimbotPageImagePath(key, imagePath)) return res.status(400).json({ error: "Ruta de imagen no permitida" });
  if (body.alt !== undefined && body.alt !== null && String(body.alt).length > 200) return res.status(400).json({ error: "Texto alternativo demasiado largo" });

  try {
    const record = await niimbotPageImageStore.upsert({
      where: { key },
      create: { key, path: imagePath, alt: body.alt ? String(body.alt).trim() : null },
      update: { path: imagePath, alt: body.alt ? String(body.alt).trim() : null },
    });
    return res.json(serializeNiimbotPageImage(record, true));
  } catch (error) {
    console.error("NIIMBOT page image update failed", error instanceof Error ? error.message : "unknown error");
    return res.status(500).json({ error: "No se pudo guardar la imagen de NIIMBOT" });
  }
});

app.post("/api/niimbot/page-images/upload", async (req, res) => {
  const authUser = await requireAdmin(req, res);
  if (!authUser) return;

  const body = req.body as { key?: string; contentBase64?: string; mimeType?: string; alt?: string | null };
  const key = String(body.key ?? "").trim();
  const declaredMimeType = String(body.mimeType ?? "").trim().toLowerCase();
  const encodedContent = body.contentBase64;
  if (!isAllowedNiimbotPageImageKey(key)) return res.status(400).json({ error: "Clave de imagen no permitida" });
  if (!NIIMBOT_ALLOWED_MIME_TYPES.has(declaredMimeType)) return res.status(415).json({ error: "Tipo de imagen no permitido" });
  if (body.alt !== undefined && body.alt !== null && String(body.alt).length > 200) return res.status(400).json({ error: "Texto alternativo demasiado largo" });
  if (typeof encodedContent !== "string" || !encodedContent) return res.status(400).json({ error: "Contenido de imagen inválido" });

  let base64 = encodedContent;
  if (encodedContent.startsWith("data:")) {
    const dataUrlMatch = encodedContent.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/);
    if (!dataUrlMatch || dataUrlMatch[1].toLowerCase() !== declaredMimeType) return res.status(400).json({ error: "Contenido de imagen inválido" });
    base64 = dataUrlMatch[2];
  }
  const content = decodeStrictBase64(base64);
  if (!content) return res.status(400).json({ error: "Contenido de imagen inválido" });
  if (!content.length || content.length > NIIMBOT_MAX_IMAGE_BYTES) return res.status(413).json({ error: "La imagen supera el tamaño permitido" });

  const detectedType = detectNiimbotImageType(content);
  if (!detectedType || detectedType.mimeType !== declaredMimeType) return res.status(415).json({ error: "El contenido no coincide con el tipo de imagen declarado" });
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
  } catch (error) {
    console.error("NIIMBOT page image upload failed", error instanceof Error ? error.message : "unknown error");
    return res.status(502).json({ error: "No se pudo almacenar la imagen de NIIMBOT" });
  }
});

if (process.env.CATALOG_DRY_RUN_ROUTE === "true") {
  app.get("/internal/catalog-sync-dry-run", async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { cedula: true, isAdmin: true } });
    if (!isAdminUserRecord(user)) return res.status(403).json({ error: "Solo administradores" });

    try {
      const plan = await buildCatalogSyncPlan(prisma, staticProducts);
      return res.json(plan);
    } catch (error) {
      console.error("Catalog dry-run failed", error);
      return res.status(500).json({ error: "catalog_dry_run_failed" });
    }
  });
}

let catalogSyncRunning = false;

if (process.env.CATALOG_REAL_SYNC_ROUTE === "true") {
  app.post("/internal/catalog-sync-run", async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { cedula: true, isAdmin: true } });
    if (!isAdminUserRecord(user)) return res.status(403).json({ error: "Solo administradores" });
    if (catalogSyncRunning) return res.status(409).json({ error: "catalog_sync_already_running" });

    catalogSyncRunning = true;
    try {
      const summary = await syncProductCatalog(prisma);
      return res.json(summary);
    } catch (error) {
      console.error("Catalog sync failed", error);
      return res.status(500).json({ error: "catalog_sync_failed" });
    } finally {
      catalogSyncRunning = false;
    }
  });
}

const parseFilters = (filtersRaw?: string) => {
  if (!filtersRaw) return [] as Array<{ column: string; value: string | number | boolean }>;
  try {
    const parsed = JSON.parse(filtersRaw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

type ProductDeleteFilter = { column: string; value: string | number | boolean };

const productDeleteFilterTypes = new Map<string, "string" | "number" | "boolean">([
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

const parseProductDeleteFilters = (filtersRaw: unknown): ProductDeleteFilter[] | null => {
  if (typeof filtersRaw !== "string" || !filtersRaw.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(filtersRaw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const seenColumns = new Set<string>();
  const filters: ProductDeleteFilter[] = [];
  for (const candidate of parsed) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const keys = Object.keys(candidate);
    if (keys.length !== 2 || !keys.includes("column") || !keys.includes("value")) return null;

    const filter = candidate as Record<string, unknown>;
    if (typeof filter.column !== "string" || seenColumns.has(filter.column)) return null;
    const expectedType = productDeleteFilterTypes.get(filter.column);
    if (!expectedType) return null;
    const value = filter.value;
    if (expectedType === "string" && (typeof value !== "string" || value.trim() === "")) return null;
    if (expectedType === "number" && (typeof value !== "number" || !Number.isFinite(value))) return null;
    if (expectedType === "boolean" && typeof value !== "boolean") return null;

    seenColumns.add(filter.column);
    filters.push({ column: filter.column, value: value as string | number | boolean });
  }
  return filters;
};

const applyFilters = <T extends Record<string, unknown>>(rows: T[], filters: Array<{ column: string; value: string | number | boolean }>) =>
  filters.reduce((filtered, filter) => filtered.filter((row) => String(row[filter.column]) === String(filter.value)), rows);

const updateProfileName = async (
  auth: AuthPayload,
  req: express.Request,
  res: express.Response,
  payload: { user_id?: unknown; user_name?: unknown },
) => {
  const userId = typeof payload.user_id === "string" ? payload.user_id.trim() : "";
  const name = typeof payload.user_name === "string" ? payload.user_name.trim() : "";
  if (!userId || !name) {
    res.status(400).json({ error: "user_id y user_name son requeridos" });
    return null;
  }

  const administrator = userId === auth.sub ? null : await requireAdmin(req, res);
  if (userId !== auth.sub && !administrator) return null;
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

const findEmailByCedula = async (cedula: string) => {
  const normalizedCedula = normalizeCedula(cedula);

  const cedulaRow = await prisma.cedulaEmail.findUnique({ where: { cedula: normalizedCedula } });
  if (cedulaRow?.email) return cedulaRow.email;

  const profile = await prisma.user.findFirst({ where: { cedula: normalizedCedula } });
  if (profile?.email) return profile.email;

  return null;
};

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "shelby-mysql-backend" });
});

app.get("/", (_req, res) => {
  res.json({ ok: true, message: "Shelby MySQL backend is running" });
});

app.post("/api/auth/register", async (req, res) => {
  const { email, password, data = {} } = req.body as { email?: string; password?: string; data?: { name?: string; cedula?: string } };
  if (!email || !password || typeof data.name !== "string" || data.name.trim() === "" || !data.cedula) {
    return res.status(400).json({ error: "email, password, name y cedula son requeridos" });
  }

  const normalizedCedula = normalizeCedula(data.cedula);
  const existingEmail = await dbCallWithRetry(() => prisma.user.findUnique({ where: { email } }));
  if (existingEmail) return res.status(409).json({ error: "Ya existe un usuario con ese correo" });

  const existingCedula = await dbCallWithRetry(() => prisma.user.findFirst({ where: { cedula: normalizedCedula } }));
  if (existingCedula) return res.status(409).json({ error: "Ya existe un usuario con esa cédula" });

  const hashed = await bcrypt.hash(password, 10);
  const user = await dbCallWithRetry(() => prisma.user.create({
    data: {
      name: (data.name ?? "").trim(),
      email: email.trim().toLowerCase(),
      password: hashed,
      cedula: normalizedCedula,
      isAdmin: false,
    },
  }));

  await dbCallWithRetry(() => prisma.cedulaEmail.upsert({
    where: { cedula: normalizedCedula },
    update: { email: user.email, userId: user.id },
    create: { cedula: normalizedCedula, email: user.email, userId: user.id },
  }));

  try {
    await createAndSetRefreshToken(user.id, res);
  } catch (err) {
    console.error("failed to create refresh token on register", err);
    return res.status(500).json({ error: "No se pudo establecer la sesión renovable" });
  }

  return res.json({ session: issueSession(user), user: serializeUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, cedula, password } = req.body as { email?: string; cedula?: string; password?: string };
  if ((!email && !cedula) || !password) {
    return res.status(400).json({ error: "correo o cédula y password son requeridos" });
  }

  let user: User | null = null;
  if (cedula) {
    const normalizedCedula = normalizeCedula(cedula);
    if (!normalizedCedula) return res.status(401).json({ error: "Cédula o contraseña incorrectas" });

    const cedulaMapping = await prisma.cedulaEmail.findUnique({ where: { cedula: normalizedCedula } });
    if (cedulaMapping?.userId) {
      user = await prisma.user.findUnique({ where: { id: cedulaMapping.userId } });
      if (user && normalizeCedula(user.cedula) !== normalizedCedula) {
        return res.status(401).json({ error: "Cédula o contraseña incorrectas" });
      }
    }
    if (!user && cedulaMapping?.email) {
      const mappedUser = await prisma.user.findUnique({ where: { email: cedulaMapping.email } });
      if (mappedUser && normalizeCedula(mappedUser.cedula) === normalizedCedula) user = mappedUser;
    }
    if (!user) {
      user = await prisma.user.findFirst({ where: { cedula: normalizedCedula } });
    }
  } else {
    user = await prisma.user.findUnique({ where: { email: email!.trim().toLowerCase() } });
  }
  if (!user) return res.status(401).json({ error: "Cédula o contraseña incorrectas" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "Cédula o contraseña incorrectas" });

  try {
    await createAndSetRefreshToken(user.id, res);
  } catch (err) {
    console.error("failed to create refresh token on login", err);
    return res.status(500).json({ error: "No se pudo establecer la sesión renovable" });
  }

  return res.json({ session: issueSession(user), user: serializeUser(user) });
});

app.post("/api/auth/refresh", async (req, res) => {
  // Read refresh token from cookie
  const token = (req.cookies && (req.cookies as any).refresh_token) ?? req.headers["x-refresh-token"] ?? null;
  if (!token) return res.status(401).json({ error: "missing_refresh_token" });

  try {
    const { verifyRefreshToken, rotateRefreshToken, generateRefreshToken, createRefreshToken } = await import("./lib/refreshTokens.js");
    const verification = await verifyRefreshToken(String(token));
    if (!verification || !verification.valid) return res.status(401).json({ error: "invalid_refresh_token" });

    const existing = verification.record;
    const user = await prisma.user.findUnique({ where: { id: existing.userId } });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    // rotate
    const newToken = generateRefreshToken();
    const newExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const created = await rotateRefreshToken(existing.id, newToken, newExpires);
    // set cookie
    res.cookie("refresh_token", newToken, buildRefreshCookieOptions());

    return res.json({ session: issueSession(user) });
  } catch (err) {
    console.error("refresh error", err);
    return res.status(500).json({ error: "refresh_failed" });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const token = (req.cookies && (req.cookies as any).refresh_token) ?? req.headers["x-refresh-token"] ?? null;
  if (token) {
    try {
      const { verifyRefreshToken, revokeRefreshToken } = await import("./lib/refreshTokens.js");
      const verification = await verifyRefreshToken(String(token));
      if (verification && verification.record) {
        await revokeRefreshToken(verification.record.id);
      }
    } catch (err) {
      console.error("logout revoke failed", err);
    }
  }
  res.clearCookie("refresh_token", { httpOnly: true, secure: cookieSecure, sameSite: cookieSameSite as any, path: "/" });
  return res.json({ ok: true });
});

app.post("/api/auth/verify", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: "email es requerido" });
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  try {
    await createAndSetRefreshToken(user.id, res);
  } catch (err) {
    console.error("failed to create refresh token on verify", err);
    return res.status(500).json({ error: "No se pudo establecer la sesión renovable" });
  }
  return res.json({ session: issueSession(user), user: serializeUser(user) });
});

app.post("/api/users/cedula-email", async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const { cedula, email } = req.body as { cedula?: string; email?: string };
  if (!cedula || !email) return res.status(400).json({ error: "cedula y email son requeridos" });

  const user = await prisma.user.findUnique({ where: { id: auth.sub } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
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
  if (!auth) return;

  const user = await updateProfileName(auth, req, res, req.body as { user_id?: unknown; user_name?: unknown });
  if (!user) return;
  return res.json({ ok: true });
});

app.get("/api/profile", async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const user = await prisma.user.findUnique({ where: { id: auth.sub } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  return res.json({ user: serializeUser(user) });
});

app.post("/api/rpc/:name", async (req, res) => {
  const { name } = req.params;
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (name === "sync_profile") {
    const user = await updateProfileName(auth, req, res, req.body as { user_id?: unknown; user_name?: unknown });
    if (!user) return;
    return res.json({ data: null, error: null });
  }

  if (name === "get_email_by_cedula") {
    const { lookup_cedula } = req.body as { lookup_cedula?: string };
    if (!lookup_cedula) {
      return res.status(400).json({ error: "lookup_cedula es requerido" });
    }

    const requester = await prisma.user.findUnique({ where: { id: auth.sub } });
    if (!requester) return res.status(401).json({ error: "No autorizado" });
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
  if (!auth) return;
  const body = req.body as { data?: Record<string, unknown> } & Record<string, unknown>;
  const incoming = body.data && typeof body.data === "object" ? body.data : body;
  if (hasAdminRoleMutation(incoming)) {
    return res.status(403).json({ error: "El rol de administrador no se puede modificar desde el perfil propio" });
  }
  const user = await prisma.user.findUnique({ where: { id: auth.sub } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  return res.json({ user: serializeUser(user) });
});

app.get("/api/data/:table", async (req, res) => {
  const { table } = req.params;
  const filters = parseFilters(req.query.filters as string | undefined);
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const ascending = req.query.ascending !== "false";
  const orderBy = req.query.orderBy as string | undefined;
  const single = req.query.single === "true";
  const maybeSingle = req.query.maybeSingle === "true";
  const exactOrderId = filters.length === 1 && filters[0].column === "id" && typeof filters[0].value === "string"
    ? String(filters[0].value)
    : null;

  if (table === "orders") {
    const tokenAuth = readAuth(getAuthorizationHeader(req));
    const user = tokenAuth ? await prisma.user.findUnique({ where: { id: tokenAuth.sub } }) : null;
    if (tokenAuth && !user) return res.status(401).json({ error: "No autorizado" });
    const principal = user
      ? { id: user.id, isAdmin: isAdminUserRecord(user) }
      : null;
    const access = resolveDataReadAccess(table, principal, Boolean(exactOrderId));
    if (access === "denied") {
      if (!tokenAuth) return res.status(401).json({ error: "No autorizado" });
      return res.status(403).json({ error: "No autorizado para consultar pedidos" });
    }

    if (access === "public-order-status" && exactOrderId) {
      const order = await prisma.order.findUnique({
        where: { id: exactOrderId },
        select: { id: true, status: true },
      });
      const result = order ? wrap(order) : null;
      if (single || maybeSingle) return res.json(result);
      return res.json(result ? [result] : []);
    }

    const orderRows = await prisma.order.findMany({
      ...(access === "owner-orders" ? { where: { userId: principal!.id } } : {}),
    });
    const filteredOrders = applyFilters(orderRows.map(serializeOrder) as Record<string, unknown>[], filters);
    const orderedOrders = orderBy ? [...filteredOrders].sort((a, b) => {
      const left = String(a[orderBy] ?? "");
      const right = String(b[orderBy] ?? "");
      return ascending ? left.localeCompare(right) : right.localeCompare(left);
    }) : filteredOrders;
    const slicedOrders = typeof limit === "number" ? orderedOrders.slice(0, limit) : orderedOrders;
    if (single || maybeSingle) return res.json(slicedOrders[0] ?? null);
    return res.json(slicedOrders);
  }

  if (["profiles", "coupons", "coupon_audit", "cedula_emails"].includes(table)) {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const user = await prisma.user.findUnique({ where: { id: auth.sub } });
    const principal = user ? { id: user.id, isAdmin: isAdminUserRecord(user) } : null;
    if (resolveDataReadAccess(table, principal) !== "admin") {
      return res.status(403).json({ error: "Solo administradores" });
    }
  }

  let rows: Array<Record<string, unknown>> = [];
  if (table === "products") rows = (await readProductsWithCatalogRelations(prisma)).map((row) => serializeProduct(row) as Record<string, unknown>);
  else if (table === "categories") rows = (await prisma.category.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }] })).map((row) => wrap(row) as Record<string, unknown>);
  else if (table === "profiles") rows = (await prisma.user.findMany()).map((row) => serializeUser(row) as Record<string, unknown>);
  else if (table === "coupons") rows = (await prisma.coupon.findMany()).map((row) => serializeCoupon(row) as Record<string, unknown>);
  else if (table === "coupon_audit") rows = [];
  else if (table === "cedula_emails") rows = (await prisma.cedulaEmail.findMany()).map((row) => serializeCedulaEmail(row) as Record<string, unknown>);
  else return res.status(404).json({ error: "Tabla no soportada" });

  const filtered = applyFilters(rows, filters);
  const ordered = orderBy ? [...filtered].sort((a, b) => {
    const left = String(a[orderBy] ?? "");
    const right = String(b[orderBy] ?? "");
    return ascending ? left.localeCompare(right) : right.localeCompare(left);
  }) : filtered;
  const sliced = typeof limit === "number" ? ordered.slice(0, limit) : ordered;

  if (single || maybeSingle) return res.json(sliced[0] ?? null);
  return res.json(sliced);
});

app.post("/api/data/:table", async (req, res) => {
  const { table } = req.params;
  const body = req.body as unknown;
  if (table === "categories") {
    const authUser = await requireAdmin(req, res);
    if (!authUser) return;
    const rows = Array.isArray(body) ? body as Array<Record<string, unknown>> : [body as Record<string, unknown>];
    const categoryInputs = rows.map((row) => ({ name: String(row.name ?? "").trim(), slug: String(row.slug ?? "").trim().toLowerCase() }));
    if (categoryInputs.some((category) => !category.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category.slug))) {
      return res.status(422).json({ error: "Cada categoría necesita nombre y slug válido" });
    }
    try {
      const saved = await prisma.$transaction(categoryInputs.map((category) => prisma.category.create({ data: category })));
      return res.json(saved.map((category) => wrap(category)));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return res.status(409).json({ error: "Ya existe una categoría con ese slug" });
      }
      throw error;
    }
  }
  if (table === "products") {
    const authUser = await requireAdmin(req, res);
    if (!authUser) return;
    const rows = Array.isArray(body) ? body : [body];
    const productRows = rows as Array<Record<string, unknown>>;
    const stockInputs = new Map<Record<string, unknown>, { productStock: number | undefined; variantStocks: Map<Record<string, unknown>, number | undefined> }>();
    for (const row of productRows) {
      const variants = resolveProductVariants(row);
      try {
        const productStock = resolveAdminStock(row.stock);
        if (Object.prototype.hasOwnProperty.call(row, "expectedStock")) resolveAdminStock(row.expectedStock);
        const variantStocks = new Map<Record<string, unknown>, number | undefined>();
        for (const variant of variants ?? []) {
          variantStocks.set(variant, resolveAdminStock(variant.stock));
          if (Object.prototype.hasOwnProperty.call(variant, "expectedStock")) resolveAdminStock(variant.expectedStock);
        }
        stockInputs.set(row, { productStock, variantStocks });
      } catch (error) {
        return res.status(422).json({ error: error instanceof Error ? error.message : "El stock no es válido" });
      }
    }

    const productIds = productRows.map((row) => String(row.id || crypto.randomUUID()));
    const saved = [] as Array<Product & { categories?: unknown[] }>;
    try {
      await withProductCatalogBatchTransaction(prisma, productIds, async (transaction) => {
        for (const [index, row] of productRows.entries()) {
          const id = productIds[index];
          const variants = resolveProductVariants(row);
          const rowStockInputs = stockInputs.get(row);
          if (!rowStockInputs) throw new Error("No se pudieron validar los valores de stock del producto");
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
          const productStockConflict = findStockSnapshotConflict(
            "product",
            id,
            row.expectedStock,
            currentProduct?.stock,
            rowStockInputs.productStock !== undefined,
          );
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
              const stockConflict = findStockSnapshotConflict(
                "variant",
                variantId,
                variant.expectedStock,
                existingVariant?.productId === id ? existingVariant.stock : undefined,
                rowStockInputs.variantStocks.get(variant) !== undefined,
              );
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
            const variantIds: string[] = [];
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
            const productImageUrls: string[] = [];
            for (const imageRow of row.images as unknown[]) {
              const url = typeof imageRow === "string" ? imageRow : String((imageRow as Record<string, unknown>)?.url ?? "").trim();
              if (url) productImageUrls.push(url);
            }
            await replaceProductImagesIfChanged(transaction, id, productImageUrls);
          }
          const savedProduct = await readProductWithCatalogRelations(transaction, id);
          if (!savedProduct) throw new Error(`No se pudo releer el producto ${id} después de guardarlo`);
          saved.push(savedProduct);
        }
      });
    } catch (error) {
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
    const saved = [] as Order[];
    for (const row of rows as Array<Record<string, unknown>>) {
      const orderId = String(row.id || crypto.randomUUID());
      const rawUserId = row.userId !== undefined ? String(row.userId) : row.user_id !== undefined ? String(row.user_id) : undefined;
      const candidateUserId = rawUserId && rawUserId !== "null" && rawUserId !== "undefined" ? rawUserId : null;
      const resolvedUserId = candidateUserId ? await prisma.user.findUnique({ where: { id: candidateUserId } }).then((user) => user?.id ?? null) : null;
      const normalizedOrderData = {
        ...normalizeOrderCreateData(row),
        userId: resolvedUserId ?? null,
      };

      console.log("[orders] incoming row", { row });
      console.log("[orders] resolvedUserId", { candidateUserId, resolvedUserId });
      console.log("[orders] normalizedOrderData", normalizedOrderData);

      let order: Order;
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
            findProduct: async (id) => (await transaction.product.findUnique({ where: { id } })) as unknown as Awaited<ReturnType<OrderPricingRepository["findProduct"]>>,
            findVariant: async (id) => (await transaction.productVariant.findUnique({ where: { id } })) as unknown as Awaited<ReturnType<OrderPricingRepository["findVariant"]>>,
            findCoupon: async (code) => (await transaction.coupon.findUnique({ where: { code } })) as unknown as Awaited<ReturnType<OrderPricingRepository["findCoupon"]>>,
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
            items: pricing.items as Prisma.InputJsonValue,
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
      } catch (error) {
        console.error("[orders] prisma.upsert failed", {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          code: (error as any)?.code,
          meta: (error as any)?.meta,
        });
        return res.status(400).json({
          error: error instanceof Error ? error.message : String(error),
          code: (error as any)?.code,
          meta: (error as any)?.meta,
        });
      }

      console.log("[orders] prisma.upsert success", { orderId, order });
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
    if (!authUser) return;
    const rows = Array.isArray(body) ? body : [body];
    const saved = [] as User[];
    for (const row of rows as Array<Record<string, unknown>>) {
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
    if (!authUser) return;

    const rows = Array.isArray(body) ? body : [body];
    const saved = [] as Coupon[];
    for (const row of rows as Array<Record<string, unknown>>) {
      const couponData = parseCouponData(row);
      if (!couponData.code) continue;
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
    if (!authUser) return;
    const rows = Array.isArray(body) ? body : [body];
    const saved = [] as CedulaEmail[];
    for (const row of rows as Array<Record<string, unknown>>) {
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
  const filters = parseFilters(req.query.filters as string | undefined);
  const payload = req.body as Record<string, unknown>;

  if (table === "categories") {
    const authUser = await requireAdmin(req, res);
    if (!authUser) return;
    if (filters.length === 0) return res.status(400).json({ error: "Se requiere un filtro para actualizar categorías" });
    const name = payload.name !== undefined ? String(payload.name).trim() : undefined;
    const slug = payload.slug !== undefined ? String(payload.slug).trim().toLowerCase() : undefined;
    if (name === "" || (slug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))) {
      return res.status(422).json({ error: "Nombre o slug de categoría no válido" });
    }
    const rows = await prisma.category.findMany();
    const matched = applyFilters(rows.map((row) => wrap(row) as Record<string, unknown>), filters);
    try {
      const updated = await prisma.$transaction(matched.map((row) => prisma.category.update({
        where: { id: String(row.id) },
        data: { name, slug },
      })));
      return res.json(updated.map((category) => wrap(category)));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return res.status(409).json({ error: "Ya existe una categoría con ese slug" });
      }
      throw error;
    }
  }

  if (table === "products") {
    const authUser = await requireAdmin(req, res);
    if (!authUser) return;
    const hasExpectedStock = Object.prototype.hasOwnProperty.call(payload, "expectedStock");
    const patchPayload = { ...payload };
    delete patchPayload.expectedStock;
    if (hasExpectedStock && !Object.prototype.hasOwnProperty.call(patchPayload, "stock")) {
      return res.status(400).json({ error: "expectedStock solo se permite cuando se actualiza stock" });
    }
    if (Object.prototype.hasOwnProperty.call(patchPayload, "stock") && !hasExpectedStock) {
      return res.status(400).json({ error: "Se requiere expectedStock para actualizar stock" });
    }
    let expectedStock: number | undefined;
    if (hasExpectedStock) {
      try {
        expectedStock = resolveAdminStock(payload.expectedStock);
      } catch (error) {
        return res.status(400).json({ error: error instanceof Error ? `expectedStock ${error.message}` : "expectedStock no es válido" });
      }
      if (expectedStock === undefined) {
        return res.status(400).json({ error: "expectedStock debe ser un entero válido" });
      }
    }
    const patchValidation = validateProductPatch(patchPayload, filters);
    if ("error" in patchValidation) return res.status(400).json(patchValidation);
    const productId = patchValidation.filters[0].value;
    const patchResult = await prisma.$transaction(async (transaction) => {
      await lockProductCatalogIds(transaction, [productId]);
      const currentRows = await transaction.product.findMany({ where: { id: productId } });
      const currentMatches = applyFilters(currentRows.map(serializeProduct) as Record<string, unknown>[], patchValidation.filters);
      const target = resolveProductPatchTarget(currentMatches);
      if (target.kind !== "found") return target;
      const stockConflict = findStockSnapshotConflict(
        "product",
        productId,
        expectedStock,
        typeof target.product.stock === "number" ? target.product.stock : undefined,
        Object.prototype.hasOwnProperty.call(patchPayload, "stock"),
      );
      if (stockConflict) return { kind: "stock-conflict", conflict: stockConflict } as const;
      const product = await transaction.product.update({ where: { id: productId }, data: patchValidation.data });
      return { kind: "updated", product } as const;
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
    if (!authUser) return;
    if (Object.keys(payload).some((key) => key !== "status") || payload.status === undefined) {
      return res.status(400).json({ error: "Esta ruta solo permite actualizar el estado del pedido" });
    }
    if (typeof payload.status !== "string" || !allowedOrderStatuses.has(payload.status)) {
      return res.status(400).json({ error: "Estado de pedido no válido" });
    }

    const rows = await prisma.order.findMany();
    const matched = applyFilters(rows.map(serializeOrder) as Record<string, unknown>[], filters);
    const updated = [] as Order[];
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
        } catch (error) {
          console.error("Error enviando factura", error);
        }
      }
      updated.push(next);
    }
    return res.json(updated.map(serializeOrder));
  }

  if (table === "profiles") {
    const authUser = await requireAdmin(req, res);
    if (!authUser) return;
    if (filters.length === 0) return res.status(400).json({ error: "Se requiere un filtro para actualizar perfiles" });
    const rows = await prisma.user.findMany();
    const matched = applyFilters(rows.map(serializeUser) as Record<string, unknown>[], filters);
    const updated = [] as User[];
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
    if (!authUser) return;

    const rows = await prisma.coupon.findMany();
    const matched = applyFilters(rows.map(serializeCoupon) as Record<string, unknown>[], filters);
    const updated = [] as Coupon[];
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
  const filters = parseFilters(req.query.filters as string | undefined);

  if (table === "categories") {
    const authUser = await requireAdmin(req, res);
    if (!authUser) return;
    if (filters.length === 0) return res.status(400).json({ error: "Se requiere un filtro para eliminar categorías" });
    const rows = await prisma.category.findMany();
    const matched = applyFilters(rows.map((row) => wrap(row) as Record<string, unknown>), filters);
    const categoryIds = matched.map((row) => String(row.id));
    const deletion = categoryIds.length
      ? await prisma.$transaction(async (transaction) => {
        const lockedCategories = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "public"."Category"
          WHERE "id" IN (${Prisma.join(categoryIds)})
          FOR UPDATE
        `);
        const lockedCategoryIds = lockedCategories.map((category) => category.id);
        const assignmentCount = lockedCategoryIds.length
          ? await transaction.productCategory.count({ where: { categoryId: { in: lockedCategoryIds } } })
          : 0;
        if (assignmentCount > 0) return { conflict: true, deleted: 0 };
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
    if (!authUser) return;
    const productDeleteFilters = parseProductDeleteFilters(req.query.filters);
    if (!productDeleteFilters) return res.status(400).json({ error: "Se requieren filtros de producto válidos para eliminar" });
    const rows = await prisma.product.findMany();
    const matched = applyFilters(rows.map(serializeProduct) as Record<string, unknown>[], productDeleteFilters);
    const matchedProductIds = matched.map((row) => String(row.id));
    const explicitlyRequestedIds = productDeleteFilters.length === 1 && productDeleteFilters[0].column === "id"
      ? [productDeleteFilters[0].value as string]
      : [];
    const productIds = Array.from(new Set([...matchedProductIds, ...explicitlyRequestedIds]));
    if (productIds.length === 0) return res.json({ deleted: 0 });
    const deletedCount = await prisma.$transaction((transaction) => deleteProductsWithExclusions(transaction, productIds));
    return res.json({ deleted: deletedCount });
  }

  if (table === "orders") {
    const authUser = await requireAdmin(req, res);
    if (!authUser) return;
    if (filters.length === 0) return res.status(400).json({ error: "Se requiere un filtro para eliminar pedidos" });
    const rows = await prisma.order.findMany();
    const matched = applyFilters(rows.map(serializeOrder) as Record<string, unknown>[], filters);
    for (const row of matched) await prisma.order.delete({ where: { id: String(row.id) } });
    return res.json({ deleted: matched.length });
  }

  if (table === "profiles") {
    const authUser = await requireAdmin(req, res);
    if (!authUser) return;
    if (filters.length === 0) return res.status(400).json({ error: "Se requiere un filtro para eliminar perfiles" });
    const rows = await prisma.user.findMany();
    const matched = applyFilters(rows.map(serializeUser) as Record<string, unknown>[], filters);
    for (const row of matched) await prisma.user.delete({ where: { id: String(row.id) } });
    return res.json({ deleted: matched.length });
  }

  if (table === "coupons") {
    const authUser = await requireAdmin(req, res);
    if (!authUser) return;

    const rows = await prisma.coupon.findMany();
    const matched = applyFilters(rows.map(serializeCoupon) as Record<string, unknown>[], filters);
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
    if (!authUser) return;
    if (filters.length === 0) return res.status(400).json({ error: "Se requiere un filtro para eliminar asociaciones de cédula" });
    const rows = await prisma.cedulaEmail.findMany();
    const matched = applyFilters(rows.map(serializeCedulaEmail) as Record<string, unknown>[], filters);
    for (const row of matched) await prisma.cedulaEmail.delete({ where: { cedula: String(row.cedula) } });
    return res.json({ deleted: matched.length });
  }

  return res.status(404).json({ error: "Tabla no soportada" });
});

app.post("/api/storage/upload", async (req, res) => {
  const { path: filePath, contentBase64, mimeType } = req.body as { path?: string; contentBase64?: string; mimeType?: string };
  if (!filePath || !contentBase64) return res.status(400).json({ error: "path y contentBase64 son requeridos" });

  const fullPath = path.join(uploadsDir, filePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  const content = contentBase64.includes(",") ? contentBase64.split(",").at(-1) ?? contentBase64 : contentBase64;
  await writeFile(fullPath, Buffer.from(content, "base64"));
  return res.json({ path: filePath, publicUrl: `${req.protocol}://${req.get("host")}/uploads/${filePath}`, mimeType: mimeType ?? "application/octet-stream" });
});

app.get("/api/functions/mp-webhook", async (req, res) => {
  console.info("Mercado Pago webhook received", { query: req.query });
  return res.status(200).json({ ok: true, received: true });
});

app.post("/api/functions/mp-webhook", async (req, res) => {
  console.info("Mercado Pago webhook received", { body: req.body });
  return res.status(200).json({ ok: true, received: true });
});

app.post("/api/functions/check-mp-methods", async (_req, res) => {
  // Prefer the server access token; fall back to client token only if server token is absent.
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN ?? process.env.MERCADOPAGO_ACCESS_TOKEN_CLIENT;
  if (!accessToken) return res.status(500).json({ error: "mercadopago_token_missing", message: "MERCADOPAGO_ACCESS_TOKEN (server) o MERCADOPAGO_ACCESS_TOKEN_CLIENT (client) no está configurado" });

  try {
    const methodsResponse = await fetch("https://api.mercadopago.com/v1/payment_methods", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const methodsData = await methodsResponse.json();
    if (!methodsResponse.ok) {
      return res.status(methodsResponse.status).json({ error: "mp_error", details: methodsData });
    }

    const methods = Array.isArray(methodsData) ? methodsData.map((method: Record<string, unknown>) => ({ id: method.id, name: method.name })) : [];
    return res.json({ methods });
  } catch (error) {
    console.error("Could not check MP payment methods", error);
    return res.status(500).json({ error: "mp_error", message: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/functions/redeem-coupon", async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const { code, subtotal = 0, shipping = 0 } = req.body as { code?: string; subtotal?: number; shipping?: number };
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
  if (!authUser) return;

  const body = req.body as { dryRun?: boolean; products?: Array<{ id?: string; variants?: Array<{ id?: string; name?: string; description?: string; image?: string; images?: string[]; price?: number; stock?: number; active?: boolean; sortOrder?: number }> }> };
  const legacyProducts = Array.isArray(body.products) ? body.products : [];
  const report = { products: 0, legacy: 0, existing: 0, excluded: 0, excludedProducts: 0, created: 0, missingValues: [] as string[], conflicts: [] as string[] };
  const planned: Array<{ productId: string; variantId: string; name: string; description: string | null; image: string | null; price?: number; stock?: number; active?: boolean; sortOrder: number; action: "existing" | "create" | "excluded" }> = [];

  for (const product of legacyProducts) {
    const productId = String(product.id ?? "").trim();
    if (!productId) continue;
    if (await prisma.productExclusion.findUnique({ where: { productId }, select: { productId: true } })) {
      report.excludedProducts += 1;
      continue;
    }
    if (!(await prisma.product.findUnique({ where: { id: productId }, select: { id: true } }))) continue;
    report.products += 1;
    for (const [index, legacy] of (Array.isArray(product.variants) ? product.variants : []).entries()) {
      const variantId = String(legacy.id ?? "").trim();
      if (!variantId) continue;
      report.legacy += 1;
      const exclusion = await prisma.productVariantExclusion.findUnique({ where: { variantId }, select: { productId: true } });
      if (exclusion) {
        report.excluded += 1;
        planned.push({ productId, variantId, name: String(legacy.name ?? "Subproducto"), description: legacy.description ? String(legacy.description) : null, image: legacy.image ? String(legacy.image) : null, price: legacy.price, stock: legacy.stock, active: legacy.active, sortOrder: Number(legacy.sortOrder ?? index), action: "excluded" });
        if (exclusion.productId !== productId) report.conflicts.push(`${variantId}: está excluida para ${exclusion.productId}, no para ${productId}`);
        continue;
      }
      if (legacy.price === undefined || legacy.stock === undefined) report.missingValues.push(`${productId}/${variantId}`);
      const existing = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { id: true, productId: true } });
      if (existing) {
        report.existing += 1;
        if (existing.productId !== productId) report.conflicts.push(`${variantId}: pertenece a ${existing.productId}, no a ${productId}`);
      }
      planned.push({ productId, variantId, name: String(legacy.name ?? "Subproducto"), description: legacy.description ? String(legacy.description) : null, image: legacy.image ? String(legacy.image) : null, price: legacy.price, stock: legacy.stock, active: legacy.active, sortOrder: Number(legacy.sortOrder ?? index), action: existing ? "existing" : "create" });
    }
  }

  if (body.dryRun !== false) return res.json({ ok: true, dryRun: true, report, planned });
  if (report.conflicts.length) return res.status(409).json({ error: "Hay IDs legacy en conflicto", report, planned });
  if (report.missingValues.length) return res.status(422).json({ error: "Faltan precios o stocks reales para algunas variantes legacy", report, planned });

  for (const item of planned) {
    if (item.action === "existing") continue;
    if (item.action === "excluded") continue;
    const result = await prisma.$transaction((transaction) => createLegacyVariantUnlessExcluded(transaction, {
      productId: item.productId,
      variantId: item.variantId,
      name: item.name,
      description: item.description,
      image: item.image,
      price: item.price!,
      stock: item.stock!,
      active: item.active,
      sortOrder: item.sortOrder,
    }));
    if (result === "created") report.created += 1;
    if (result === "excluded-variant") report.excluded += 1;
    if (result === "excluded-product") report.excludedProducts += 1;
  }
  return res.json({ ok: true, dryRun: false, report });
});

app.post("/api/payments/create-wompi-payment", async (req, res) => {
  console.log("[wompi] /api/payments/create-wompi-payment called", {
    path: req.path,
    method: req.method,
    paymentMethod: req.body?.paymentMethod ?? req.body?.payment_method ?? null,
    total: req.body?.total ?? null,
    customerEmail: req.body?.customerEmail ?? req.body?.customer_email ?? null,
    reference: req.body?.reference ?? req.body?.referencePedido ?? req.body?.orderId ?? null,
  });
  try {
    const created = await createWompiTransaction(req.body as WompiCreatePaymentBody);
    console.log("[wompi] final payment response", {
      paymentUrl: created.paymentUrl || null,
      transactionId: created.transaction?.id ?? null,
      transactionStatus: created.transaction?.status ?? null,
      hasNextAction: Boolean(created.transaction?.next_action),
      nextActionKeys: created.transaction?.next_action ? Object.keys(created.transaction.next_action as Record<string, unknown>) : [],
    });

    const paymentMethod = normalizeWompiPaymentMethod((req.body as any)?.paymentMethod ?? (req.body as any)?.payment_method) ?? String((created.transaction as any)?.payment_method_type ?? (created.transaction as any)?.payment_method ?? "");
    const returnedPaymentUrl: string | null = created.paymentUrl || null;

    console.log("[wompi] redirect decision", {
      paymentMethod,
      paymentUrl: returnedPaymentUrl ?? null,
    });

    const requestReference = String((req.body as any)?.reference ?? (req.body as any)?.referencePedido ?? (req.body as any)?.orderId ?? "").trim();
    const wompiStatus = String((created.transaction as any)?.status ?? "").trim();
    const orderStatus = mapWompiStatusToOrderStatus(wompiStatus) || "payment_pending";

    if (requestReference) {
      try {
        const existing = await prisma.order.findUnique({ where: { id: requestReference } });
        if (existing) {
          const updateData: Record<string, unknown> = {
            status: orderStatus,
          };

          try {
            await prisma.order.update({ where: { id: requestReference }, data: updateData });
            console.log("[wompi] order updated with payment-link response", { orderId: requestReference, orderStatus, paymentLinkId: created.paymentLinkId ?? null });
          } catch (updateError) {
            const err = updateError as Error & { code?: string; message?: string };
            if (String(err.message).includes("wompiTransactionId") || String(err.message).match(/Unknown column|does not exist/i)) {
              const createdTransactionId = String((created.transaction as any)?.id ?? (created as any)?.transactionId ?? "") || null;
              console.warn("[wompi] create-wompi-payment: wompiTransactionId column missing, continuing without it", { orderId: requestReference, transactionId: createdTransactionId, orderStatus, error: err.message });
            } else {
              throw err;
            }
          }
        } else {
          console.warn("[wompi] create-wompi-payment: order reference not found to update", { reference: requestReference });
        }
      } catch (err) {
        console.error("[wompi] failed to persist transaction to order", String(err));
      }
    }

    const normalizedMethod = normalizeWompiPaymentMethod((req.body as any)?.paymentMethod ?? (req.body as any)?.payment_method) ?? "CARD";
    const externalRedirectMethods = new Set(["NEQUI", "DAVIPLATA", "PSE"]);
    const pendingWithoutPaymentUrl = Boolean(!returnedPaymentUrl && created.transaction && String((created.transaction as any)?.status ?? "").toUpperCase() === "PENDING" && externalRedirectMethods.has(normalizedMethod));

    const responseBody = {
      success: true,
      paymentLinkId: created.paymentLinkId ?? null,
      transactionId: null,
      reference: requestReference || null,
      orderId: requestReference || null,
      status: wompiStatus || "PENDING",
      paymentUrl: returnedPaymentUrl || null,
      pendingWithoutPaymentUrl,
      transaction: created.transaction,
      methods: created.methods,
    };

    try {
      console.log("[response to frontend]", JSON.stringify(responseBody, null, 2));
    } catch (e) {
      /* ignore logging errors */
    }

    return res.json(responseBody);
  } catch (error) {
    console.error("Wompi payment creation failed", error && (error as any).message ? (error as any).message : error);
    const message = error instanceof Error ? error.message : String(error);
    const maybeStatus = (error as any)?.status ?? null;
    const maybePayload = (error as any)?.payload ?? null;
    const requestBody = req.body as Record<string, unknown>;
    const received = {
      paymentMethod: requestBody.paymentMethod ?? requestBody.payment_method ?? null,
      amount: requestBody.total ?? null,
      orderId: requestBody.orderId ?? requestBody.reference ?? requestBody.referencePedido ?? null,
      customerEmail: requestBody.customerEmail ?? requestBody.customer_email ?? null,
      reference: requestBody.reference ?? requestBody.referencePedido ?? requestBody.orderId ?? null,
      redirectUrl: requestBody.redirectUrl ?? requestBody.redirect_url ?? null,
    };

    if (message === "required_fields_missing") {
      const missingFields = (error as any)?.missingFields ?? [];
      const responseBody = {
        error: "campo requerido faltante",
        received,
        missingFields,
        wompi: maybePayload ?? null,
      };
      try { console.log("[response to frontend]", JSON.stringify(responseBody, null, 2)); } catch (e) {}
      return res.status(422).json(responseBody);
    }

    if (maybeStatus === 422) {
      const wompi = maybePayload ?? null;
      const wompiReason = (wompi as any)?.error?.reason;
      const responseBody = {
        error: "wompi_unprocessable",
        message: wompiReason || message,
        received,
        wompi,
      };
      try { console.log("[response to frontend]", JSON.stringify(responseBody, null, 2)); } catch (e) {}
      return res.status(422).json(responseBody);
    }

    const responseBody = { error: "wompi_error", message, received };
    try { console.log("[response to frontend]", JSON.stringify(responseBody, null, 2)); } catch (e) {}
    return res.status(500).json(responseBody);
  }
});

app.post("/api/payments/wompi/webhook", async (req, res) => {
  const rawBody = (req as express.Request & { rawBody?: string }).rawBody || JSON.stringify(req.body ?? {});
  const signatureHeader = req.headers["x-event-signature"] ?? req.headers["x-wompi-signature"];

  if (!verifyWompiEventSignature(rawBody, signatureHeader)) {
    console.warn("Wompi webhook signature rejected", {
      method: req.method,
      path: req.path,
      hasSignature: Boolean(signatureHeader),
      rawBodyLength: rawBody.length,
    });
    return res.status(401).json({ error: "invalid_signature" });
  }

  const event = req.body as Record<string, unknown>;
  const transaction = (event.data as Record<string, unknown> | undefined)?.transaction as Record<string, unknown> | undefined
    ?? (event.data as Record<string, unknown> | undefined)
    ?? (event.transaction as Record<string, unknown> | undefined);
  // Log webhook event for debugging
  try {
    const eventType = String(event.event ?? event.type ?? "");
    const transactionId = String(transaction?.id ?? "" ) || null;
    const status = String(transaction?.status ?? event.status ?? "") || null;
    console.log("[wompi webhook]", { event: eventType, transactionId, status, reference: String(transaction?.reference ?? event.reference ?? "") });
  } catch (e) {
    /* ignore */
  }
  const reference = String(transaction?.reference ?? event.reference ?? "").trim();
  const wompiStatus = String(transaction?.status ?? event.status ?? "").trim();
  const isApprovedEvent = String(wompiStatus).toUpperCase() === "APPROVED";
  const orderStatus = isApprovedEvent ? "payment_approved" : mapWompiStatusToOrderStatus(wompiStatus);
  const paymentMethod = normalizeWompiPaymentMethod(String(transaction?.payment_method_type ?? transaction?.payment_method ?? transaction?.type ?? ""));
  const transactionId = String(transaction?.id ?? "").trim() || null;

  if (!reference) {
    console.warn("Wompi webhook received without reference", { eventType: String(event.event ?? "") });
    return res.json({ ok: true, updated: false });
  }

  try {
    const existing = await prisma.order.findUnique({ where: { id: reference } });
    if (!existing) {
      console.warn("Wompi webhook order not found", { reference, wompiStatus });
      return res.json({ ok: true, updated: false, reference, status: orderStatus });
    }

    const updateData: Record<string, unknown> = {
      status: orderStatus,
      ...(paymentMethod ? { paymentMethod: paymentMethod.toLowerCase() } : {}),
    };

    if (isApprovedEvent) {
      updateData.paymentStatus = "approved";
    }

    if (transactionId) {
      updateData.wompiTransactionId = transactionId;
    }

    try {
      await prisma.order.update({ where: { id: reference }, data: updateData as any });
      console.log("[wompi webhook] order updated", { orderId: reference, transactionId, newStatus: orderStatus });
    } catch (updateError) {
      const err = updateError as Error & { code?: string; message?: string };
      if (String(err.message).includes("wompiTransactionId") || String(err.message).includes("paymentStatus") || String(err.message).match(/Unknown column|does not exist/i)) {
        console.warn("[wompi] webhook update skipped missing column", { reference, transactionId, newStatus: orderStatus, error: err.message });
      } else {
        throw err;
      }
    }

    return res.json({ ok: true, updated: true, reference, status: orderStatus });
  } catch (error) {
    console.error("Failed to process Wompi webhook", error);
    return res.status(500).json({ error: "wompi_error", message: error instanceof Error ? error.message : String(error) });
  }
});

// Endpoint to query transaction status by orderId or transactionId
app.get("/api/payments/transaction-status", async (req, res) => {
  try {
    const orderId = String(req.query.orderId ?? "").trim();
    let transactionId = String(req.query.transactionId ?? "").trim();
    const reference = String(req.query.reference ?? "").trim();

    let order: any = null;
    if (orderId) {
      try {
        order = await prisma.order.findUnique({ where: { id: orderId } });
        if (order && !transactionId) transactionId = String(order.wompiTransactionId ?? "").trim();
      } catch (err) {
        const error = err as Error & { code?: string; message?: string };
        if (String(error.message).includes("wompiTransactionId") || String(error.message).match(/Unknown column|does not exist/i)) {
          console.warn("[wompi] transaction-status: wompiTransactionId column missing, continuing with Wompi transactionId only", { orderId, error: error.message });
        } else {
          throw err;
        }
      }
    }

    const { baseUrl } = getWompiConfig();
    let payload: any = {};
    let transaction: Record<string, unknown> = {};
    let lookupId = transactionId;
    let lookupMode = transactionId ? "transaction-id" : "reference";
    let lookupErrorType: string | null = null;

    if (lookupId) {
      const response = await fetch(`${baseUrl}/transactions/${encodeURIComponent(lookupId)}`, { headers: buildWompiAuthorizationHeader() });
      const text = await response.text();
      try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
      transaction = (payload.data ?? payload) as Record<string, unknown>;
      lookupErrorType = (payload?.error as Record<string, unknown> | undefined)?.type?.toString() ?? null;
    } else if (reference) {
      const response = await fetch(`${baseUrl}/transactions?reference=${encodeURIComponent(reference)}`, { headers: buildWompiAuthorizationHeader() });
      const text = await response.text();
      try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
      const candidates = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
      const firstCandidate = (candidates as Array<Record<string, unknown>>)[0];
      if (firstCandidate && (firstCandidate.id || firstCandidate.transaction_id)) {
        lookupId = String(firstCandidate.id ?? firstCandidate.transaction_id ?? "").trim();
        lookupMode = "reference";
        const txResponse = await fetch(`${baseUrl}/transactions/${encodeURIComponent(lookupId)}`, { headers: buildWompiAuthorizationHeader() });
        const txText = await txResponse.text();
        try { payload = txText ? JSON.parse(txText) : {}; } catch { payload = { raw: txText }; }
        transaction = (payload.data ?? payload) as Record<string, unknown>;
        lookupErrorType = (payload?.error as Record<string, unknown> | undefined)?.type?.toString() ?? null;
      } else {
        lookupErrorType = "TRANSACTION_NOT_FOUND";
      }
    }

    if (!lookupId) {
      return res.status(400).json({ error: "missing_transaction_id", message: "transactionId, orderId with wompiTransactionId, or reference is required" });
    }

    const isTransactionNotFound = !transaction || Boolean(lookupErrorType?.toUpperCase().includes("NOT_FOUND")) || Boolean((payload?.error as Record<string, unknown> | undefined)?.type?.toString().toUpperCase().includes("NOT_FOUND"));
    const wompiStatus = String(transaction?.status ?? "").trim();
    const orderStatus = mapWompiStatusToOrderStatus(wompiStatus) || null;

    if (order && orderStatus && orderStatus !== order.status) {
      try {
        await prisma.order.update({ where: { id: orderId }, data: { status: orderStatus } });
        console.log('[wompi] transaction-status: order updated', { orderId, orderStatus, lookupMode, lookupId });
      } catch (err) {
        console.error('[wompi] transaction-status: failed to update order', String(err));
      }
    }

    const normalizedPaymentMethod = normalizeWompiPaymentMethod(String(transaction?.payment_method_type ?? transaction?.payment_method ?? transaction?.type ?? "")) ?? undefined;
    const externalRedirectMethods = new Set(["NEQUI", "DAVIPLATA", "PSE"]);
    const rawPaymentUrl = String(
      (transaction?.next_action as Record<string, unknown> | undefined)?.redirect_to_url
        ?? transaction?.redirect_url
        ?? transaction?.checkout_url
        ?? transaction?.payment_url
        ?? "",
    ).trim();
    const pendingWithoutPaymentUrl = Boolean(
      !rawPaymentUrl && String(wompiStatus).toUpperCase() === "PENDING" && externalRedirectMethods.has(String(normalizedPaymentMethod ?? "").toUpperCase()),
    );
    const reconciliationState = isTransactionNotFound
      ? { status: "payment_pending", mappedStatus: "payment_pending", reason: "transaction_not_found" }
      : { status: wompiStatus || "PENDING", mappedStatus: orderStatus, reason: "transaction_lookup" };

    if (pendingWithoutPaymentUrl) {
      console.warn('[wompi] transaction-status: pending without payment URL', { orderId, transactionId: lookupId, paymentMethod: normalizedPaymentMethod, status: wompiStatus, lookupMode });
    }

    return res.json({ ok: true, transaction, status: reconciliationState.status, mappedStatus: reconciliationState.mappedStatus, orderId: orderId || null, paymentMethod: normalizedPaymentMethod?.toLowerCase() ?? null, pendingWithoutPaymentUrl, reason: reconciliationState.reason, transactionNotFound: isTransactionNotFound, lookupMode, lookupId });
  } catch (error) {
    console.error('Failed to fetch transaction status', error);
    return res.status(500).json({ error: 'wompi_error', message: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/functions/create-mp-preference", async (req, res) => {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return res.status(500).json({ error: "mercadopago_token_missing", message: "MERCADOPAGO_ACCESS_TOKEN no está configurado" });

  const body = req.body as {
    orderId?: string;
    items?: Array<{ id: string; title: string; quantity?: number; unit_price?: number; picture_url?: string }>;
    payer?: { name?: string; email?: string; phone?: string; address?: string; city?: string };
    shipping?: number;
    total?: number;
    preferredPayment?: string;
    backUrls?: { success?: string; failure?: string; pending?: string };
    back_urls?: { success?: string; failure?: string; pending?: string };
  };

  if (!body.orderId || !body.items?.length) return res.status(400).json({ error: "items y orderId son requeridos" });

  const preference = buildMercadoPagoPreferencePayload(body as never, "");

  if (body.shipping && body.shipping > 0) {
    (preference.items as Array<Record<string, unknown>>).push({
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
    } catch (err) {
      console.warn("Could not resolve preferred Mercado Pago payment method", err);
    }
  }

  const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(preference),
  });

  const text = await response.text().catch(() => "");
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const tokenSource = process.env.MERCADOPAGO_ACCESS_TOKEN ? "server" : "none";
    console.error("Mercado Pago preference creation failed", { status: response.status, body: data, payload: preference, tokenConfigured: Boolean(accessToken), tokenSource });
    return res.status(response.status).json({
      error: String((data as Record<string, unknown>).message || "Error creando preferencia"),
      details: data,
      fallback: "No pudimos iniciar el pago. Puedes completar tu pedido por WhatsApp.",
    });
  }

  return res.json({ id: data.id, init_point: data.init_point, sandbox_init_point: data.sandbox_init_point });
});

return app;
};
