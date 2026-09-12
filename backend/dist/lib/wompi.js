import crypto from "crypto";
export const WOMPI_METHOD_ORDER = ["CARD", "PSE", "NEQUI", "DAVIPLATA"];
const normalizeText = (value) => String(value ?? "").trim().toLowerCase();
export const getWompiConfig = () => {
    const environment = normalizeText(process.env.WOMPI_ENVIRONMENT || "production") === "sandbox" ? "sandbox" : "production";
    const config = {
        baseUrl: environment === "sandbox" ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1",
        // Normalize public key: treat literal "undefined" or "null" as missing
        publicKey: (() => {
            const raw = String(process.env.WOMPI_PUBLIC_KEY ?? "").trim();
            const lower = raw.toLowerCase();
            if (!raw || lower === "undefined" || lower === "null")
                return "";
            return raw;
        })(),
        privateKey: String(process.env.WOMPI_PRIVATE_KEY ?? "").trim(),
        integrityKey: String(process.env.WOMPI_INTEGRITY_KEY ?? "").trim(),
        eventsKey: String(process.env.WOMPI_EVENTS_KEY ?? "").trim(),
    };
    console.log("[wompi config]", {
        baseUrl: config.baseUrl,
        publicKeySuffix: config.publicKey ? config.publicKey.slice(-6) : null,
        hasPrivateKey: Boolean(config.privateKey),
        hasIntegrityKey: Boolean(config.integrityKey),
        hasEventsKey: Boolean(config.eventsKey),
    });
    return config;
};
export const normalizeWompiPaymentMethod = (value) => {
    const normalized = normalizeText(value);
    if (!normalized)
        return undefined;
    if (["card", "tarjeta", "credit_card", "credit-card", "visa", "mastercard", "debito", "débito"].includes(normalized))
        return "CARD";
    if (["pse"].includes(normalized))
        return "PSE";
    if (["nequi"].includes(normalized))
        return "NEQUI";
    if (["daviplata", "daviplata"].includes(normalized))
        return "DAVIPLATA";
    return undefined;
};
export const normalizePhoneNumber = (value) => String(value ?? "").replace(/\D/g, "");
export const isValidWompiPhoneNumber = (value) => value.length === 10;
const readNestedValues = (value, keys) => {
    if (!value || typeof value !== "object")
        return [];
    const row = value;
    return keys.flatMap((key) => {
        const nested = row[key];
        return nested === undefined || nested === null ? [] : [nested];
    });
};
export const extractWompiMerchantMethods = (payload) => {
    const discovered = new Map();
    const markMethod = (candidate) => {
        const normalized = normalizeWompiPaymentMethod(candidate ?? "");
        if (!normalized)
            return;
        discovered.set(normalized, String(candidate ?? normalized));
    };
    const visit = (value) => {
        if (!value)
            return;
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (typeof value === "string") {
            markMethod(value);
            return;
        }
        if (typeof value !== "object")
            return;
        const row = value;
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
            if (!entry || typeof entry !== "object")
                continue;
            const methodName = typeof entry.name === "string"
                ? String(entry.name)
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
export const getWompiAcceptanceToken = (payload) => {
    const queue = [payload];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || typeof current !== "object")
            continue;
        const row = current;
        const token = row.acceptance_token ?? row.acceptanceToken;
        if (typeof token === "string" && token.trim())
            return token.trim();
        for (const nested of readNestedValues(row, ["data", "presigned_acceptance", "merchant", "merchant_data", "merchantData"])) {
            queue.push(nested);
        }
    }
    return null;
};
export const buildWompiAuthorizationHeader = () => {
    const { privateKey } = getWompiConfig();
    return privateKey ? { Authorization: `Bearer ${privateKey}` } : {};
};
export const buildWompiTransactionIntegritySignature = (reference, amountInCents, currency, integrityKey) => {
    const signatureString = `${reference}${amountInCents}${currency}${integrityKey}`;
    return crypto.createHash("sha256").update(signatureString).digest("hex");
};
export const getWompiMerchantSignature = (rawBody) => {
    const { eventsKey } = getWompiConfig();
    return crypto.createHmac("sha256", eventsKey).update(rawBody).digest("hex");
};
export const extractWebhookSignature = (headerValue) => {
    const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!candidate)
        return null;
    const normalized = candidate.trim();
    if (!normalized)
        return null;
    const match = normalized.match(/(?:sha256=|v1=)?([a-f0-9]{32,})/i);
    return (match?.[1] ?? normalized).toLowerCase();
};
export const verifyWompiEventSignature = (rawBody, signatureHeader) => {
    const { eventsKey } = getWompiConfig();
    if (!eventsKey)
        return false;
    const signature = extractWebhookSignature(signatureHeader);
    if (!signature)
        return false;
    const expected = crypto.createHmac("sha256", eventsKey).update(rawBody).digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const signatureBuffer = Buffer.from(signature, "hex");
    if (expectedBuffer.length !== signatureBuffer.length)
        return false;
    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
};
export const mapWompiStatusToOrderStatus = (status) => {
    const normalized = normalizeText(status).toUpperCase();
    if (normalized === "APPROVED")
        return "payment_approved";
    if (normalized === "PENDING")
        return "payment_pending";
    if (normalized === "DECLINED" || normalized === "VOIDED" || normalized === "ERROR" || normalized === "FAILED")
        return "payment_failed";
    return "payment_pending";
};
export const mapWompiStatusToUiState = (status, errorType) => {
    const normalized = normalizeText(status).toUpperCase();
    if (errorType && ["NOT_FOUND_ERROR", "TRANSACTION_NOT_FOUND"].includes(errorType.toUpperCase())) {
        return { status: "payment_pending", reason: "transaction_not_found" };
    }
    if (normalized === "APPROVED")
        return { status: "payment_approved", reason: "approved" };
    if (normalized === "PENDING")
        return { status: "payment_pending", reason: "pending" };
    if (normalized === "DECLINED" || normalized === "VOIDED" || normalized === "ERROR" || normalized === "FAILED") {
        return { status: "payment_failed", reason: "declined_or_failed" };
    }
    return { status: "payment_pending", reason: "unknown" };
};
