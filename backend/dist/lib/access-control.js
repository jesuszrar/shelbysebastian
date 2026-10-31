export const resolveDataReadAccess = (table, principal, hasExactOrderIdFilter = false) => {
    if (table === "products" || table === "categories")
        return "public";
    if (table === "orders") {
        if (principal?.isAdmin)
            return "admin";
        if (principal)
            return "owner-orders";
        return hasExactOrderIdFilter ? "public-order-status" : "denied";
    }
    if (["profiles", "coupons", "coupon_audit", "cedula_emails"].includes(table)) {
        return principal?.isAdmin ? "admin" : "denied";
    }
    return "denied";
};
export const canSyncProfile = (principal, targetUserId) => principal.isAdmin || principal.id === targetUserId;
export const canLookupCedulaEmail = (principal, ownCedula, requestedCedula) => principal.isAdmin || ownCedula === requestedCedula;
export const canManagePrivateData = (principal) => Boolean(principal?.isAdmin);
export const hasAdminRoleMutation = (payload) => Object.prototype.hasOwnProperty.call(payload, "is_admin") ||
    Object.prototype.hasOwnProperty.call(payload, "isAdmin");
