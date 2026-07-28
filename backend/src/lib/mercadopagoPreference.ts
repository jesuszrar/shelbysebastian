export type MercadoPagoPreferenceBody = {
  orderId: string;
  items: Array<{ id: string; title: string; quantity: number; unit_price: number; picture_url?: string }>;
  payer?: { name?: string; email?: string; phone?: string; address?: string; city?: string };
  shipping?: number;
  total?: number;
  backUrls?: { success?: string; failure?: string; pending?: string };
  back_urls?: { success?: string; failure?: string; pending?: string };
};

export const buildMercadoPagoPreferencePayload = (
  body: MercadoPagoPreferenceBody,
  _origin: string,
) => {
  // Minimal payload: only items (and shipping when added by caller).
  // Exclude external_reference, back_urls, notification_url and payer metadata
  // to reduce PolicyAgent rejection risk.
  const preference: Record<string, unknown> = {
    items: body.items.map((it) => ({
      id: it.id,
      title: String(it.title).slice(0, 250),
      quantity: Math.max(1, Math.floor(Number(it.quantity) || 1)),
      unit_price: Math.round(Number(it.unit_price) || 0),
      currency_id: "COP",
      picture_url: it.picture_url,
    })),
  };

  return preference;
};
