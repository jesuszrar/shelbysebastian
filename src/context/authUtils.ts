export const ADMIN_CEDULA = "1108758522";

export const isAdminUser = (
  user: { cedula?: string | null } | null | undefined,
  session: { user?: { user_metadata?: { is_admin?: boolean } | null } | null } | null | undefined,
  activeCedula: string | null | undefined,
) => {
  const normalizedCedula = (activeCedula ?? user?.cedula ?? "").replace(/\D/g, "").trim();
  const metadataAdmin = Boolean(session?.user?.user_metadata?.is_admin);

  return normalizedCedula === ADMIN_CEDULA || metadataAdmin;
};
