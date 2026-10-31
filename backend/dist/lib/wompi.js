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
        hasPublicKey: Boolean(config.publicKey),
        hasPrivateKey: Boolean(config.privateKey),
        hasIntegrityKey: Boolean(config.integrityKey),
        hasEventsKey: Boolean(config.eventsKey),
    });
    return config;
};
export const isWompiPublicEnvironment = (nodeEnvironment, renderFlag) => nodeEnvironment === "production" || ["true", "1", "yes"].includes(String(renderFlag ?? "").trim().toLowerCase());
export const isWompiPaymentSimulationEnabled = (nodeEnvironment, simulationFlag, isPublicEnvironment = isWompiPublicEnvironment(nodeEnvironment, process.env.RENDER)) => nodeEnvironment === "development" && simulationFlag === "true" && !isPublicEnvironment;
export const getWompiPaymentConfigError = (config, nodeEnvironment, simulationFlag, isPublicEnvironment = isWompiPublicEnvironment(nodeEnvironment, process.env.RENDER)) => {
    const credentialsConfigured = Boolean(config.publicKey && config.privateKey && config.eventsKey);
    const allCredentialsMissing = !config.publicKey && !config.privateKey && !config.eventsKey;
    if (credentialsConfigured || (allCredentialsMissing &&
        isWompiPaymentSimulationEnabled(nodeEnvironment, simulationFlag, isPublicEnvironment))) {
        return null;
    }
    return "Wompi payment configuration is incomplete";
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
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const extractWebhookSignature = (headerValue) => {
    const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!candidate)
        return null;
    const checksum = candidate.trim();
    return /^[a-f0-9]{64}$/i.test(checksum) ? checksum.toLowerCase() : null;
};
export const getWompiMerchantSignature = (event, eventsKey = getWompiConfig().eventsKey) => {
    if (!eventsKey || !isRecord(event) || !isRecord(event.signature) || !isRecord(event.data))
        return null;
    const properties = event.signature.properties;
    const timestamp = event.timestamp;
    if (!Array.isArray(properties) || properties.length === 0 || typeof timestamp !== "number" || !Number.isSafeInteger(timestamp)) {
        return null;
    }
    const values = [];
    for (const property of properties) {
        if (typeof property !== "string" || !property.trim())
            return null;
        const segments = property.split(".").filter(Boolean);
        if (segments[0] === "data")
            segments.shift();
        let value = event.data;
        for (const segment of segments) {
            if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, segment))
                return null;
            value = value[segment];
        }
        if (value === undefined || value === null || (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) {
            return null;
        }
        values.push(String(value));
    }
    return crypto.createHash("sha256").update(`${values.join("")}${timestamp}${eventsKey}`).digest("hex");
};
export const verifyWompiEventSignature = (event, checksumHeader) => {
    const { eventsKey } = getWompiConfig();
    if (!eventsKey)
        return false;
    const eventChecksum = isRecord(event) && isRecord(event.signature) && typeof event.signature.checksum === "string"
        ? event.signature.checksum
        : undefined;
    const headerChecksum = Array.isArray(checksumHeader)
        ? checksumHeader.find((value) => value.trim() !== "")
        : checksumHeader;
    const signatureSource = headerChecksum?.trim() ? headerChecksum : eventChecksum;
    const signature = extractWebhookSignature(signatureSource);
    if (!signature || !/^[a-f0-9]{64}$/i.test(signature))
        return false;
    const expected = getWompiMerchantSignature(event, eventsKey);
    if (!expected)
        return false;
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
