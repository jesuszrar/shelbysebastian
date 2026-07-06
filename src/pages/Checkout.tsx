import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { formatCOP } from "@/data/products";
import { supabase } from "@/integrations/api/client";
import { toast } from "sonner";
import { CreditCard, Truck, MessageCircle, Lock, ShoppingBag, Copy, CheckCircle2, Loader2, Smartphone, Building2 } from "lucide-react";

type PaymentMethod = "mercadopago" | "nequi" | "transferencia";

const checkoutSchema = z.object({
  name: z.string().trim().min(2, "Nombre requerido").max(80),
  phone: z.string().trim().min(7, "Teléfono inválido").max(20),
  city: z.string().trim().min(2, "Ciudad requerida").max(60),
  address: z.string().trim().min(5, "Dirección requerida").max(200),
  notes: z.string().max(500).optional(),
  payment: z.enum(["mercadopago", "nequi", "transferencia"]),
});

const PAYMENT_DETAILS = {
  nequi: { label: "Nequi / Daviplata", holder: "Shelby Importaciones", account: "322 842 6561", bank: "Nequi · Daviplata" },
  transferencia: { label: "Transferencia bancaria", holder: "Shelby Importaciones SAS", account: "1234-5678-9012", bank: "Bancolombia · Cuenta de Ahorros" },
} as const;

const Checkout = () => {
  const { detailedItems, subtotal, shipping, total, clear, city: storedCity, setCity } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: user?.name ?? "",
    phone: "",
    city: storedCity || "",
    address: "",
    notes: "",
    payment: "mercadopago" as PaymentMethod,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"form" | "manual">("form");

  const orderId = useMemo(() => `SHB-${Date.now().toString(36).toUpperCase().slice(-6)}`, []);

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
    if (k === "city") setCity(v);
  };

  if (detailedItems.length === 0 && step === "form") {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center pt-32 pb-16 px-4">
          <div className="bg-card border border-border rounded-3xl p-12 text-center shadow-soft max-w-md">
            <ShoppingBag className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h1 className="font-display text-2xl text-secondary">Aún no hay productos</h1>
            <p className="text-muted-foreground mt-2">Agrega algo al carrito antes de finalizar la compra.</p>
            <Button asChild className="mt-6 bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft"><Link to="/products">Ver catálogo</Link></Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const validate = () => {
    setErrors({});
    const parsed = checkoutSchema.safeParse(form);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      parsed.error.issues.forEach((i) => { fe[i.path[0] as string] = i.message; });
      setErrors(fe);
      return null;
    }
    return parsed.data;
  };

  const buildWhatsAppMessage = (data: z.infer<typeof checkoutSchema>, paymentLabel: string) => {
    const productLines = detailedItems.map((it) => `• ${it.quantity} × ${it.product.name} — ${formatCOP(it.product.price * it.quantity)}`).join("\n");
    return encodeURIComponent(
      `¡Hola Shelby! Pedido *${orderId}*\n\n*Cliente:* ${data.name}\n*Teléfono:* ${data.phone}\n*Ciudad:* ${data.city}\n*Dirección:* ${data.address}\n*Pago:* ${paymentLabel}\n` +
      (data.notes ? `*Notas:* ${data.notes}\n` : "") +
      `\n*Productos:*\n${productLines}\n\n*Subtotal:* ${formatCOP(subtotal)}\n*Envío:* ${shipping === 0 ? "Gratis" : formatCOP(shipping)}\n*Total:* ${formatCOP(total)}`
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const data = validate();
    if (!data) return;

    if (data.payment === "mercadopago") {
      setLoading(true);
      try {
        const { data: res, error } = await supabase.functions.invoke("create-mp-preference", {
          body: {
            orderId,
            payer: { name: data.name, email: user?.email, phone: data.phone, address: data.address, city: data.city },
            items: detailedItems.map((it) => ({
              id: it.product.id, title: it.product.name, quantity: it.quantity, unit_price: it.product.price,
              picture_url: typeof window !== "undefined" ? new URL(it.product.image, window.location.origin).href : it.product.image,
            })),
            shipping,
            total,
            backUrls: {
              success: `${window.location.origin}/order-success?order=${orderId}&total=${total}&method=Mercado%20Pago&status=paid`,
              failure: `${window.location.origin}/order-success?order=${orderId}&total=${total}&method=Mercado%20Pago&status=failed`,
              pending: `${window.location.origin}/order-success?order=${orderId}&total=${total}&method=Mercado%20Pago&status=pending`,
            },
          },
        });
        if (error) throw error;
        if (!res?.init_point) throw new Error("No recibimos un enlace de pago de Mercado Pago.");
        clear();
        window.location.href = res.init_point;
      } catch (err) {
        setLoading(false);
        const msg = err instanceof Error ? err.message : "No pudimos iniciar el pago";
        toast.error("Mercado Pago no disponible", { description: msg + " — usa Nequi, transferencia o WhatsApp." });
      }
      return;
    }

    setStep("manual");
  };

  const handleManualConfirm = async () => {
    const data = validate();
    if (!data || data.payment === "mercadopago") return;
    setLoading(true);
    const paymentLabel = PAYMENT_DETAILS[data.payment].label;
    const message = buildWhatsAppMessage(data, paymentLabel);
    await new Promise((r) => setTimeout(r, 500));
    const finalTotal = total;
    clear();
    setLoading(false);
    toast.success("¡Pago reportado!", { description: "Validaremos tu transferencia en minutos." });
    window.open(`https://wa.me/573228426561?text=${message}`, "_blank");
    navigate(`/order-success?order=${orderId}&total=${finalTotal}&method=${encodeURIComponent(paymentLabel)}&status=pending`);
  };

  const handleWhatsAppFallback = () => {
    const data = validate();
    if (!data) return;
    const paymentLabel = data.payment === "mercadopago" ? "A coordinar por WhatsApp" : PAYMENT_DETAILS[data.payment].label;
    window.open(`https://wa.me/573228426561?text=${buildWhatsAppMessage(data, paymentLabel)}`, "_blank");
  };

  if (step === "manual" && form.payment !== "mercadopago") {
    const details = PAYMENT_DETAILS[form.payment];
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <main className="flex-1 pt-32 pb-16">
          <div className="container-shelby max-w-2xl">
            <button onClick={() => setStep("form")} className="text-sm text-muted-foreground hover:text-secondary transition-smooth mb-4">← Volver a editar el pedido</button>
            <div className="bg-card border border-border rounded-3xl p-8 shadow-elegant">
              <span className="text-primary text-xs uppercase tracking-[0.3em] font-semibold">Paso final</span>
              <h1 className="font-display text-3xl text-secondary mt-2">Realiza tu pago</h1>
              <p className="text-muted-foreground mt-2 text-sm">Pedido <span className="font-mono text-secondary">{orderId}</span> · Total <span className="font-display text-primary">{formatCOP(total)}</span></p>
              <div className="mt-6 grid gap-3">
                <PaymentDetailRow label="Titular" value={details.holder} />
                <PaymentDetailRow label={form.payment === "nequi" ? "Número" : "Cuenta"} value={details.account} copyable />
                <PaymentDetailRow label="Entidad" value={details.bank} />
                <PaymentDetailRow label="Monto a pagar" value={formatCOP(total)} copyable highlight />
              </div>
              <div className="mt-6 bg-accent/40 border border-border rounded-2xl p-4 text-sm text-secondary/80">
                <strong className="text-secondary">Importante:</strong> incluye el N.º de pedido <span className="font-mono">{orderId}</span> en la descripción.
              </div>
              <Button onClick={handleManualConfirm} disabled={loading} size="lg" className="w-full mt-6 h-12 bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft">
                {loading ? <><Loader2 className="h-5 w-5 animate-spin" /> Confirmando...</> : <><CheckCircle2 className="h-5 w-5" /> Ya realicé el pago</>}
              </Button>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 pt-32 pb-16">
        <div className="container-shelby">
          <div className="mb-8">
            <span className="text-primary text-xs uppercase tracking-[0.3em] font-semibold">Casi listo</span>
            <h1 className="font-display text-4xl sm:text-5xl text-secondary mt-2">Finaliza tu compra</h1>
            <p className="text-muted-foreground mt-2 text-sm"><Lock className="inline h-3.5 w-3.5 mr-1" /> Tus datos solo se usan para procesar el pedido.</p>
          </div>
          <form onSubmit={handleSubmit} className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <Section icon={Truck} title="Datos de envío">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Input label="Nombre completo" value={form.name} onChange={update("name")} error={errors.name} autoComplete="name" />
                  <Input label="Teléfono / WhatsApp" value={form.phone} onChange={update("phone")} error={errors.phone} type="tel" placeholder="3001234567" />
                  <Input label="Ciudad" value={form.city} onChange={update("city")} error={errors.city} placeholder="Bogotá, Medellín..." />
                  <Input label="Dirección" value={form.address} onChange={update("address")} error={errors.address} placeholder="Calle 123 # 45-67" />
                </div>
                <div className="mt-4">
                  <label className="text-sm font-medium text-secondary block mb-1.5">Notas (opcional)</label>
                  <textarea value={form.notes} onChange={update("notes")} rows={3} className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-smooth resize-none" placeholder="Referencias del lugar..." />
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  💡 Envío a Bogotá $8.000 · Otras ciudades $15.000 · Gratis desde $260.000
                </p>
              </Section>
              <Section icon={CreditCard} title="Método de pago">
                <div className="grid gap-3">
                  <PaymentOption value="mercadopago" selected={form.payment} onSelect={(v) => setForm((f) => ({ ...f, payment: v }))} icon={CreditCard} title="Mercado Pago" description="Tarjeta crédito, débito o PSE — pago directo y seguro" badge="Recomendado" />
                  <PaymentOption value="nequi" selected={form.payment} onSelect={(v) => setForm((f) => ({ ...f, payment: v }))} icon={Smartphone} title="Nequi / Daviplata" description="Te mostramos el número para enviar el pago" />
                  <PaymentOption value="transferencia" selected={form.payment} onSelect={(v) => setForm((f) => ({ ...f, payment: v }))} icon={Building2} title="Transferencia bancaria" description="Bancolombia y otros bancos — confirmación manual" />
                </div>
              </Section>
            </div>
            <aside className="lg:sticky lg:top-32 h-fit bg-card border border-border rounded-2xl p-6 shadow-elegant">
              <h2 className="font-display text-2xl text-secondary">Tu pedido</h2>
              <div className="mt-4 space-y-3 max-h-64 overflow-y-auto pr-1">
                {detailedItems.map((it) => (
                  <div key={it.productId} className="flex items-center gap-3 text-sm">
                    <img src={it.product.image} alt={it.product.name} className="h-12 w-12 rounded-lg object-cover bg-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-secondary truncate">{it.product.name}</div>
                      <div className="text-xs text-muted-foreground">{it.quantity} × {formatCOP(it.product.price)}</div>
                    </div>
                    <div className="font-semibold text-secondary text-sm">{formatCOP(it.product.price * it.quantity)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 space-y-2 text-sm border-t border-border pt-4">
                <div className="flex justify-between"><span>Subtotal</span><span>{formatCOP(subtotal)}</span></div>
                <div className="flex justify-between"><span>Envío</span><span>{shipping === 0 ? <span className="text-brand-green font-semibold">Gratis</span> : formatCOP(shipping)}</span></div>
                <div className="flex justify-between items-baseline pt-2 border-t border-border"><span className="font-semibold text-secondary">Total</span><span className="font-display text-2xl text-primary">{formatCOP(total)}</span></div>
              </div>
              <Button type="submit" disabled={loading} size="lg" className="w-full mt-6 h-12 bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft">
                {loading ? <><Loader2 className="h-5 w-5 animate-spin" /> Procesando...</> : form.payment === "mercadopago" ? <><CreditCard className="h-5 w-5" /> Pagar ahora</> : <><CheckCircle2 className="h-5 w-5" /> Continuar al pago</>}
              </Button>
              <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><span className="flex-1 border-t border-border" />o también<span className="flex-1 border-t border-border" /></div>
              <Button type="button" variant="outline" onClick={handleWhatsAppFallback} className="w-full h-11 border-whatsapp text-whatsapp hover:bg-whatsapp hover:text-white">
                <MessageCircle className="h-4 w-4" /> Coordinar por WhatsApp
              </Button>
              <p className="text-xs text-muted-foreground mt-3 text-center"><Lock className="inline h-3 w-3 mr-1" /> Pago 100% seguro · Datos cifrados</p>
            </aside>
          </form>
        </div>
      </main>
      <Footer />
    </div>
  );
};

function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-2xl p-6 shadow-soft">
      <header className="flex items-center gap-3 mb-5">
        <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center shadow-soft"><Icon className="h-5 w-5 text-primary-foreground" /></div>
        <h2 className="font-display text-xl text-secondary tracking-wide">{title}</h2>
      </header>
      {children}
    </section>
  );
}

function Input({ label, error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <div>
      <label className="text-sm font-medium text-secondary block mb-1.5">{label}</label>
      <input {...props} className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-smooth" />
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}

function PaymentOption({ value, selected, onSelect, icon: Icon, title, description, badge }: {
  value: PaymentMethod; selected: PaymentMethod; onSelect: (v: PaymentMethod) => void;
  icon: React.ComponentType<{ className?: string }>; title: string; description: string; badge?: string;
}) {
  const active = selected === value;
  return (
    <label className={`relative cursor-pointer flex items-start gap-4 border rounded-xl p-4 transition-smooth ${active ? "border-primary/50 bg-card shadow-soft ring-1 ring-primary/10" : "border-border hover:border-primary/40 bg-background"}`}>
      <input type="radio" name="payment" value={value} checked={active} onChange={() => onSelect(value)} className="sr-only" />
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-smooth ${active ? "bg-primary shadow-soft" : "bg-muted"}`}>
        <Icon className={`h-5 w-5 ${active ? "text-primary-foreground" : "text-muted-foreground"}`} />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-secondary">{title}</span>
          {badge && <span className="text-[10px] uppercase tracking-wider bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">{badge}</span>}
        </div>
        <p className={`text-xs mt-0.5 ${active ? "text-secondary/90" : "text-muted-foreground"}`}>{description}</p>
      </div>
    </label>
  );
}

function PaymentDetailRow({ label, value, copyable, highlight }: { label: string; value: string; copyable?: boolean; highlight?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); toast.success("Copiado"); setTimeout(() => setCopied(false), 1500); }
    catch { toast.error("No se pudo copiar"); }
  };
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${highlight ? "bg-accent border-primary/40" : "bg-background border-border"}`}>
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`font-mono ${highlight ? "font-display text-primary text-lg" : "text-secondary"}`}>{value}</span>
        {copyable && (
          <button type="button" onClick={copy} className="h-8 w-8 rounded-lg bg-muted hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-secondary" aria-label={`Copiar ${label}`}>
            {copied ? <CheckCircle2 className="h-4 w-4 text-brand-green" /> : <Copy className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

export default Checkout;
