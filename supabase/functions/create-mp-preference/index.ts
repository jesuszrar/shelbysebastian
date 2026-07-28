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
  preferredPayment?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Require a server-side Mercado Pago access token for preference creation.
    const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!accessToken) {
      return new Response(JSON.stringify({
        error: "mercadopago_token_missing",
        message: "Mercado Pago no está configurado. Agrega MERCADOPAGO_ACCESS_TOKEN en Supabase / Render.",
        step: "token_validation",
      }), {
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
      items.push({ id: "shipping", title: "Envío", quantity: 1, unit_price: Math.round(body.shipping), currency_id: "COP" });
    }

    const preference: Record<string, unknown> = { items };

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
