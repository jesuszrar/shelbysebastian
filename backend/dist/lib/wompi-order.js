const toMinorUnits = (value) => {
    if (value === null || value === undefined || (typeof value !== "number" && typeof value !== "string" && typeof value !== "object")) {
        return null;
    }
    const normalized = String(value).trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized))
        return null;
    const [whole, fraction = ""] = normalized.split(".");
    const minorUnits = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
    if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER))
        return null;
    return Number(minorUnits);
};
const toIntegerMinorUnits = (value) => {
    if (typeof value === "number")
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
    if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value.trim()))
        return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
};
export const validateWompiPaymentRequest = (order, request) => {
    if (typeof request.reference !== "string" || request.reference.trim() !== order.id)
        return "reference_mismatch";
    const currency = request.currency === undefined || request.currency === null
        ? "COP"
        : typeof request.currency === "string" ? request.currency.trim().toUpperCase() : "";
    if (currency !== "COP")
        return "currency_mismatch";
    const expectedAmount = toMinorUnits(order.total);
    const requestedAmount = toMinorUnits(request.total);
    if (expectedAmount === null || requestedAmount === null || requestedAmount !== expectedAmount)
        return "amount_mismatch";
    return null;
};
export const validateWompiTransaction = (order, transaction) => {
    if (typeof transaction.reference !== "string" || transaction.reference.trim() !== order.id)
        return "reference_mismatch";
    if (typeof transaction.currency !== "string" || transaction.currency.trim().toUpperCase() !== "COP") {
        return "currency_mismatch";
    }
    const expectedAmount = toMinorUnits(order.total);
    const transactionAmount = toIntegerMinorUnits(transaction.amount_in_cents);
    if (expectedAmount === null || transactionAmount === null || transactionAmount !== expectedAmount)
        return "amount_mismatch";
    return null;
};
export const getWompiPaymentCreationError = (order) => {
    const status = order.status.trim().toLowerCase();
    if (["paid", "approved", "payment_approved", "completed", "shipped", "delivered"].includes(status) ||
        order.paymentStatus?.trim().toLowerCase() === "approved") {
        return "order_already_paid";
    }
    if (!["pending", "payment_pending", "payment_failed"].includes(status))
        return "order_not_payable";
    return null;
};
export const decideWompiOrderUpdate = (order, transactionId, nextStatus) => {
    const storedTransactionId = order.wompiTransactionId?.trim() || null;
    const isApproved = order.status === "payment_approved" || order.paymentStatus?.toLowerCase() === "approved";
    if (isApproved) {
        return storedTransactionId === transactionId
            ? { kind: "duplicate", status: order.status }
            : { kind: "conflict", reason: "order_already_approved" };
    }
    if (order.status === "payment_failed" && storedTransactionId === transactionId) {
        return { kind: "duplicate", status: order.status };
    }
    if (order.status === nextStatus && storedTransactionId === transactionId) {
        return { kind: "duplicate", status: order.status };
    }
    return { kind: "apply" };
};
