import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type MetaPurchaseItem = {
  id: string;
  quantity: number;
  item_price: number;
};

const approvedOrderStatuses = new Set(["paid", "approved", "completed", "payment_approved"]);

export const createMetaPurchaseCredential = () => {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
  };
};

export const matchesMetaPurchaseCredential = (token: string, tokenHash: string) => {
  const suppliedHash = Buffer.from(createHash("sha256").update(token).digest("hex"), "hex");
  const storedHash = Buffer.from(tokenHash, "hex");
  return suppliedHash.length === storedHash.length && timingSafeEqual(suppliedHash, storedHash);
};

export const isMetaPurchaseApproved = (status: unknown, paymentStatus: unknown) => {
  const normalizedStatus = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (!approvedOrderStatuses.has(normalizedStatus)) return false;
  if (paymentStatus === null || paymentStatus === undefined) return true;
  return typeof paymentStatus === "string" && paymentStatus.trim().toLowerCase() === "approved";
};

export const normalizeMetaPurchaseItems = (value: unknown): MetaPurchaseItem[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;

  const items: MetaPurchaseItem[] = [];
  for (const rawItem of value) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return null;
    const item = rawItem as Record<string, unknown>;
    const productId = typeof item.productId === "string" ? item.productId : "";
    const variantId = typeof item.variantId === "string" ? item.variantId : "";
    const quantity = Number(item.quantity);
    const itemPrice = Number(item.unit_price);
    if (
      !productId ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(itemPrice) ||
      itemPrice < 0
    ) return null;
    items.push({ id: variantId || productId, quantity, item_price: itemPrice });
  }
  return items;
};
