export const getWompiErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  if (!message) return "No pudimos iniciar el pago.";

  if (normalized.includes("wompi") && (normalized.includes("key") || normalized.includes("token") || normalized.includes("configur"))) {
    return "Wompi no está configurado en este momento. Añade las claves en Render para habilitar el checkout.";
  }

  if (normalized.includes("failed to fetch") || normalized.includes("fetch")) {
    return "No pudimos contactar con Wompi en este momento. Puedes continuar por WhatsApp.";
  }

  return "No pudimos iniciar el pago. Puedes completar tu pedido por WhatsApp.";
};

export const getPaymentRedirectUrl = (paymentMethod: string | null | undefined) => {
  switch (paymentMethod) {
    case "nequi":
      return "https://www.nequi.com.co/";
    case "daviplata":
      return "https://www.daviplata.com/";
    default:
      return null;
  }
};
