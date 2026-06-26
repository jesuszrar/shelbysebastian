const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Item { id: string; title: string; quantity: number; unit_price: number; picture_url?: string }
interface Payer { name?: string; email?: string; phone?: string; address?: string; city?: string }
interface BackUrls { success?: string; failure?: string; pending?: string }
interface Body {
  orderId: string;
  items: Item[];
  payer: Payer;
  shipping: number;
  total: number;
  backUrls?: BackUrls;
  back_urls?: BackUrls;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Prefer a client-provided token name if available, fall back to the default
    const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN_CLIENT") ?? Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Mercado Pago no está configurado. Agrega MERCADOPAGO_ACCESS_TOKEN." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    if (!body?.items?.length || !body?.orderId) {
      return new Response(JSON.stringify({ error: "items y orderId son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const items = body.items.map((it) => ({
      id: it.id,
      title: String(it.title).slice(0, 250),
      quantity: Math.max(1, Math.floor(Number(it.quantity) || 1)),
      unit_price: Math.round(Number(it.unit_price) || 0),
      currency_id: "COP",
      picture_url: it.picture_url,
    }));

    if (body.shipping > 0) {
      items.push({ id: "shipping", title: "Envío", quantity: 1, unit_price: Math.round(body.shipping), currency_id: "COP", picture_url: undefined });
    }

    const [first = "", ...rest] = (body.payer?.name || "").trim().split(" ");
    const surname = rest.join(" ") || undefined;

    // CRÍTICO: normalizar backUrls (camelCase del frontend) -> back_urls (snake_case que MP exige)
    const backUrls = body.backUrls ?? body.back_urls;

    const preference: Record<string, unknown> = {
      items,
      external_reference: body.orderId,
      payer: {
        name: first || undefined,
        surname,
        email: body.payer?.email,
        phone: body.payer?.phone ? { number: body.payer.phone } : undefined,
        address: body.payer?.address ? { street_name: body.payer.address } : undefined,
      },
      statement_descriptor: "SHELBY",
      notification_url: `${new URL(req.url).origin}/functions/v1/mp-webhook`,
    };

    // CRÍTICO: solo agregar auto_return si las 3 back_urls están presentes,
    // de lo contrario MP responde 400 "auto_return invalid. back_url.success must be defined"
    if (backUrls?.success && backUrls?.failure && backUrls?.pending) {
      preference.back_urls = {
        success: backUrls.success,
        failure: backUrls.failure,
        pending: backUrls.pending,
      };
      preference.auto_return = "approved";
    } else {
      console.warn("Incomplete back_urls; auto_return omitted", backUrls);
    }

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(preference),
    });

    const data = await mpRes.json();
    if (!mpRes.ok) {
      console.error("MP error", mpRes.status, data);
      return new Response(JSON.stringify({ error: data?.message || "Error creando preferencia", details: data }), {
        status: mpRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ id: data.id, init_point: data.init_point, sandbox_init_point: data.sandbox_init_point }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
