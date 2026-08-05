import crypto from "crypto";

export type WompiPaymentMethod = "CARD" | "PSE" | "NEQUI" | "DAVIPLATA";

export type WompiConfig = {
  baseUrl: string;
  publicKey: string;
  privateKey: string;
  integrityKey: string;
  eventsKey: string;
};

export type WompiMerchantMethod = {
  id: WompiPaymentMethod;
  name: string;
  available: boolean;
};

export type WompiTransactionStatus = "PENDING" | "APPROVED" | "DECLINED" | "VOIDED" | "ERROR" | string;

export const WOMPI_METHOD_ORDER: WompiPaymentMethod[] = ["CARD", "PSE", "NEQUI", "DAVIPLATA"];

const normalizeText = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase();

export const getWompiConfig = (): WompiConfig => {
  const environment = normalizeText(process.env.WOMPI_ENVIRONMENT || "production") === "sandbox" ? "sandbox" : "production";
  return {
    baseUrl: environment === "sandbox" ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1",
    // Normalize public key: treat literal "undefined" or "null" as missing
    publicKey: (() => {
      const raw = String(process.env.WOMPI_PUBLIC_KEY ?? "").trim();
      const lower = raw.toLowerCase();
      if (!raw || lower === "undefined" || lower === "null") return "";
      return raw;
    })(),
    privateKey: String(process.env.WOMPI_PRIVATE_KEY ?? "").trim(),
    integrityKey: String(process.env.WOMPI_INTEGRITY_KEY ?? "").trim(),
    eventsKey: String(process.env.WOMPI_EVENTS_KEY ?? "").trim(),
  };
};

export const normalizeWompiPaymentMethod = (value: string | null | undefined): WompiPaymentMethod | undefined => {
  const normalized = normalizeText(value);
  if (!normalized) return undefined;
  if (["card", "tarjeta", "credit_card", "credit-card", "visa", "mastercard", "debito", "débito"].includes(normalized)) return "CARD";
  if (["pse"].includes(normalized)) return "PSE";
  if (["nequi"].includes(normalized)) return "NEQUI";
  if (["daviplata", "daviplata"].includes(normalized)) return "DAVIPLATA";
  return undefined;
};

export const normalizePhoneNumber = (value: unknown): string => String(value ?? "").replace(/\D/g, "");
export const isValidWompiPhoneNumber = (value: string): boolean => value.length === 10;

const readNestedValues = (value: unknown, keys: string[]): Array<unknown> => {
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  return keys.flatMap((key) => {
    const nested = row[key];
    return nested === undefined || nested === null ? [] : [nested];
  });
};

export const extractWompiMerchantMethods = (payload: unknown): WompiMerchantMethod[] => {
  const discovered = new Map<WompiPaymentMethod, string>();

  const markMethod = (candidate: string | null | undefined) => {
    const normalized = normalizeWompiPaymentMethod(candidate ?? "");
    if (!normalized) return;
    discovered.set(normalized, String(candidate ?? normalized));
  };

  const visit = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === "string") {
      markMethod(value);
      return;
    }
    if (typeof value !== "object") return;

    const row = value as Record<string, unknown>;
    const acceptedMethods = Array.isArray(row.accepted_payment_methods)
      ? row.accepted_payment_methods
      : Array.isArray(row.acceptedPaymentMethods)
        ? row.acceptedPaymentMethods
        : [];

    for (const entry of acceptedMethods) {
      if (typeof entry === "string") {
        markMethod(entry);
      }
    }

    const paymentMethods = Array.isArray(row.payment_methods) ? row.payment_methods : [];
    for (const entry of paymentMethods) {
      if (!entry || typeof entry !== "object") continue;
      const methodName = typeof (entry as Record<string, unknown>).name === "string"
        ? String((entry as Record<string, unknown>).name)
        : "";
      markMethod(methodName);
    }

    const candidate = [row.id, row.name, row.type, row.slug, row.code, row.method, row.payment_method_type]
      .map((entry) => (typeof entry === "string" ? entry : ""))
      .find(Boolean) ?? "";
    markMethod(candidate);

    for (const nested of readNestedValues(row, ["data", "payment_methods", "accepted_payment_methods", "acceptedPaymentMethods", "methods", "available_payment_methods", "enabled_payment_methods", "paymentMethods", "paymentMethodsEnabled", "items"])) {
      visit(nested);
    }
  };

  visit(payload);

  return WOMPI_METHOD_ORDER.map((id) => ({
    id,
    name: discovered.get(id) ?? id,
    available: discovered.has(id),
  }));
};

export const getWompiAcceptanceToken = (payload: unknown): string | null => {
  const queue: unknown[] = [payload];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    const row = current as Record<string, unknown>;
    const token = row.acceptance_token ?? row.acceptanceToken;
    if (typeof token === "string" && token.trim()) return token.trim();
    for (const nested of readNestedValues(row, ["data", "presigned_acceptance", "merchant", "merchant_data", "merchantData"])) {
      queue.push(nested);
    }
  }
  return null;
};

export const buildWompiAuthorizationHeader = (): Record<string, string> => {
  const { privateKey } = getWompiConfig();
  return privateKey ? { Authorization: `Bearer ${privateKey}` } : {};
};

export const buildWompiTransactionIntegritySignature = (reference: string, amountInCents: number, currency: string, integrityKey: string): string => {
  const signatureString = `${reference}${amountInCents}${currency}${integrityKey}`;
  return crypto.createHash("sha256").update(signatureString).digest("hex");
};

export const getWompiMerchantSignature = (rawBody: string) => {
  const { eventsKey } = getWompiConfig();
  return crypto.createHmac("sha256", eventsKey).update(rawBody).digest("hex");
};

export const extractWebhookSignature = (headerValue: string | string[] | undefined): string | null => {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!candidate) return null;
  const normalized = candidate.trim();
  if (!normalized) return null;
  const match = normalized.match(/(?:sha256=|v1=)?([a-f0-9]{32,})/i);
  return (match?.[1] ?? normalized).toLowerCase();
};

export const verifyWompiEventSignature = (rawBody: string, signatureHeader: string | string[] | undefined) => {
  const { eventsKey } = getWompiConfig();
  if (!eventsKey) return false;
  const signature = extractWebhookSignature(signatureHeader);
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", eventsKey).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");
  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
};

export const mapWompiStatusToOrderStatus = (status: string | null | undefined) => {
  const normalized = normalizeText(status).toUpperCase();
  if (normalized === "APPROVED") return "payment_approved";
  if (normalized === "PENDING") return "payment_pending";
  if (normalized === "DECLINED" || normalized === "VOIDED" || normalized === "ERROR" || normalized === "FAILED") return "payment_failed";
  return "payment_failed";
};
