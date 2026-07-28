export const resolvePreferredPaymentMethod = (paymentMethods: Array<{ id?: string; name?: string }> | undefined, preferredPayment?: string) => {
  if (!preferredPayment) return undefined;

  const normalizedPreferred = String(preferredPayment).trim().toLowerCase();
  if (!normalizedPreferred) return undefined;

  const normalizedMethods = Array.isArray(paymentMethods) ? paymentMethods : [];
  const match = normalizedMethods.find((method) => {
    const id = String(method.id ?? "").trim().toLowerCase();
    const name = String(method.name ?? "").trim().toLowerCase();
    return id.includes(normalizedPreferred) || name.includes(normalizedPreferred);
  });

  return match?.id ? String(match.id) : undefined;
};
