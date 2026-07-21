export const getMercadoPagoErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  if (!message) return "No pudimos iniciar el pago.";

  if (normalized.includes("mercadopago") && (normalized.includes("token") || normalized.includes("configur"))) {
    return "Mercado Pago no está configurado en este momento. Añade el token de acceso en Supabase o Render para habilitar el checkout.";
  }

  if (normalized.includes("failed to fetch") || normalized.includes("fetch")) {
    return "No pudimos contactar con Mercado Pago en este momento. Puedes continuar por WhatsApp.";
  }

  return "No pudimos iniciar el pago. Puedes completar tu pedido por WhatsApp.";
};
