const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const tokenSource = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN_CLIENT") ? "MERCADOPAGO_ACCESS_TOKEN_CLIENT" : "MERCADOPAGO_ACCESS_TOKEN";
    const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN_CLIENT") ?? Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    console.log("[check-mp-methods] Using Mercado Pago token source:", tokenSource);
    console.log("[check-mp-methods] Mercado Pago token length:", accessToken?.length ?? 0);
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "mercadopago_token_missing", message: "Mercado Pago no está configurado." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const res = await fetch("https://api.mercadopago.com/v1/payment_methods", { headers: { "Authorization": `Bearer ${accessToken}` } });
    const data = await res.json();
    console.log("[check-mp-methods] Mercado Pago /v1/payment_methods status:", res.status);
    console.log("[check-mp-methods] Mercado Pago /v1/payment_methods response:", JSON.stringify(data, null, 2));

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "mp_error", details: data }), { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Return simplified list of ids and names
    const simplified = Array.isArray(data) ? data.map((m: any) => ({ id: m.id, name: m.name })) : [];
    const ids = simplified.map((m) => m.id);
    console.log("[check-mp-methods] Mercado Pago payment method IDs:", JSON.stringify(ids));
    return new Response(JSON.stringify({ methods: simplified }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
