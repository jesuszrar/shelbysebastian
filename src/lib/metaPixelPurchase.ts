const PURCHASE_TOKEN_KEY_PREFIX = "shelby:meta-purchase:";

const storage = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export const storeMetaPurchaseToken = (orderId: string, token: string) => {
  const target = storage();
  if (!target) {
    console.warn("[meta-pixel] session storage is unavailable for the purchase claim", { orderId });
    return false;
  }
  try {
    target.setItem(`${PURCHASE_TOKEN_KEY_PREFIX}${orderId}`, token);
    return true;
  } catch {
    console.warn("[meta-pixel] could not store the purchase claim", { orderId });
    return false;
  }
};

export const readMetaPurchaseToken = (orderId: string) => {
  const target = storage();
  if (!target) return null;
  try {
    return target.getItem(`${PURCHASE_TOKEN_KEY_PREFIX}${orderId}`);
  } catch {
    console.warn("[meta-pixel] could not read the purchase claim", { orderId });
    return null;
  }
};

export const removeMetaPurchaseToken = (orderId: string) => {
  const target = storage();
  if (!target) return;
  try {
    target.removeItem(`${PURCHASE_TOKEN_KEY_PREFIX}${orderId}`);
  } catch {
    console.warn("[meta-pixel] could not remove the purchase claim", { orderId });
  }
};
