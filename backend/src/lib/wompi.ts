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
  const config: WompiConfig = {
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
  console.log("[wompi config]", {
    baseUrl: config.baseUrl,
    hasPublicKey: Boolean(config.publicKey),
    hasPrivateKey: Boolean(config.privateKey),
    hasIntegrityKey: Boolean(config.integrityKey),
    hasEventsKey: Boolean(config.eventsKey),
  });
  return config;
};

export const isWompiPublicEnvironment = (nodeEnvironment: string | undefined, renderFlag: string | undefined) =>
  nodeEnvironment === "production" || ["true", "1", "yes"].includes(String(renderFlag ?? "").trim().toLowerCase());

export const isWompiPaymentSimulationEnabled = (
  nodeEnvironment: string | undefined,
  simulationFlag: string | undefined,
  isPublicEnvironment = isWompiPublicEnvironment(nodeEnvironment, process.env.RENDER),
) => nodeEnvironment === "development" && simulationFlag === "true" && !isPublicEnvironment;

export const getWompiPaymentConfigError = (
  config: Pick<WompiConfig, "publicKey" | "privateKey" | "eventsKey">,
  nodeEnvironment: string | undefined,
  simulationFlag: string | undefined,
  isPublicEnvironment = isWompiPublicEnvironment(nodeEnvironment, process.env.RENDER),
) => {
  const credentialsConfigured = Boolean(config.publicKey && config.privateKey && config.eventsKey);
  const allCredentialsMissing = !config.publicKey && !config.privateKey && !config.eventsKey;

  if (credentialsConfigured || (
    allCredentialsMissing &&
    isWompiPaymentSimulationEnabled(nodeEnvironment, simulationFlag, isPublicEnvironment)
  )) {
    return null;
  }

  return "Wompi payment configuration is incomplete";
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const extractWebhookSignature = (headerValue: string | string[] | undefined): string | null => {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!candidate) return null;
  const checksum = candidate.trim();
  return /^[a-f0-9]{64}$/i.test(checksum) ? checksum.toLowerCase() : null;
};

export const getWompiMerchantSignature = (event: unknown, eventsKey = getWompiConfig().eventsKey): string | null => {
  if (!eventsKey || !isRecord(event) || !isRecord(event.signature) || !isRecord(event.data)) return null;

  const properties = event.signature.properties;
  const timestamp = event.timestamp;
  if (!Array.isArray(properties) || properties.length === 0 || typeof timestamp !== "number" || !Number.isSafeInteger(timestamp)) {
    return null;
  }

  const values: string[] = [];
  for (const property of properties) {
    if (typeof property !== "string" || !property.trim()) return null;

    const segments = property.split(".").filter(Boolean);
    if (segments[0] === "data") segments.shift();
    let value: unknown = event.data;
    for (const segment of segments) {
      if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, segment)) return null;
      value = value[segment];
    }

    if (value === undefined || value === null || (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) {
      return null;
    }
    values.push(String(value));
  }

  return crypto.createHash("sha256").update(`${values.join("")}${timestamp}${eventsKey}`).digest("hex");
};

export const verifyWompiEventSignature = (event: unknown, checksumHeader: string | string[] | undefined) => {
  const { eventsKey } = getWompiConfig();
  if (!eventsKey) return false;

  const eventChecksum = isRecord(event) && isRecord(event.signature) && typeof event.signature.checksum === "string"
    ? event.signature.checksum
    : undefined;
  const headerChecksum = Array.isArray(checksumHeader)
    ? checksumHeader.find((value) => value.trim() !== "")
    : checksumHeader;
  const signatureSource = headerChecksum?.trim() ? headerChecksum : eventChecksum;
  const signature = extractWebhookSignature(signatureSource);
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;

  const expected = getWompiMerchantSignature(event, eventsKey);
  if (!expected) return false;
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
  return "payment_pending";
};

export const mapWompiStatusToUiState = (status: string | null | undefined, errorType?: string | null) => {
  const normalized = normalizeText(status).toUpperCase();
  if (errorType && ["NOT_FOUND_ERROR", "TRANSACTION_NOT_FOUND"].includes(errorType.toUpperCase())) {
    return { status: "payment_pending", reason: "transaction_not_found" as const };
  }
  if (normalized === "APPROVED") return { status: "payment_approved", reason: "approved" as const };
  if (normalized === "PENDING") return { status: "payment_pending", reason: "pending" as const };
  if (normalized === "DECLINED" || normalized === "VOIDED" || normalized === "ERROR" || normalized === "FAILED") {
    return { status: "payment_failed", reason: "declined_or_failed" as const };
  }
  return { status: "payment_pending", reason: "unknown" as const };
};
