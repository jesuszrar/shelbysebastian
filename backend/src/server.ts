import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient, type Product, type Order, type User, type CedulaEmail, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { buildAbsoluteUrl } from "./lib/urls.js";

dotenv.config();

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.PORT || 3001);
const jwtSecret = process.env.JWT_SECRET || "change-me";
const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "uploads");
const revenueStatuses = new Set(["paid", "approved", "completed"]);

type AuthPayload = { sub: string; email: string; name: string; cedula: string; isAdmin: boolean };
type StoredSession = { user: { id: string; email: string; user_metadata: Record<string, unknown> }; access_token: string } | null;

const normalizeCedula = (value: string) => value.replace(/\D/g, "").trim();

const corsOrigins = process.env.CORS_ORIGIN?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
const corsOriginPattern = /^https:\/\/[a-z0-9-]+\.(netlify\.app|vercel\.app)$/i;
const corsOriginHostnames = corsOrigins
  .map((value) => {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return value.replace(/^https?:\/\//i, "").toLowerCase();
    }
  })
  .filter(Boolean);

const isAllowedCorsOrigin = (origin: string) => {
  const normalizedOrigin = origin.toLowerCase();
  if (corsOrigins.includes(origin) || corsOriginPattern.test(origin)) return true;

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
app.use(express.json({ limit: "15mb" }));
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
const serializeOrder = (order: Order) => wrap({ ...order, total: order.total });
const serializeCedulaEmail = (row: CedulaEmail) => row;

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
          oldPrice: payload.oldPrice !== undefined ? (parseDecimal(payload.oldPrice) ?? undefined) : undefined,
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
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN_CLIENT ?? process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(500).json({ error: "MERCADOPAGO_ACCESS_TOKEN no está configurado", details: { missing: ["MERCADOPAGO_ACCESS_TOKEN_CLIENT", "MERCADOPAGO_ACCESS_TOKEN"] } });
  }

  const body = req.body as {
    orderId?: string;
    items?: Array<{ id: string; title: string; quantity: number; unit_price: number; picture_url?: string }>;
    payer?: { name?: string; email?: string; phone?: string; address?: string; city?: string };
    shipping?: number;
    total?: number;
    backUrls?: { success?: string; failure?: string; pending?: string };
    back_urls?: { success?: string; failure?: string; pending?: string };
  };

  if (!body.orderId || !body.items?.length) return res.status(400).json({ error: "items y orderId son requeridos" });
  const [first = "", ...rest] = (body.payer?.name || "").trim().split(" ");
  const surname = rest.join(" ") || undefined;
  const backUrls = body.backUrls ?? body.back_urls;

  const requestOrigin = req.get("origin") || req.get("x-forwarded-host") || req.get("host") || "localhost";
  const notificationUrl = buildAbsoluteUrl(req.protocol || "https", requestOrigin, "/api/functions/mp-webhook");

  const preference: Record<string, unknown> = {
    items: body.items.map((it) => ({
      id: it.id,
      title: String(it.title).slice(0, 250),
      quantity: Math.max(1, Math.floor(Number(it.quantity) || 1)),
      unit_price: Math.round(Number(it.unit_price) || 0),
      currency_id: "COP",
      picture_url: it.picture_url,
    })),
    external_reference: body.orderId,
    payer: {
      name: first || undefined,
      surname,
      email: body.payer?.email,
      phone: body.payer?.phone ? { number: body.payer.phone } : undefined,
      address: body.payer?.address ? { street_name: body.payer.address } : undefined,
    },
    statement_descriptor: "SHELBY",
    notification_url: notificationUrl,
  };

  if (body.shipping && body.shipping > 0) {
    (preference.items as Array<Record<string, unknown>>).push({ id: "shipping", title: "Envío", quantity: 1, unit_price: Math.round(body.shipping), currency_id: "COP" });
  }

  if (backUrls?.success && backUrls?.failure && backUrls?.pending) {
    preference.back_urls = backUrls;
    preference.auto_return = "approved";
  }

  let response: Response;
  try {
    response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(preference),
    });
  } catch (error) {
    return res.status(502).json({ error: "No se pudo conectar con Mercado Pago", details: error instanceof Error ? error.message : String(error) });
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) return res.status(response.status).json({ error: String(data.message || "Error creando preferencia"), details: data });
  return res.json({ id: data.id, init_point: data.init_point, sandbox_init_point: data.sandbox_init_point });
});

app.listen(port, async () => {
  await mkdir(uploadsDir, { recursive: true });
  console.log(`Shelby MySQL backend listening on http://localhost:${port}`);
});
