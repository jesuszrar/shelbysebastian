import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { formatCOP } from "@/data/products";
import { toast } from "sonner";
import { CreditCard, Truck, MessageCircle, Lock, ShoppingBag, Copy, CheckCircle2, Loader2, Smartphone, Building2, Landmark } from "lucide-react";
import { SiVisa, SiMastercard } from "react-icons/si";
import { trackInitiateCheckout } from "@/lib/metaPixel";
import AddressList from "@/components/addresses/AddressList";
import { getUserAddresses, createUserAddress } from "@/integrations/api/client";
import { getWompiErrorMessage } from "@/lib/payment";

type PaymentMethod = "card" | "pse" | "nequi" | "daviplata" | "transferencia";

const checkoutSchema = z.object({
  name: z.string().trim().min(2, "Nombre requerido").max(80),
  email: z.string().trim().email("Correo inválido").max(120),
  phone: z.string().trim().min(7, "Teléfono inválido").max(20),
  department: z.string().trim().min(2, "Departamento requerido").max(60),
  city: z.string().trim().min(2, "Ciudad requerida").max(60),
  address: z.string().trim().min(5, "Dirección requerida").max(200),
  notes: z.string().max(500).optional(),
  payment: z.enum(["card", "pse", "nequi", "daviplata", "transferencia"]),
});

const PAYMENT_DETAILS = {
  transferencia: { label: "Transferencia bancaria", holder: "Shelby Importaciones SAS", account: "1234-5678-9012", bank: "Bancolombia · Cuenta de Ahorros" },
} as const;

const WOMPI_PAYMENT_LABELS: Record<Exclude<PaymentMethod, "transferencia">, string> = {
  card: "Tarjeta",
  pse: "PSE",
  nequi: "Nequi",
  daviplata: "Daviplata",
};

const PAYMENT_METHOD_NOTES: Record<PaymentMethod, string> = {
  card: "El pago con tarjeta se procesa en Wompi. Si no ves ningún paso, espera unos segundos y no recargues hasta que se muestre la pantalla de pago.",
  pse: "PSE puede abrir un enlace bancario. Mantén esta ventana abierta mientras Wompi carga la confirmación.",
  nequi: "Nequi enviará un push al número indicado. Asegúrate de usar un número Nequi activo de 10 dígitos y no cerrar esta ventana.",
  daviplata: "Daviplata pedirá autorización desde la app. Revisa el teléfono y espera la confirmación en la app de Daviplata.",
  transferencia: "En transferencia no hay pago automático. Copia los datos y coordina el pago por WhatsApp. Confirma el pago manualmente.",
};

const WOMPI_METHOD_OPTIONS: Array<{
  value: Exclude<PaymentMethod, "transferencia">;
  title: string;
  description: string;
  logo: React.ReactNode;
  disabled?: boolean;
}> = [
  {
    value: "card",
    title: "Tarjeta",
    description: "Pago seguro con tarjeta de crédito o débito vía Wompi",
    logo: (
      <div className="flex items-center gap-1.5">
        <SiVisa className="h-4 w-4 text-blue-600" />
        <SiMastercard className="h-4 w-4 text-red-500" />
      </div>
    ),
  },
  {
    value: "pse",
    title: "PSE",
    description: "Pago bancario directo vía Wompi",
    logo: <Landmark className="h-4 w-4 text-muted-foreground" />,
  },
  {
    value: "nequi",
    title: "Nequi",
    description: "Pago instantáneo vía Wompi",
    logo: (
      <img
        src="https://cdn.prod.website-files.com/6317a229ebf7723658463b4b/663a6b0d43303ddf38035997_logo-nequi.svg"
        alt="Nequi"
        className="h-5 w-5 object-contain"
      />
    ),
  },
  {
    value: "daviplata",
    title: "Daviplata",
    description: "Pago instantáneo vía Wompi",
    logo: (
      <img
        src="https://www.daviplata.com/documents/d/guest/daviplata-3"
        alt="Daviplata"
        className="h-5 w-5 object-contain"
      />
    ),
  },
];

const normalizePaymentStatus = (status?: string | null) => {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "payment_approved" || normalized === "approved") return "payment_approved" as const;
  if (normalized === "payment_failed" || normalized === "failed") return "payment_failed" as const;
  return "payment_pending" as const;
};

const Checkout = () => {
  const { detailedItems, subtotal, shipping, total, clear, city: storedCity, setCity } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: user?.name ?? "",
    email: user?.email ?? "",
    phone: "",
    department: "",
    city: storedCity || "",
    address: "",
    notes: "",
    payment: "card" as PaymentMethod,
  });
  const [addressesAvailable, setAddressesAvailable] = useState<boolean | null>(null);
  const [saveAddressOnCheckout, setSaveAddressOnCheckout] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [couponLoading, setCouponLoading] = useState(false);
  const [step, setStep] = useState<"form" | "manual">("form");

  const orderId = useMemo(() => `SHB-${Date.now().toString(36).toUpperCase().slice(-6)}`, []);

  const checkoutTotal = Math.max(subtotal + shipping - discountAmount, 0);

  useEffect(() => {
    trackInitiateCheckout({
      content_ids: detailedItems.map((it) => it.product.id),
      contents: detailedItems.map((it) => ({ id: it.product.id, quantity: it.quantity, item_price: it.product.price })),
      currency: "COP",
      num_items: detailedItems.reduce((sum, it) => sum + it.quantity, 0),
      value: total,
    });
  }, [detailedItems, total]);

  useEffect(() => {
    if (!user?.id) {
      setAddressesAvailable(false);
      return;
    }
    (async () => {
      const res = await getUserAddresses();
      if (res.error) { setAddressesAvailable(false); return; }
      setAddressesAvailable(Boolean(res.data && res.data.length > 0));
    })();
  }, [user?.id]);

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
    if (k === "city") setCity(v);
  };

  const extractWompiPaymentUrl = (res: unknown) => {
    const data = res as Record<string, unknown> | null;
    return data?.paymentUrl ?? data?.payment_url ?? data?.url ?? null;
  };

  const extractWompiPaymentLinkId = (res: unknown) => {
    const data = res as Record<string, unknown> | null;
    return data?.paymentLinkId ?? data?.payment_link_id ?? data?.paymentLink?.id ?? null;
  };

  const extractWompiTransactionId = (res: unknown) => {
    const data = res as Record<string, unknown> | null;
    return data?.transactionId ?? data?.transaction_id ?? null;
  };

  const isWompiResponseSuccessful = (res: unknown) => {
    const data = res as Record<string, unknown> | null;
    if (!data) return false;
    if (data.success === true) return true;
    if (data.ok === true) return true;
    return false;
  };

  const handleSelectAddress = (addr: Record<string, any>) => {
    setForm((f) => ({
      ...f,
      name: addr.fullName ?? f.name,
      email: addr.email ?? f.email,
      phone: addr.phone ?? f.phone,
      department: addr.department ?? f.department,
      city: addr.city ?? f.city,
      address: addr.address ?? f.address,
      notes: addr.reference ?? f.notes,
    }));
  };

  const saveOrder = async (status: "payment_pending" | "payment_approved" | "payment_failed", paymentMethod: PaymentMethod | "whatsapp", data: z.infer<typeof checkoutSchema>) => {
    const payload: Record<string, unknown> = {
      id: orderId,
      items: detailedItems.map((it) => ({
        productId: it.product.id,
        title: it.product.name,
        quantity: it.quantity,
        unit_price: it.product.price,
        lineTotal: it.product.price * it.quantity,
      })),
      total: checkoutTotal,
      shipping,
      discountAmount: discountAmount || null,
      couponCode: couponCode.trim().toUpperCase() || null,
      status,
      paymentMethod,
      // customer snapshot (existing)
      customerName: data.name,
      customerEmail: data.email,
      customerPhone: data.phone,
      customerCity: data.city,
      customerAddress: data.address,
      notes: data.notes || null,
      userId: user?.id || null,
      // shipping snapshot (explicit fields requested)
      shipping_name: data.name,
      shipping_email: data.email,
      shipping_phone: data.phone,
      shipping_department: (data as any).department ?? null,
      shipping_city: data.city,
      shipping_address: data.address,
      shipping_reference: data.notes || null,
    };

    const { error } = await postData("orders", payload);

    if (error) {
      throw error;
    }
    // If user wanted to save the address (and is authenticated) create it
    try {
      if (saveAddressOnCheckout && user?.id) {
        await createUserAddress({
          label: "Casa",
          fullName: data.name,
          cedula: user?.cedula ?? undefined,
          email: data.email,
          phone: data.phone,
          department: (data as any).department,
          city: data.city,
          address: data.address,
          reference: data.notes || undefined,
        });
      }
    } catch (e) {
      console.warn("No se pudo guardar la dirección automáticamente", e);
    }
  };

  const handleApplyCoupon = async () => {
    const code = couponCode.trim().toUpperCase();
    if (!code) {
      setCouponMessage("Ingresa un código de cupón.");
      return;
    }

    setCouponLoading(true);
    setCouponMessage(null);

    try {
const { data, error } = await invokeFunction("redeem-coupon", { code, subtotal, shipping });

      if (error || !data) {
        setCouponMessage(error?.message || "Cupón inválido o no encontrado.");
        setDiscountAmount(0);
        return;
      }

      const coupon = data as { ok?: boolean; coupon?: { code: string; type: string; value: number; minimumSubtotal?: number | null; expiresAt?: string | null }; discount?: number };
      if (!coupon.ok || !coupon.coupon) {
        setCouponMessage("Cupón inválido o no encontrado.");
        setDiscountAmount(0);
        return;
      }

      setDiscountAmount(Math.max(0, coupon.discount ?? 0));
      setCouponMessage(`Cupón aplicado: ${coupon.coupon.type === "percent" ? `${coupon.coupon.value}%` : formatCOP(coupon.coupon.value)} de descuento.`);
    } catch (err) {
      console.error(err);
      setCouponMessage("Error al validar el cupón.");
      setDiscountAmount(0);
    } finally {
      setCouponLoading(false);
    }
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
      `¡Hola Shelby! Pedido *${orderId}*\n\n*Cliente:* ${data.name}\n*Correo:* ${data.email}\n*Teléfono:* ${data.phone}\n*Ciudad:* ${data.city}\n*Dirección:* ${data.address}\n*Pago:* ${paymentLabel}\n` +
      (data.notes ? `*Notas:* ${data.notes}\n` : "") +
      (couponCode ? `*Cupón:* ${couponCode.trim().toUpperCase()}\n` : "") +
      (discountAmount ? `*Descuento:* ${formatCOP(discountAmount)}\n` : "") +
      `\n*Productos:*\n${productLines}\n\n*Subtotal:* ${formatCOP(subtotal)}\n*Envío:* ${shipping === 0 ? "Gratis" : formatCOP(shipping)}\n*Total:* ${formatCOP(checkoutTotal)}`
    );
  };

  const submitCheckout = async (data: z.infer<typeof checkoutSchema> & { payment: PaymentMethod }) => {
    if (loading) return;
    console.log("[checkout] payment flow start", { paymentMethod: data.payment, timestamp: Date.now() });
    setLoading(true);
    try {
      if (data.payment === "transferencia") {
        await saveOrder("payment_pending", data.payment, data);
        setStep("manual");
        setLoading(false);
        return;
      }

      await saveOrder("payment_pending", data.payment, data);
      const wompiEndpoint = "/api/payments/create-wompi-payment";
      console.log("[checkout] creating wompi payment", {
        endpoint: wompiEndpoint,
        paymentMethod: data.payment,
        total: checkoutTotal,
        customerEmail: data.email,
        reference: orderId,
        currency: "COP",
        redirectUrl: `${window.location.origin}/payment-processing?order=${orderId}`,
        customerName: data.name,
        customerPhone: data.phone,
      });
      const { data: res, error } = await createWompiPayment({
        products: detailedItems.map((it) => ({
          id: it.product.id,
          name: it.product.name,
          quantity: it.quantity,
          unit_price: it.product.price,
        })),
        total: checkoutTotal,
        customerEmail: data.email,
        reference: orderId,
        paymentMethod: data.payment,
        redirectUrl: `${window.location.origin}/payment-processing?order=${orderId}`,
        customerName: data.name,
        customerPhone: data.phone,
      });
      const paymentUrl = extractWompiPaymentUrl(res);
      const paymentLinkId = extractWompiPaymentLinkId(res);
      const transactionId = extractWompiTransactionId(res);
      const success = isWompiResponseSuccessful(res);
      console.log("[checkout] wompi response", { response: res, success, paymentUrl, paymentLinkId, transactionId });
      if (error) {
        console.error("[checkout] createWompiPayment failed", {
          endpoint: wompiEndpoint,
          status: error.code ?? null,
          message: error.message ?? String(error),
          responseBody: res,
        });
        throw error;
      }
      try {
        console.log("[client response]", JSON.stringify(res, null, 2));
      } catch (e) {}
      console.log("[paymentUrl]", paymentUrl);
      console.log("[paymentLinkId]", paymentLinkId);
      console.log("[transactionId]", transactionId);
      const txn = (res as any)?.transaction as Record<string, unknown> | undefined;
      const pendingWithoutPaymentUrl = Boolean((res as any)?.pendingWithoutPaymentUrl) || (!paymentUrl && txn && String(txn.status ?? "").toUpperCase() === "PENDING" && ["NEQUI", "DAVIPLATA", "PSE"].includes(String((txn.payment_method_type ?? txn.payment_method ?? txn.type ?? "")).toUpperCase()));
      console.log("[checkout] wompi paymentUrl summary", {
        paymentUrlPresent: Boolean(paymentUrl),
        pendingWithoutPaymentUrl,
        transactionId: txn?.id ?? null,
      });
      console.log("[checkout] payment flow finished");
      try {
        sessionStorage.setItem(
          `payment_${orderId}`,
          JSON.stringify({ paymentUrl: paymentUrl || null, paymentLinkId: paymentLinkId || null, transactionId: transactionId || null, paymentMethod: data.payment, pendingWithoutPaymentUrl }),
        );
      } catch {}
      clear();

      if (success && paymentUrl) {
        window.location.href = paymentUrl;
        return;
      }

      if (pendingWithoutPaymentUrl) {
        navigate(`/payment-processing?order=${orderId}`);
        return;
      }

      throw new Error("Wompi payment response invalid: missing paymentUrl or unsuccessful");
    } catch (err) {
      setLoading(false);
      const msg = getWompiErrorMessage(err);
      if (data.payment !== "card" && data.payment !== "pse" && ((err as any)?.status === 422 || (err as any)?.code === "payment_method_not_available")) {
        toast.error("Medio de pago no disponible", { description: String((err as any)?.message || msg) });
      } else {
        toast.error("No se pudo iniciar el pago", { description: String(msg) });
      }
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const formValid = checkoutSchema.safeParse(form).success;
    console.log({
      selectedPaymentMethod: form.payment,
      isLoading: loading,
      formValid,
      cartItems: detailedItems,
      total: checkoutTotal,
    });

    const data = validate();
    if (!data) return;
    await submitCheckout({ ...data, payment: form.payment });
  };

  const handleSubmitPayment = async (payment: PaymentMethod) => {
    const formValid = checkoutSchema.safeParse({ ...form, payment }).success;
    console.log({
      selectedPaymentMethod: payment,
      isLoading: loading,
      formValid,
      cartItems: detailedItems,
      total: checkoutTotal,
    });

    // Validate using the selected payment (override) so errors reflect chosen method
    setErrors({});
    const parsed = checkoutSchema.safeParse({ ...form, payment });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      parsed.error.issues.forEach((i) => { fe[i.path[0] as string] = i.message; });
      setErrors(fe);
      return;
    }
    await submitCheckout({ ...parsed.data, payment });
  };

  const handleManualConfirm = async () => {
    const data = validate();
    if (!data) return;
    if (loading) return;
    console.log("[checkout] payment flow start", { paymentMethod: data.payment, timestamp: Date.now() });
    setLoading(true);

    // Methods that require external redirect (handled by Wompi)
    const externalRedirectMethods = new Set<PaymentMethod>(["nequi", "daviplata", "pse"]);

    try {
      const finalTotal = checkoutTotal;

      // Create order as payment_pending first
      await saveOrder("payment_pending", data.payment, data);

      // If this is an external redirect method, create Wompi transaction and redirect
      if (externalRedirectMethods.has(data.payment as PaymentMethod)) {
const wompiEndpoint = "/api/payments/create-wompi-payment";
        console.log("[checkout] creating wompi payment", {
          endpoint: wompiEndpoint,
          paymentMethod: data.payment,
          total: finalTotal,
          customerEmail: data.email,
          reference: orderId,
          currency: "COP",
          redirectUrl: `${window.location.origin}/payment-processing?order=${orderId}`,
          customerName: data.name,
          customerPhone: data.phone,
        });
        const { data: res, error } = await createWompiPayment({
          products: detailedItems.map((it) => ({ id: it.product.id, name: it.product.name, quantity: it.quantity, unit_price: it.product.price })),
          total: finalTotal,
          customerEmail: data.email,
          reference: orderId,
          paymentMethod: data.payment,
          redirectUrl: `${window.location.origin}/payment-processing?order=${orderId}`,
          customerName: data.name,
          customerPhone: data.phone,
        });
        const paymentUrl = extractWompiPaymentUrl(res);
        const paymentLinkId = extractWompiPaymentLinkId(res);
        const transactionId = extractWompiTransactionId(res);
        const success = isWompiResponseSuccessful(res);
        console.log("[checkout] wompi response", { response: res, success, paymentUrl, paymentLinkId, transactionId });
        if (error) {
          console.error("[checkout] createWompiPayment failed", {
            endpoint: wompiEndpoint,
            status: error.code ?? null,
            message: error.message ?? String(error),
            responseBody: res,
          });
          throw error;
        }

        try {
          console.log("[client response]", JSON.stringify(res, null, 2));
        } catch (e) {}
        console.log("[paymentUrl]", paymentUrl);
        console.log("[paymentLinkId]", paymentLinkId);
        console.log("[transactionId]", transactionId);

        const txn = (res as any)?.transaction as Record<string, unknown> | undefined;
        const pendingWithoutPaymentUrl = Boolean((res as any)?.pendingWithoutPaymentUrl) || (!paymentUrl && txn && String(txn.status ?? "").toUpperCase() === "PENDING" && ["NEQUI", "DAVIPLATA", "PSE"].includes(String((txn.payment_method_type ?? txn.payment_method ?? txn.type ?? "")).toUpperCase()));
        console.log("[checkout] wompi response summary", { paymentUrl, status: txn?.status, pendingWithoutPaymentUrl });

        if (success && paymentUrl) {
          try { sessionStorage.setItem(`payment_${orderId}`, JSON.stringify({ paymentUrl, paymentLinkId: paymentLinkId || null, transactionId: transactionId || null, paymentMethod: data.payment, pendingWithoutPaymentUrl })); } catch {}
          clear();
          window.location.href = paymentUrl;
          return;
        }

        if (pendingWithoutPaymentUrl) {
          console.log("[checkout] payment flow finished");
          try { sessionStorage.setItem(`payment_${orderId}`, JSON.stringify({ paymentUrl, paymentLinkId: paymentLinkId || null, transactionId: transactionId || null, paymentMethod: data.payment, pendingWithoutPaymentUrl })); } catch {}
          clear();
          return navigate(`/payment-processing?order=${orderId}`);
        }

        if (externalRedirectMethods.has(data.payment as PaymentMethod)) {
          toast.error("No se generó enlace de pago Wompi");
          setLoading(false);
          return;
        }

        // Non-external fallback should continue to order success or WhatsApp fallback
        console.warn("[checkout] manual confirm wompi response invalid", { success, paymentUrl, pendingWithoutPaymentUrl, response: res });
        throw new Error("Wompi payment response invalid: missing paymentUrl or unsuccessful");

        // For non-external methods (e.g., transferencia) continue to WhatsApp fallback
        toast.success("¡Pago reportado!", { description: "Validaremos tu pago en minutos." });
        clear();
        return navigate(`/order-success?order=${orderId}&total=${finalTotal}&method=${encodeURIComponent(String(data.payment))}&status=payment_pending`);
      }

      // Non-redirect flow (transferencia) - keep WhatsApp fallback and then navigate
      const paymentLabel = PAYMENT_DETAILS[data.payment].label;
      const message = buildWhatsAppMessage(data, paymentLabel);
      await new Promise((r) => setTimeout(r, 500));
      await clear();
      toast.success("¡Pago reportado!", { description: "Validaremos tu transferencia en minutos." });
      window.open(`https://wa.me/573228426561?text=${message}`, "_blank");
      navigate(`/order-success?order=${orderId}&total=${finalTotal}&method=${encodeURIComponent(paymentLabel)}&status=payment_pending`);
    } catch (error) {
      console.error(error);
      toast.error("No se pudo registrar el pago", { description: "Intenta de nuevo en unos segundos." });
    } finally {
      setLoading(false);
    }
  };

  const handleWhatsAppFallback = () => {
    const data = validate();
    if (!data) return;
    const paymentLabel = data.payment === "transferencia" ? PAYMENT_DETAILS[data.payment].label : WOMPI_PAYMENT_LABELS[data.payment as Exclude<PaymentMethod, "transferencia">];
    void saveOrder("payment_pending", "whatsapp", data).catch((error) => console.error(error));
    window.open(`https://wa.me/573228426561?text=${buildWhatsAppMessage(data, paymentLabel)}`, "_blank");
  };

  if (step === "manual" && form.payment === "transferencia") {
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
              <div className="mt-6 bg-muted/30 border border-border rounded-2xl p-4 text-sm text-secondary/90">
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
                {addressesAvailable === null ? (
                  <div>Cargando direcciones...</div>
                ) : addressesAvailable === true ? (
                  <AddressList onSelect={handleSelectAddress} />
                ) : (
                  <>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <Input label="Nombre completo" value={form.name} onChange={update("name")} error={errors.name} autoComplete="name" />
                      <Input label="Correo electrónico" value={form.email} onChange={update("email")} error={errors.email} type="email" autoComplete="email" placeholder="cliente@correo.com" />
                      <Input label="Teléfono / WhatsApp" value={form.phone} onChange={update("phone")} error={errors.phone} type="tel" placeholder="3001234567" />
                      <Input label="Departamento" value={(form as any).department} onChange={update("department" as any)} error={errors.department} placeholder="Cundinamarca" />
                      <Input label="Ciudad" value={form.city} onChange={update("city")} error={errors.city} placeholder="Bogotá, Medellín..." />
                      <Input label="Dirección" value={form.address} onChange={update("address")} error={errors.address} placeholder="Calle 123 # 45-67" />
                    </div>
                    <div className="mt-4">
                      <label className="text-sm font-medium text-secondary block mb-1.5">Notas (opcional)</label>
                      <textarea value={form.notes} onChange={update("notes")} rows={3} className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-smooth resize-none" placeholder="Referencias del lugar..." />
                    </div>
                    <div className="mt-4 flex items-center gap-3">
                      <input id="saveAddress" type="checkbox" checked={saveAddressOnCheckout} onChange={(e) => setSaveAddressOnCheckout(e.target.checked)} className="h-4 w-4" />
                      <label htmlFor="saveAddress" className="text-sm">Guardar esta dirección para futuras compras</label>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] items-end">
                      <label className="text-sm font-medium text-secondary block">Código de cupón</label>
                      <div className="flex gap-2">
                        <input
                          value={couponCode}
                          onChange={(event) => setCouponCode(event.target.value)}
                          className="w-full rounded-2xl border border-border bg-background px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/40"
                          placeholder="EJEMPLO10"
                        />
                        <Button type="button" disabled={couponLoading} onClick={handleApplyCoupon} className="h-12 bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft">
                          {couponLoading ? "Validando..." : "Aplicar"}
                        </Button>
                      </div>
                      {couponMessage && <p className="sm:col-span-2 text-sm text-secondary/90">{couponMessage}</p>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      💡 Envío a Bogotá $15.000 · Otras ciudades $15.000 · Gratis desde $460.000
                    </p>
                  </>
                )}
              </Section>
              <Section icon={CreditCard} title="Método de pago">
                <p className="text-sm text-muted-foreground mb-4">
                  Wompi maneja los métodos de pago disponibles en su checkout. Selecciona el método que prefieras y sigue al enlace de pago.
                </p>
                <div className="grid gap-3">
                  {WOMPI_METHOD_OPTIONS.map((method) => (
                    <PaymentOption
                      key={method.value}
                      value={method.value}
                      selected={form.payment}
                      onSelect={(v) => setForm((f) => ({ ...f, payment: v }))}
                      icon={CreditCard}
                      title={method.title}
                      description={method.description}
                      logo={method.logo}
                      badge="Disponible"
                    />
                  ))}
                  <PaymentOption value="transferencia" selected={form.payment} onSelect={(v) => setForm((f) => ({ ...f, payment: v }))} icon={Building2} title="Transferencia bancaria" description="Bancolombia y otros bancos — confirmación manual" />
                </div>
                <p className="mt-4 rounded-2xl border border-border bg-background p-4 text-sm text-muted-foreground">{PAYMENT_METHOD_NOTES[form.payment]}</p>
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
                <div className="flex justify-between"><span>Descuento</span><span>{discountAmount > 0 ? `-${formatCOP(discountAmount)}` : "-"}</span></div>
                <div className="flex justify-between items-baseline pt-2 border-t border-border"><span className="font-semibold text-secondary">Total final</span><span className="font-display text-2xl text-primary">{formatCOP(checkoutTotal)}</span></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  type="button"
                  onClick={() => void handleSubmitPayment("nequi")}
                  disabled={loading}
                  size="lg"
                  className="w-full h-12 bg-secondary text-secondary-foreground hover:bg-secondary/90 shadow-soft"
                >
                  {loading && form.payment === "nequi" ? <><Loader2 className="h-5 w-5 animate-spin" /> Procesando...</> : <><Smartphone className="h-5 w-5" /> Pagar con Nequi</>}
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSubmitPayment("daviplata")}
                  disabled={loading}
                  size="lg"
                  className="w-full h-12 bg-secondary text-secondary-foreground hover:bg-secondary/90 shadow-soft"
                >
                  {loading && form.payment === "daviplata" ? <><Loader2 className="h-5 w-5 animate-spin" /> Procesando...</> : <><Smartphone className="h-5 w-5" /> Pagar con Daviplata</>}
                </Button>
              </div>
              <Button
                type="submit"
                disabled={loading}
                size="lg"
                className="w-full mt-4 h-12 bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft"
              >
                {loading ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> Procesando...</>
                ) : form.payment === "card" ? (
                  <><CreditCard className="h-5 w-5" /> Pagar con tarjeta</>
                ) : form.payment === "pse" ? (
                  <><CreditCard className="h-5 w-5" /> Pagar con PSE</>
                ) : form.payment === "nequi" ? (
                  <><Smartphone className="h-5 w-5" /> Pagar con Nequi</>
                ) : form.payment === "daviplata" ? (
                  <><Smartphone className="h-5 w-5" /> Pagar con Daviplata</>
                ) : (
                  <><CheckCircle2 className="h-5 w-5" /> Continuar al pago</>
                )}
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

function PaymentOption({ value, selected, onSelect, icon: Icon, title, description, badge, disabled, logo }: {
  value: PaymentMethod; selected: PaymentMethod; onSelect: (v: PaymentMethod) => void;
  icon: React.ComponentType<{ className?: string }>; title: string; description: string; badge?: string; disabled?: boolean; logo?: React.ReactNode;
}) {
  const active = selected === value;
  return (
    <label className={`relative ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} flex items-start gap-4 border rounded-xl p-4 transition-smooth ${active ? "border-primary/50 bg-card shadow-soft ring-1 ring-primary/10" : "border-border hover:border-primary/40 bg-background"}`}>
      <input type="radio" name="payment" value={value} checked={active} onChange={() => { if (!disabled) onSelect(value); }} className="sr-only" disabled={disabled} />
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-smooth ${active ? "bg-primary shadow-soft" : "bg-muted"}`}>
        {logo ?? <Icon className={`h-5 w-5 ${active ? "text-primary-foreground" : "text-muted-foreground"}`} />}
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
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${highlight ? "bg-primary/10 border-primary/20" : "bg-background border-border"}`}>
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
