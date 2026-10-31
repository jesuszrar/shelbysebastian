export const isAdminUser = (
  user: { isAdmin?: boolean } | null | undefined,
  session: { user?: { user_metadata?: { is_admin?: boolean } | null } | null } | null | undefined,
) => {
  return Boolean(user?.isAdmin ?? session?.user?.user_metadata?.is_admin);
};
