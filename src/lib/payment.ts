export const getMercadoPagoErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (!message) return "No pudimos iniciar el pago.";

  if (message.includes("MERCADOPAGO_ACCESS_TOKEN") || message.includes("Mercado Pago no está configurado")) {
    return "Mercado Pago no está configurado en este momento. Puedes completar tu pedido por WhatsApp o elegir otro método de pago.";
  }

  if (message.includes("Failed to fetch") || message.includes("fetch")) {
    return "No pudimos contactar con Mercado Pago en este momento. Puedes continuar por WhatsApp.";
  }

  return "No pudimos iniciar el pago. Puedes completar tu pedido por WhatsApp.";
};
