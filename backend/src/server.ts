import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient, type Product, type Order, type User, type CedulaEmail, type Coupon, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { buildAbsoluteUrl } from "./lib/urls.js";

dotenv.config();

const env = process.env as Record<string, string | undefined>;
const prisma = new PrismaClient();
const app = express();
const port = Number(env.PORT ?? "3001");
const jwtSecret = env.JWT_SECRET ?? "change-me";
const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "uploads");
const revenueStatuses = new Set(["paid", "approved", "completed"]);

type AuthPayload = { sub: string; email: string; name: string; cedula: string; isAdmin: boolean };
type StoredSession = { user: { id: string; email: string; user_metadata: Record<string, unknown> }; access_token: string } | null;

const normalizeCedula = (value: string) => value.replace(/\D/g, "").trim();

const corsOrigins = env.CORS_ORIGIN?.split(",").map((value) => String(value).trim()).filter(Boolean) ?? [];
const defaultCorsOrigins = [
  "https://shelbyimport.com",
  "https://www.shelbyimport.com",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
const allowedCorsOrigins = Array.from(new Set([...defaultCorsOrigins, ...corsOrigins]));
// Only allow origins explicitly configured in `CORS_ORIGIN` or local dev hosts.
const isLocalDevOrigin = (origin: string) => {
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    );
  } catch {
    return false;
  }
};
const corsOriginHostnames = allowedCorsOrigins
  .map((value) => {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return String(value).replace(/^https?:\/\//i, "").toLowerCase();
    }
  })
  .filter(Boolean);

const isAllowedCorsOrigin = (origin: string) => {
  const normalizedOrigin = origin.toLowerCase();
  if (allowedCorsOrigins.includes(origin) || isLocalDevOrigin(origin)) return true;

  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    const bareHostname = hostname.replace(/^www\./, "");
    return corsOriginHostnames.some((allowed) => {
      const allowedBare = allowed.replace(/^www\./, "");
      return hostname === allowed || bareHostname === allowedBare || `www.${allowedBare}` === hostname || `www.${bareHostname}` === allowed || normalizedOrigin === `https://${allowedBare}` || normalizedOrigin === `https://www.${allowedBare}`;
    });
  } catch {
    return false;
  }
};

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (isAllowedCorsOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
  }),
);
app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
  if (req.method === "POST" && (req.url ?? "").includes("/api/functions/create-mp-preference")) {
    console.log("create-mp-preference request metadata", {
      method: req.method,
      url: req.url,
      contentType: req.get("content-type"),
      contentLength: req.get("content-length"),
    });
  }
  return next();
});
app.use(express.json({
  limit: "15mb",
  verify: (req: express.Request, _res: express.Response, buf: Buffer) => {
    if (req.method === "POST" && (req.url ?? "").includes("/api/functions/create-mp-preference")) {
      const preview = buf.toString("utf8").slice(0, 200);
      console.log("create-mp-preference raw body", {
        method: req.method,
        url: req.url,
        contentType: req.get("content-type"),
        contentLength: req.get("content-length"),
        bodyPreview: preview,
      });
    }
  },
}));
app.use("/api/functions/create-mp-preference", (error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof SyntaxError && "body" in error) {
    console.error("create-mp-preference invalid json", {
      message: error.message,
      contentType: req.get("content-type"),
      host: req.get("host"),
      origin: req.get("origin"),
      tokenConfigured: Boolean(env.MERCADOPAGO_ACCESS_TOKEN_CLIENT || env.MERCADOPAGO_ACCESS_TOKEN),
      step: "json_body_parse",
    });

    return res.status(400).json({
      error: "invalid_json",
      message: "El cuerpo de la petición no es un JSON válido",
      step: "json_body_parse",
      tokenConfigured: Boolean(env.MERCADOPAGO_ACCESS_TOKEN_CLIENT || env.MERCADOPAGO_ACCESS_TOKEN),
      itemsCount: 0,
    });
  }

  return next(error);
});
app.use("/uploads", express.static(uploadsDir));

const wrap = (value: unknown): unknown => {
  if (value instanceof Prisma.Decimal) return Number(value);
  if (Array.isArray(value)) return value.map(wrap);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, wrap(nested)]));
  }
  return value;
};

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
const serializeOrder = (order: Order) => wrap({ ...order, total: order.total, discountAmount: order.discountAmount, couponCode: order.couponCode });
const serializeCoupon = (coupon: Coupon) => wrap({
  code: coupon.code,
  type: coupon.type,
  value: coupon.value,
  active: coupon.active,
  minimumSubtotal: coupon.minimumSubtotal,
  expiresAt: coupon.expiresAt,
  createdAt: coupon.createdAt,
  updatedAt: coupon.updatedAt,
});
const serializeCedulaEmail = (row: CedulaEmail) => row;

const getMailer = () => {
  const host = env.SMTP_HOST;
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port: Number(env.SMTP_PORT ?? "587"),
    secure: String(env.SMTP_SECURE ?? "false") === "true",
    auth: { user, pass },
  });
};

const moneyFormatter = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

const buildMpDiagnostic = (payload: {
  error: string;
  message: string;
  step: string;
  mercadoPagoStatus: number | null;
  mercadoPagoResponse: unknown;
  tokenConfigured: boolean;
  itemsCount: number;
  validationErrors?: unknown;
  tokenLength?: number;
  tokenSource?: string;
}) => ({
  error: payload.error,
  message: payload.message,
  step: payload.step,
  mercadoPagoStatus: payload.mercadoPagoStatus,
  mercadoPagoResponse: payload.mercadoPagoResponse,
  tokenConfigured: payload.tokenConfigured,
  tokenLength: payload.tokenLength,
  tokenSource: payload.tokenSource,
  itemsCount: payload.itemsCount,
  ...(payload.validationErrors !== undefined ? { validationErrors: payload.validationErrors } : {}),
});

const sanitizeForLogs = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 5).map(sanitizeForLogs);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, sanitizeForLogs(nested)]));
  }
  return value;
};

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

  const fromEmail = env.SMTP_FROM ?? env.SMTP_USER;
  if (!fromEmail) return;

  await mailer.sendMail({
    from: `"${env.SMTP_FROM_NAME ?? "Shelby Importaciones"}" <${fromEmail}>`,
    to: customerEmail,
    subject: `Factura Shelby - Pedido ${order.id}`,
    text: buildInvoiceText(order),
  });
};

const normalizeOrderCreateData = (row: Record<string, unknown>) => ({
  items: Array.isArray(row.items) ? row.items : [],
  total: new Prisma.Decimal(Number(row.total ?? 0)),
  shipping: Number(row.shipping ?? 0),
  discountAmount: row.discountAmount !== undefined ? parseDecimal(row.discountAmount) : null,
  couponCode: row.couponCode !== undefined ? String(row.couponCode) : row.coupon_code !== undefined ? String(row.coupon_code) : undefined,
  status: String(row.status ?? "pending"),
  paymentMethod: row.paymentMethod !== undefined ? String(row.paymentMethod) : row.payment_method !== undefined ? String(row.payment_method) : undefined,
  customerName: row.customerName !== undefined ? String(row.customerName) : row.customer_name !== undefined ? String(row.customer_name) : undefined,
  customerEmail: row.customerEmail !== undefined ? String(row.customerEmail).trim().toLowerCase() : row.customer_email !== undefined ? String(row.customer_email).trim().toLowerCase() : undefined,
  customerPhone: row.customerPhone !== undefined ? String(row.customerPhone) : row.customer_phone !== undefined ? String(row.customer_phone) : undefined,
  customerCity: row.customerCity !== undefined ? String(row.customerCity) : row.customer_city !== undefined ? String(row.customer_city) : undefined,
  customerAddress: row.customerAddress !== undefined ? String(row.customerAddress) : row.customer_address !== undefined ? String(row.customer_address) : undefined,
  notes: row.notes !== undefined ? String(row.notes) : undefined,
  userId: row.userId !== undefined ? String(row.userId) : row.user_id !== undefined ? String(row.user_id) : undefined,
});

const normalizeOrderUpdateData = (row: Record<string, unknown>) => {
  const data: Record<string, unknown> = {};
  if (row.items !== undefined) data.items = Array.isArray(row.items) ? row.items : [];
  if (row.total !== undefined) data.total = new Prisma.Decimal(Number(row.total));
  if (row.shipping !== undefined) data.shipping = Number(row.shipping);
  if (row.discountAmount !== undefined) data.discountAmount = parseDecimal(row.discountAmount) ?? undefined;
  if (row.discount_amount !== undefined) data.discountAmount = parseDecimal(row.discount_amount) ?? undefined;
  if (row.couponCode !== undefined) data.couponCode = String(row.couponCode);
  if (row.coupon_code !== undefined) data.couponCode = String(row.coupon_code);
  if (row.status !== undefined) data.status = String(row.status);
  if (row.paymentMethod !== undefined) data.paymentMethod = String(row.paymentMethod);
  if (row.payment_method !== undefined) data.paymentMethod = String(row.payment_method);
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
  return data;
};

const issueSession = (user: User): StoredSession => {
  const payload: AuthPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    cedula: user.cedula,
    isAdmin: user.isAdmin,
  };

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

const readAuth = (authorization?: string) => {
  if (!authorization?.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authorization.slice(7), jwtSecret) as AuthPayload;
  } catch {
    return null;
  }
};

const requireAuth = (req: express.Request, res: express.Response) => {
  const auth = readAuth(req.headers.authorization);
  if (!auth) {
    res.status(401).json({ error: "No autorizado" });
    return null;
  }
  return auth;
};

const requireAdmin = async (req: express.Request, res: express.Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  const user = await prisma.user.findUnique({ where: { id: auth.sub } });
  if (!user || !user.isAdmin) {
    res.status(403).json({ error: "Solo administradores" });
    return null;
  }
  return user;
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
  res.json({
    ok: true,
    service: "shelby-mysql-backend",
    env: {
      hasMercadoPagoToken: Boolean(env.MERCADOPAGO_ACCESS_TOKEN_CLIENT ?? env.MERCADOPAGO_ACCESS_TOKEN),
      hasDatabaseUrl: Boolean(env.DATABASE_URL),
      hasCorsOrigin: Boolean(env.CORS_ORIGIN),
    },
  });
});

app.post("/api/test-payment-route", (_req, res) => {
  res.json({ ok: true });
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

app.post("/api/auth/verify", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: "email es requerido" });
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  return res.json({ session: issueSession(user), user: serializeUser(user) });
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
  try {
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
    else if (table === "cedula_emails") rows = (await prisma.cedulaEmail.findMany()).map((row) => serializeCedulaEmail(row) as Record<string, unknown>);    else if (table === "coupons") rows = (await prisma.coupon.findMany()).map((row) => serializeCoupon(row) as Record<string, unknown>);    else return res.status(404).json({ error: "Tabla no soportada" });

    const filtered = applyFilters(rows, filters);
    const ordered = orderBy ? [...filtered].sort((a, b) => {
      const left = String(a[orderBy] ?? "");
      const right = String(b[orderBy] ?? "");
      return ascending ? left.localeCompare(right) : right.localeCompare(left);
    }) : filtered;
    const sliced = typeof limit === "number" ? ordered.slice(0, limit) : ordered;

    if (single || maybeSingle) return res.json(sliced[0] ?? null);
    return res.json(sliced);
  } catch (error) {
    console.error("GET /api/data error", error);
    return res.status(500).json({ error: "Error consultando datos", details: error instanceof Error ? error.message : String(error) });
  }
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
      const order = await prisma.order.upsert({
        where: { id: orderId },
        update: normalizeOrderCreateData(row),
        create: {
          id: orderId,
          ...normalizeOrderCreateData(row),
        },
      });
      if (revenueStatuses.has(order.status.toLowerCase()) && order.customerEmail && !order.invoiceSentAt) {
        await sendInvoiceEmail(order);
        await prisma.order.update({ where: { id: order.id }, data: { invoiceSentAt: new Date() } });
      }
      saved.push(order);
    }
    return res.json(saved.map(serializeOrder));
  }

  if (table === "coupons") {
    const rows = Array.isArray(body) ? body : [body];
    const saved: Coupon[] = [];
    for (const row of rows as Array<Record<string, unknown>>) {
      const code = String(row.code || "").trim().toUpperCase();
      if (!code) continue;
      const coupon = await prisma.coupon.upsert({
        where: { code },
        update: {
          type: String(row.type ?? "fixed"),
          value: parseDecimal(row.value) ?? new Prisma.Decimal(0),
          active: row.active !== undefined ? Boolean(row.active) : true,
          minimumSubtotal: row.minimumSubtotal !== undefined ? parseDecimal(row.minimumSubtotal) : null,
          expiresAt: row.expiresAt ? new Date(String(row.expiresAt)) : null,
        },
        create: {
          code,
          type: String(row.type ?? "fixed"),
          value: parseDecimal(row.value) ?? new Prisma.Decimal(0),
          active: row.active !== undefined ? Boolean(row.active) : true,
          minimumSubtotal: row.minimumSubtotal !== undefined ? parseDecimal(row.minimumSubtotal) : null,
          expiresAt: row.expiresAt ? new Date(String(row.expiresAt)) : null,
        },
      });
      saved.push(coupon);
    }
    return res.json(saved.map(serializeCoupon));
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
          price: payload.price !== undefined ? (parseDecimal(payload.price) ?? undefined) : undefined,
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

  if (table === "coupons") {
    const rows = await prisma.coupon.findMany();
    const matched = applyFilters(rows.map(serializeCoupon) as Record<string, unknown>[], filters);
    const updated: Coupon[] = [];
    for (const row of matched) {
      const next = await prisma.coupon.update({
        where: { code: String(row.code) },
        data: {
          type: row.type !== undefined ? String(row.type) : undefined,
          value: row.value !== undefined ? parseDecimal(row.value) ?? undefined : undefined,
          active: row.active !== undefined ? Boolean(row.active) : undefined,
          minimumSubtotal: row.minimumSubtotal !== undefined ? parseDecimal(row.minimumSubtotal) : undefined,
          expiresAt: row.expiresAt !== undefined ? (row.expiresAt ? new Date(String(row.expiresAt)) : null) : undefined,
        },
      });
      updated.push(next);
    }
    return res.json(updated.map(serializeCoupon));
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

  if (table === "coupons") {
    const rows = await prisma.coupon.findMany();
    const matched = applyFilters(rows.map(serializeCoupon) as Record<string, unknown>[], filters);
    for (const row of matched) await prisma.coupon.delete({ where: { code: String(row.code) } });
    return res.json({ deleted: matched.length });
  }

  if (table === "profiles") {
    const rows = await prisma.user.findMany();
    const matched = applyFilters(rows.map(serializeUser) as Record<string, unknown>[], filters);
    for (const row of matched) await prisma.user.delete({ where: { id: String(row.id) } });
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

app.post("/api/functions/create-mp-preference", async (req, res) => {
  const rawTokenClient = env.MERCADOPAGO_ACCESS_TOKEN_CLIENT;
  const rawTokenDefault = env.MERCADOPAGO_ACCESS_TOKEN;
  const normalizeEnvVar = (value?: string) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    const match = trimmed.match(/^(["'])(.*)\1$/);
    return match ? match[2] : trimmed;
  };

  const tokenClient = normalizeEnvVar(rawTokenClient);
  const tokenDefault = normalizeEnvVar(rawTokenDefault);
  const accessToken = tokenClient || tokenDefault;
  const accessTokenSource = tokenClient ? "MERCADOPAGO_ACCESS_TOKEN_CLIENT" : tokenDefault ? "MERCADOPAGO_ACCESS_TOKEN" : undefined;
  const tokenDiagnostics = {
    tokenClientDefined: rawTokenClient !== undefined,
    tokenDefaultDefined: rawTokenDefault !== undefined,
    tokenClientEmpty: tokenClient === "",
    tokenDefaultEmpty: tokenDefault === "",
    accessTokenSource,
    tokenLength: accessToken?.length ?? 0,
  };

  const payload = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
  const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : undefined;
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const payer = payload.payer && typeof payload.payer === "object" ? (payload.payer as Record<string, unknown>) : {};
  const shipping = Number(payload.shipping ?? 0);
  const total = Number(payload.total ?? 0);
  const discountAmount = Number(payload.discountAmount ?? 0);
  const couponCode = typeof payload.couponCode === "string" ? payload.couponCode.trim().toUpperCase() : undefined;
  const normalizePhone = (value: unknown) => {
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return value.replace(/\D/g, "").trim();
    return "";
  };
  const normalizeEmail = (value: unknown) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  };
  const normalizeAddress = (value: unknown) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  };
  const backUrlsSource = payload.backUrls && typeof payload.backUrls === "object" ? (payload.backUrls as Record<string, unknown>) : undefined;
  const legacyBackUrlsSource = payload.back_urls && typeof payload.back_urls === "object" ? (payload.back_urls as Record<string, unknown>) : undefined;
  const backUrls = backUrlsSource ?? legacyBackUrlsSource;
  const receivedSummary = {
    orderId,
    itemCount: rawItems.length,
    payer: {
      nameProvided: typeof payer.name === "string" && Boolean(String(payer.name).trim()),
      emailProvided: typeof payer.email === "string" && Boolean(String(payer.email).trim()),
      phoneProvided: typeof payer.phone === "string" && Boolean(String(payer.phone).trim()),
      addressProvided: typeof payer.address === "string" && Boolean(String(payer.address).trim()),
      cityProvided: typeof payer.city === "string" && Boolean(String(payer.city).trim()),
    },
    shipping,
    total,
    discountAmount,
    couponCode,
    hasBackUrls: Boolean(backUrls),
  };

  console.log("create-mp-preference start", {
    ...tokenDiagnostics,
    ...receivedSummary,
    host: req.get("host"),
    origin: req.get("origin"),
    forwardedHost: req.get("x-forwarded-host"),
    forwardedProto: req.get("x-forwarded-proto"),
  });

  if (!accessToken) {
    return res.status(500).json(buildMpDiagnostic({
      error: "mercadopago_token_missing",
      message: "MERCADOPAGO_ACCESS_TOKEN no está configurado",
      step: "token_validation",
      mercadoPagoStatus: null,
      mercadoPagoResponse: null,
      tokenConfigured: false,
      itemsCount: rawItems.length,
      validationErrors: {
        missing: ["MERCADOPAGO_ACCESS_TOKEN_CLIENT", "MERCADOPAGO_ACCESS_TOKEN"],
        tokenDiagnostics,
      },
    }));
  }

  try {
    const validationErrors: string[] = [];
    if (!orderId) validationErrors.push("orderId requerido");
    if (!rawItems.length) validationErrors.push("items requerido");
    if (!Number.isFinite(total) || total < 0) validationErrors.push("total inválido");
    if (!Number.isFinite(shipping) || shipping < 0) validationErrors.push("shipping inválido");
    if (!Number.isFinite(discountAmount) || discountAmount < 0) validationErrors.push("discountAmount inválido");
    const cleanedEmail = normalizeEmail(payer.email);
    const cleanedPhone = normalizePhone(payer.phone);
    if (cleanedEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanedEmail)) validationErrors.push("payer.email inválido");
    if (cleanedPhone && cleanedPhone.length < 7) validationErrors.push("payer.phone inválido");

    if (backUrls) {
      const requiredBackUrlKeys = ["success", "failure", "pending"] as const;
      const missingBackUrls = requiredBackUrlKeys.filter((key) => typeof backUrls[key] !== "string" || !String(backUrls[key]).trim());
      if (missingBackUrls.length) validationErrors.push(`backUrls faltantes: ${missingBackUrls.join(", ")}`);
      for (const key of requiredBackUrlKeys) {
        const value = typeof backUrls[key] === "string" ? String(backUrls[key]).trim() : "";
        if (value && !/^https?:\/\//i.test(value)) validationErrors.push(`backUrls.${key} no es una URL válida`);
      }
    }

    if (validationErrors.length) {
      console.error("create-mp-preference validation failed", {
        validationErrors,
        receivedSummary,
      });
      return res.status(400).json(buildMpDiagnostic({
        error: "payload_invalid",
        message: "El payload recibido no cumple las validaciones mínimas",
        step: "payload_validation",
        mercadoPagoStatus: null,
        mercadoPagoResponse: null,
        tokenConfigured: true,
        itemsCount: rawItems.length,
        validationErrors,
      }));
    }

    const [first = "", ...rest] = (typeof payer.name === "string" ? payer.name : "").trim().split(" ");
    const surname = rest.join(" ") || undefined;

    const forwardedProto = req.get("x-forwarded-proto") || req.protocol || "https";
    const forwardedHost = req.get("x-forwarded-host") || req.get("host") || "localhost";
    const notificationUrl = buildAbsoluteUrl(forwardedProto, forwardedHost, "/api/functions/mp-webhook");

    const normalizeItem = (it: unknown) => {
      const item = it as Record<string, unknown>;
      return {
        id: String(item.id ?? ""),
        title: String(item.title ?? "").slice(0, 250),
        quantity: Math.max(1, Math.floor(Number(item.quantity ?? 0) || 1)),
        unit_price: Math.round(Number(item.unit_price ?? 0) || 0),
        currency_id: "COP",
        picture_url: item.picture_url ?? undefined,
      };
    };

    const items = rawItems.map(normalizeItem);
    const invalidItems = items.filter((item) => !item.id || !item.title || item.quantity <= 0 || item.unit_price < 0);
    if (invalidItems.length) {
      console.error("create-mp-preference invalid items", { invalidItems, items, receivedSummary });
      return res.status(400).json(buildMpDiagnostic({
        error: "items_invalid",
        message: "Los items no cumplen con el formato esperado",
        step: "item_validation",
        mercadoPagoStatus: null,
        mercadoPagoResponse: null,
        tokenConfigured: true,
        itemsCount: items.length,
        validationErrors: invalidItems,
      }));
    }

    const discountAmountNormalized = Math.max(0, Math.round(Number(discountAmount || 0)));
    if (shipping > 0) {
      items.push({ id: "shipping", title: "Envío", quantity: 1, unit_price: Math.round(Number(shipping) || 0), currency_id: "COP", picture_url: undefined });
    }

    if (discountAmountNormalized > 0) {
      items.push({
        id: "discount",
        title: couponCode ? `Descuento ${String(couponCode).toUpperCase()}` : "Descuento",
        quantity: 1,
        unit_price: -discountAmountNormalized,
        currency_id: "COP",
        picture_url: undefined,
      });
    }

    const preference: Record<string, unknown> = {
      items,
      external_reference: String(orderId),
      payer: {
        name: first || undefined,
        surname,
        email: cleanedEmail,
        phone: cleanedPhone ? { number: cleanedPhone } : undefined,
        address: normalizeAddress(payer.address) ? { street_name: normalizeAddress(payer.address) as string } : undefined,
      },
      statement_descriptor: "SHELBY",
      notification_url: notificationUrl,
    };

    if (backUrls) {
      const backUrlsData = {
        success: String(backUrls.success ?? ""),
        failure: String(backUrls.failure ?? ""),
        pending: String(backUrls.pending ?? ""),
      };
      if (backUrlsData.success && backUrlsData.failure && backUrlsData.pending) {
        preference.back_urls = backUrlsData;
        preference.auto_return = "approved";
      }
    }

    console.log("create-mp-preference payload", {
      accessTokenSource,
      orderId,
      items: items.map((item) => ({ id: item.id, title: item.title, quantity: item.quantity, unit_price: item.unit_price })),
      shipping,
      total,
      discountAmount: discountAmountNormalized,
      couponCode,
      backUrls: preference.back_urls,
      notification_url: notificationUrl,
      payer: {
        name: typeof preference.payer === "object" && preference.payer ? Boolean((preference.payer as Record<string, unknown>).name) : false,
        surname: typeof preference.payer === "object" && preference.payer ? Boolean((preference.payer as Record<string, unknown>).surname) : false,
        email: typeof preference.payer === "object" && preference.payer ? Boolean((preference.payer as Record<string, unknown>).email) : false,
        phone: typeof preference.payer === "object" && preference.payer ? Boolean((preference.payer as Record<string, unknown>).phone) : false,
        address: typeof preference.payer === "object" && preference.payer ? Boolean((preference.payer as Record<string, unknown>).address) : false,
      },
      external_reference: preference.external_reference,
      tokenConfigured: Boolean(accessToken),
      tokenSource: accessTokenSource,
    });

    let response: Response;
    try {
      response = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(preference),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Mercado Pago fetch error", {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        preference: sanitizeForLogs(preference),
        tokenDiagnostics,
      });
      return res.status(502).json(buildMpDiagnostic({
        error: "mercadopago_request_failed",
        message: "No se pudo conectar con Mercado Pago",
        step: "mercadopago_request",
        mercadoPagoStatus: null,
        mercadoPagoResponse: null,
        tokenConfigured: Boolean(accessToken),
        itemsCount: items.length,
      }));
    }

    const rawResponseBody = await response.text();
    let parsedResponseBody: unknown = null;
    try {
      parsedResponseBody = rawResponseBody ? JSON.parse(rawResponseBody) : null;
    } catch {
      parsedResponseBody = rawResponseBody;
    }

    console.log("Mercado Pago response", {
      status: response.status,
      ok: response.ok,
      body: sanitizeForLogs(parsedResponseBody),
      preference: sanitizeForLogs(preference),
      notificationUrl,
      backUrls: preference.back_urls,
      accessTokenSource,
      tokenConfigured: Boolean(accessToken),
    });

    if (!response.ok) {
      return res.status(response.status).json(buildMpDiagnostic({
        error: "mercadopago_rejected",
        message: "Mercado Pago rechazó la preferencia",
        step: "mercadopago_response",
        mercadoPagoStatus: response.status,
        mercadoPagoResponse: parsedResponseBody,
        tokenConfigured: Boolean(accessToken),
        itemsCount: items.length,
      }));
    }

    if (!parsedResponseBody || typeof parsedResponseBody !== "object") {
      console.error("Mercado Pago missing init_point", { parsedResponseBody, responseStatus: response.status });
      return res.status(502).json(buildMpDiagnostic({
        error: "mercadopago_invalid_response",
        message: "Mercado Pago no devolvió una respuesta válida",
        step: "mercadopago_response",
        mercadoPagoStatus: response.status,
        mercadoPagoResponse: parsedResponseBody,
        tokenConfigured: Boolean(accessToken),
        itemsCount: items.length,
      }));
    }

    const mpPayload = parsedResponseBody as Record<string, unknown>;
    if (typeof mpPayload.init_point !== "string") {
      console.error("Mercado Pago missing init_point", { mpPayload, responseStatus: response.status });
      return res.status(502).json(buildMpDiagnostic({
        error: "mercadopago_missing_init_point",
        message: "Mercado Pago no devolvió init_point",
        step: "mercadopago_response",
        mercadoPagoStatus: response.status,
        mercadoPagoResponse: mpPayload,
        tokenConfigured: Boolean(accessToken),
        itemsCount: items.length,
      }));
    }

    return res.json({
      id: mpPayload.id,
      init_point: mpPayload.init_point,
      sandbox_init_point: mpPayload.sandbox_init_point,
      error: null,
      message: "Preferencia creada",
      step: "mercadopago_success",
      mercadoPagoStatus: response.status,
      mercadoPagoResponse: mpPayload,
      tokenConfigured: Boolean(accessToken),
      itemsCount: items.length,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("create-mp-preference exception", {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      orderId,
      itemsCount: rawItems.length,
      tokenConfigured: Boolean(accessToken),
    });

    return res.status(500).json(buildMpDiagnostic({
      error: "endpoint_exception",
      message: errorMessage,
      step: "endpoint_exception",
      mercadoPagoStatus: null,
      mercadoPagoResponse: null,
      tokenConfigured: Boolean(accessToken),
      itemsCount: rawItems.length,
    }));
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error("Unhandled Express error", { message, stack });
  if (res.headersSent) {
    return next(error);
  }
  return res.status(500).json({ error: message, stack });
});

app.listen(port, async () => {
  await mkdir(uploadsDir, { recursive: true });
  console.log(`Shelby MySQL backend listening on http://localhost:${port}`);
});
