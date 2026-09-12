export const ADMIN_CEDULA = "1108758522";
export const normalizeCedula = (value) => (value ?? "").replace(/\D/g, "").trim();
export const isAdminUserRecord = (user) => {
    const normalizedCedula = normalizeCedula(user?.cedula);
    if (!normalizedCedula)
        return Boolean(user?.isAdmin);
    return normalizedCedula === ADMIN_CEDULA || Boolean(user?.isAdmin);
};
