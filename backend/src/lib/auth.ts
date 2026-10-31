export const isAdminUserRecord = (user: { isAdmin?: boolean | null } | null | undefined) =>
  Boolean(user?.isAdmin);
