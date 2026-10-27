export type AccessPrincipal = { id: string; isAdmin: boolean };

export type DataReadAccess =
  | "public"
  | "admin"
  | "owner-orders"
  | "public-order-status"
  | "denied";

export const resolveDataReadAccess = (
  table: string,
  principal: AccessPrincipal | null,
  hasExactOrderIdFilter = false,
): DataReadAccess => {
  if (table === "products" || table === "categories") return "public";

  if (table === "orders") {
    if (principal?.isAdmin) return "admin";
    if (principal) return "owner-orders";
    return hasExactOrderIdFilter ? "public-order-status" : "denied";
  }

  if (["profiles", "coupons", "coupon_audit", "cedula_emails"].includes(table)) {
    return principal?.isAdmin ? "admin" : "denied";
  }

  return "denied";
};

export const canSyncProfile = (principal: AccessPrincipal, targetUserId: string) =>
  principal.isAdmin || principal.id === targetUserId;

export const canLookupCedulaEmail = (
  principal: AccessPrincipal,
  ownCedula: string,
  requestedCedula: string,
) => principal.isAdmin || ownCedula === requestedCedula;

export const canManagePrivateData = (principal: AccessPrincipal | null) =>
  Boolean(principal?.isAdmin);

export const hasAdminRoleMutation = (payload: Record<string, unknown>) =>
  Object.prototype.hasOwnProperty.call(payload, "is_admin") ||
  Object.prototype.hasOwnProperty.call(payload, "isAdmin");
