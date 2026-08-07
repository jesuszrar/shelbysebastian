import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient, type Product, type Order, type User, type Coupon, type CedulaEmail, type UserAddress, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { resolvePreferredPaymentMethod } from "./lib/mercadopago.js";
import { isAllowedCorsOrigin } from "./lib/cors.js";
import { buildMercadoPagoPreferencePayload } from "./lib/mercadopagoPreference.js";
import { isAdminUserRecord } from "./lib/auth.js";
import { buildWompiAuthorizationHeader, extractWebhookSignature, extractWompiMerchantMethods, getWompiConfig, mapWompiStatusToOrderStatus, normalizePhoneNumber, normalizeWompiPaymentMethod, verifyWompiEventSignature } from "./lib/wompi.js";
import { wrap } from "./lib/serialize.js";

dotenv.config();

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.PORT || 3001);
const jwtSecret = String(process.env.JWT_SECRET ?? "change-me").trim();
console.log("JWT_SECRET length:", jwtSecret.length);
const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "uploads");
const revenueStatuses = new Set(["paid", "approved", "completed", "payment_approved"]);

type AuthPayload = { sub: string; email: string; name: string; cedula: string; isAdmin: boolean };
type StoredSession = { user: { id: string; email: string; user_metadata: Record<string, unknown> }; access_token: string } | null;

const normalizeCedula = (value: string) => value.replace(/\D/g, "").trim();

const parseBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "si" || normalized === "sí";
};

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
    // Coupon audit logging is intentionally disabled for this deployment because the
    // Prisma schema currently does not include a CouponAudit model.
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
app.use("/uploads", express.static(uploadsDir));

const parseDecimal = (value: unknown): Prisma.Decimal | null | undefined => {
  if (value === null) return null;
  const normalized = String(value ?? "").trim();
  if (normalized === "") return undefined;
  return new Prisma.Decimal(normalized);
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

const serializeProduct = (product: Product) => wrap({ ...product, price: product.price });
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
  total: new Prisma.Decimal(Number(row.total ?? 0)),
  shipping: Number(row.shipping ?? 0),
  status: String(row.status ?? "pending"),
  paymentMethod: row.paymentMethod !== undefined ? String(row.paymentMethod) : row.payment_method !== undefined ? String(row.payment_method) : undefined,
  couponCode: row.couponCode !== undefined ? String(row.couponCode).trim().toUpperCase() : row.coupon_code !== undefined ? String(row.coupon_code).trim().toUpperCase() : undefined,
  discountAmount: row.discountAmount !== undefined ? parseDecimal(row.discountAmount) : row.discount_amount !== undefined ? parseDecimal(row.discount_amount) : undefined,
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
  const accessToken = jwt.sign(payload, jwtSecret, { expiresIn: "7d" });
  return {
    access_token: accessToken,
    user: {
      id: user.id,
      email: user.email,
      user_metadata: { name: user.name, cedula: user.cedula, is_admin: user.isAdmin },
    },
  };
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
  if (isAdminByRecord) {
    return user ?? ({ id: auth.sub, name: auth.name, email: auth.email, cedula: auth.cedula, password: "", isAdmin: true } as User);
  }

  if (user && auth.isAdmin) {
    console.warn("[auth] requireAdmin upgrading database user to admin because JWT contains admin claim", { userId: user.id, email: user.email });
    const updatedUser = await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
    return updatedUser;
  }

  if (!user && auth.isAdmin) {
    console.warn("[auth] requireAdmin allowed admin access from JWT claim while user row is missing", { authSub: auth.sub, authEmail: auth.email });
    return { id: auth.sub, name: auth.name, email: auth.email, cedula: auth.cedula, password: "", isAdmin: true } as User;
  }

  res.status(403).json({ error: "Solo administradores" });
  return null;
};

const parseFilters = (filtersRaw?: string) => {
  if (!filtersRaw) return [] as Array<{ column: string; value: string | number | boolean }>;
  try {
    const parsed = JSON.parse(filtersRaw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const applyFilters = <T extends Record<string, unknown>>(rows: T[], filters: Array<{ column: string; value: string | number | boolean }>) =>
  filters.reduce((filtered, filter) => filtered.filter((row) => String(row[filter.column]) === String(filter.value)), rows);

const syncProfileAndCedula = async (payload: {
  user_id: string;
  user_email: string;
  user_name: string;
  user_cedula: string;
  user_is_admin: boolean;
}) => {
  const normalizedCedula = normalizeCedula(payload.user_cedula);
  const userEmail = payload.user_email.trim().toLowerCase();
  const userName = payload.user_name.trim() || "Cliente";

  await prisma.user.upsert({
    where: { id: payload.user_id },
    update: {
      email: userEmail,
      name: userName,
      cedula: normalizedCedula,
      isAdmin: payload.user_is_admin,
    },
    create: {
      id: payload.user_id,
      email: userEmail,
      name: userName,
      cedula: normalizedCedula,
      isAdmin: payload.user_is_admin,
      password: await bcrypt.hash("temporary-password", 10),
    },
  });

  await prisma.cedulaEmail.upsert({
    where: { cedula: normalizedCedula },
    update: { email: userEmail, userId: payload.user_id },
    create: { cedula: normalizedCedula, email: userEmail, userId: payload.user_id },
  });
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
  if (!email || !password || !data.name || !data.cedula) {
    return res.status(400).json({ error: "email, password, name y cedula son requeridos" });
  }

  const normalizedCedula = normalizeCedula(data.cedula);
  const existingEmail = await prisma.user.findUnique({ where: { email } });
  if (existingEmail) return res.status(409).json({ error: "Ya existe un usuario con ese correo" });

  const existingCedula = await prisma.user.findFirst({ where: { cedula: normalizedCedula } });
  if (existingCedula) return res.status(409).json({ error: "Ya existe un usuario con esa cédula" });

  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name: data.name.trim(),
      email: email.trim().toLowerCase(),
      password: hashed,
      cedula: normalizedCedula,
      isAdmin: normalizedCedula === "1108758522",
    },
  });

  await prisma.cedulaEmail.upsert({
    where: { cedula: normalizedCedula },
    update: { email: user.email, userId: user.id },
    create: { cedula: normalizedCedula, email: user.email, userId: user.id },
  });

  return res.json({ session: issueSession(user), user: serializeUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({ error: "email y password son requeridos" });
  }

  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) return res.status(401).json({ error: "Invalid login credentials" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "Invalid login credentials" });

  return res.json({ session: issueSession(user), user: serializeUser(user) });
});

app.post("/api/auth/refresh", async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const user = await prisma.user.findUnique({ where: { id: auth.sub } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  return res.json({ session: issueSession(user) });
});

app.post("/api/auth/verify", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: "email es requerido" });
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  return res.json({ session: issueSession(user), user: serializeUser(user) });
});

app.get("/api/users/email-by-cedula", async (req, res) => {
  const cedula = String(req.query.cedula ?? "").trim();
  if (!cedula) return res.status(400).json({ error: "cedula es requerida" });
  const email = await findEmailByCedula(cedula);
  return res.json({ email });
});

app.post("/api/users/cedula-email", async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const { cedula, email } = req.body as { cedula?: string; email?: string };
  if (!cedula || !email) return res.status(400).json({ error: "cedula y email son requeridos" });

  const normalizedCedula = normalizeCedula(cedula);
  const normalizedEmail = String(email).trim().toLowerCase();

  await prisma.cedulaEmail.upsert({
    where: { cedula: normalizedCedula },
    update: { email: normalizedEmail, userId: auth.sub },
    create: { cedula: normalizedCedula, email: normalizedEmail, userId: auth.sub },
  });

  return res.json({ ok: true });
});

app.post("/api/profile/sync", async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const { user_id, user_email, user_name, user_cedula, user_is_admin } = req.body as {
    user_id?: string;
    user_email?: string;
    user_name?: string;
    user_cedula?: string;
    user_is_admin?: boolean;
  };

  if (!user_id || !user_email || !user_name || !user_cedula) {
    return res.status(400).json({ error: "user_id, user_email, user_name y user_cedula son requeridos" });
  }

  if (auth.sub !== user_id && !auth.isAdmin) {
    return res.status(403).json({ error: "No autorizado para sincronizar este perfil" });
  }

  await syncProfileAndCedula({
    user_id,
    user_email,
    user_name,
    user_cedula,
    user_is_admin: Boolean(user_is_admin),
  });

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

  if (name === "sync_profile") {
    const { user_id, user_email, user_name, user_cedula, user_is_admin } = req.body as {
      user_id?: string;
      user_email?: string;
      user_name?: string;
      user_cedula?: string;
      user_is_admin?: boolean;
    };

    if (!user_id || !user_email || !user_name || !user_cedula) {
      return res.status(400).json({ error: "user_id, user_email, user_name y user_cedula son requeridos" });
    }

    await syncProfileAndCedula({
      user_id,
      user_email,
      user_name,
      user_cedula,
      user_is_admin: Boolean(user_is_admin),
    });

    return res.json({ data: null, error: null });
  }

  if (name === "get_email_by_cedula") {
    const { lookup_cedula } = req.body as { lookup_cedula?: string };
    if (!lookup_cedula) {
      return res.status(400).json({ error: "lookup_cedula es requerido" });
    }

    const email = await findEmailByCedula(lookup_cedula);
    return res.json(email ?? null);
  }

  return res.status(404).json({ error: "RPC no soportado" });
});

app.patch("/api/auth/me", async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const incoming = (req.body as { data?: { is_admin?: boolean; isAdmin?: boolean } }).data ?? {};
  const user = await prisma.user.update({
    where: { id: auth.sub },
    data: {
      ...(incoming.is_admin !== undefined ? { isAdmin: incoming.is_admin } : {}),
      ...(incoming.isAdmin !== undefined ? { isAdmin: incoming.isAdmin } : {}),
    },
  });
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

  let rows: Array<Record<string, unknown>> = [];
  if (table === "products") rows = (await prisma.product.findMany()).map((row) => serializeProduct(row) as Record<string, unknown>);
  else if (table === "orders") rows = (await prisma.order.findMany()).map((row) => serializeOrder(row) as Record<string, unknown>);
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
  if (table === "products") {
    const rows = Array.isArray(body) ? body : [body];
    const saved = [] as Product[];
    for (const row of rows as Array<Record<string, unknown>>) {
      const id = String(row.id || crypto.randomUUID());
      const product = await prisma.product.upsert({
        where: { id },
        update: {
          name: String(row.name ?? ""),
          category: String(row.category ?? ""),
          price: parseDecimal(row.price) ?? new Prisma.Decimal(0),
          oldPrice: parseDecimal(row.oldPrice),
          badge: row.badge ? String(row.badge) : null,
          highlight: row.highlight !== undefined ? Boolean(row.highlight) : undefined,
          stock: Number(row.stock ?? 0),
          image: row.image ? String(row.image) : null,
          description: row.description ? String(row.description) : null,
          specs: row.specs ?? [],
        },
        create: {
          id,
          name: String(row.name ?? ""),
          category: String(row.category ?? ""),
          price: parseDecimal(row.price) ?? new Prisma.Decimal(0),
          oldPrice: parseDecimal(row.oldPrice),
          badge: row.badge ? String(row.badge) : null,
          highlight: row.highlight !== undefined ? Boolean(row.highlight) : false,
          stock: Number(row.stock ?? 0),
          image: row.image ? String(row.image) : null,
          description: row.description ? String(row.description) : null,
          specs: row.specs ?? [],
        },
      });
      saved.push(product);
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
        order = await prisma.order.upsert({
          where: { id: orderId },
          update: normalizedOrderData,
          create: {
            id: orderId,
            ...normalizedOrderData,
          },
        });
      } catch (error) {
        console.error("[orders] prisma.upsert failed", {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          code: (error as any)?.code,
          meta: (error as any)?.meta,
        });
        return res.status(500).json({
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
          password: await bcrypt.hash("temporary-password", 10),
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

  if (table === "products") {
    const rows = await prisma.product.findMany();
    const matched = applyFilters(rows.map(serializeProduct) as Record<string, unknown>[], filters);
    const updated = [] as Product[];
    for (const row of matched) {
      const next = await prisma.product.update({
        where: { id: String(row.id) },
        data: {
          ...payload,
          price: payload.price !== undefined ? parseDecimal(payload.price) ?? undefined : undefined,
          oldPrice: payload.oldPrice !== undefined ? parseDecimal(payload.oldPrice) ?? undefined : undefined,
          highlight: payload.highlight !== undefined ? Boolean(payload.highlight) : undefined,
          badge: payload.badge !== undefined ? (payload.badge ? String(payload.badge) : null) : undefined,
        },
      });
      updated.push(next);
    }
    return res.json(updated.map(serializeProduct));
  }

  if (table === "orders") {
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

  if (table === "products") {
    const rows = await prisma.product.findMany();
    const matched = applyFilters(rows.map(serializeProduct) as Record<string, unknown>[], filters);
    for (const row of matched) await prisma.product.delete({ where: { id: String(row.id) } });
    return res.json({ deleted: matched.length });
  }

  if (table === "orders") {
    const rows = await prisma.order.findMany();
    const matched = applyFilters(rows.map(serializeOrder) as Record<string, unknown>[], filters);
    for (const row of matched) await prisma.order.delete({ where: { id: String(row.id) } });
    return res.json({ deleted: matched.length });
  }

  if (table === "profiles") {
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
              console.warn("[wompi] create-wompi-payment: wompiTransactionId column missing, continuing without it", { orderId: requestReference, transactionId, orderStatus, error: err.message });
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

    if (message === "required_fields_missing" || maybeStatus === 422) {
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

app.listen(port, async () => {
  await mkdir(uploadsDir, { recursive: true });
  console.log(`Shelby MySQL backend listening on http://localhost:${port}`);
});
