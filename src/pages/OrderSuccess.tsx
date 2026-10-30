import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, MessageCircle, ShoppingBag, XCircle } from "lucide-react";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { Button } from "@/components/ui/button";
import { formatCOP } from "@/lib/format";
import { fetchData } from "@/integrations/api/client";
import { trackPurchase } from "@/lib/metaPixel";
import { SHELBY_WHATSAPP_URL } from "@/lib/contact";

type PaymentStatus = "payment_pending" | "payment_approved" | "payment_failed";

const normalizeStatus = (value: string | null) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "payment_approved" || normalized === "approved" || normalized === "paid" || normalized === "completed") return "payment_approved" as const;
  if (normalized === "payment_failed" || normalized === "failed" || normalized === "cancelled" || normalized === "canceled") return "payment_failed" as const;
  return "payment_pending" as const;
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  card: "Tarjeta",
  pse: "PSE",
  nequi: "Nequi",
  daviplata: "Daviplata",
  transferencia: "Transferencia",
  whatsapp: "WhatsApp",
};

const OrderSuccess = () => {
  const [params] = useSearchParams();
  const order = params.get("order") || undefined;
  const totalNum = Number(params.get("total"));
  const method = params.get("method") || undefined;
  const initialStatus = normalizeStatus(params.get("status"));
  const [status, setStatus] = useState<PaymentStatus>(initialStatus);
  const isFailed = status === "payment_failed";
  const isPending = status === "payment_pending";
  const friendlyMethod = method ? PAYMENT_METHOD_LABELS[method.toLowerCase()] ?? method : undefined;
  const pendingHint = method && ["nequi", "daviplata", "pse"].includes(method.toLowerCase())
    ? `Si usaste ${friendlyMethod}, Wompi puede devolver un estado pendiente sin enlace directo. Mantén esta página abierta y revisa la app o el teléfono registrado.`
    : "Si pagaste por transferencia o WhatsApp, tu pedido se confirmará cuando recibamos la validación.";

  useEffect(() => {
    if (!isFailed && !isPending) {
      trackPurchase({
        content_ids: order ? [order] : undefined,
        currency: "COP",
        value: Number.isNaN(totalNum) ? undefined : totalNum,
        status,
      });
    }
  }, [isFailed, isPending, order, status, totalNum]);

  useEffect(() => {
    if (!order) return;

    let cancelled = false;
    const refreshStatus = async () => {
      const { data, error } = await fetchData<{ status?: string | null; paymentMethod?: string | null; total?: number }>("orders", {
        filters: JSON.stringify([{ column: "id", value: order }]),
        maybeSingle: true,
      });

      if (error) {
        console.error(error);
        return;
      }

      const nextStatus = normalizeStatus((data as { status?: string | null } | null)?.status ?? null);
      if (!cancelled) {
        setStatus(nextStatus);
      }

      if (nextStatus !== "payment_pending") {
        window.clearInterval(intervalId);
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshStatus();
    }, 4000);
    void refreshStatus();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [order]);

  return (
    <div className="min-h-screen bg-[#f5f8f8]">
      <Navbar />
      <main className="px-4 pb-20 pt-32">
        <div className="container-shelby max-w-2xl">
          <div className="relative overflow-hidden rounded-[2rem] border border-border bg-white p-8 text-center shadow-elegant sm:p-12">
            <div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-[1.6rem] shadow-soft ${isFailed ? "bg-destructive" : "bg-primary"}`}>
              {isFailed ? <XCircle className="h-9 w-9 text-destructive-foreground" /> : <CheckCircle2 className="h-9 w-9 text-primary-foreground" />}
            </div>
            <h1 className="mt-6 font-display text-4xl text-primary sm:text-5xl">
              {isFailed ? "Pago no completado" : isPending ? "¡Pedido recibido!" : "¡Pago exitoso!"}
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              {isFailed
                ? "Tu pago no se procesó. Puedes intentarlo de nuevo o coordinar por WhatsApp."
                : isPending
                ? "Estamos validando tu pago. Te confirmamos por WhatsApp en cuanto se acredite y te enviaremos la factura al correo registrado."
                : "Tu pago fue procesado correctamente. Te enviaremos la factura al correo registrado y los detalles del envío por WhatsApp."}
            </p>
            {isPending && (
              <p className="mt-4 rounded-2xl bg-[#f5f8f8] p-4 text-left text-sm text-primary/80">{pendingHint}</p>
            )}
            <div className="mt-7 space-y-3 rounded-[1.4rem] border border-border bg-[#f5f8f8] p-5 text-left text-sm text-primary/90">
              {order && <div className="flex justify-between gap-4"><span className="text-muted-foreground">N.º de pedido</span><span className="font-mono text-primary">{order}</span></div>}
              {method && <div className="flex justify-between gap-4"><span className="text-muted-foreground">Método</span><span className="text-primary">{friendlyMethod ?? method}</span></div>}
              {!Number.isNaN(totalNum) && totalNum > 0 && (
                <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3"><span className="text-muted-foreground">Total</span><span className="font-display text-3xl text-primary">{formatCOP(totalNum)}</span></div>
              )}
            </div>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <Button asChild className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft">
                <Link to={isFailed ? "/checkout" : "/products"}><ShoppingBag className="h-4 w-4" /> {isFailed ? "Intentar de nuevo" : "Seguir comprando"}</Link>
              </Button>
              {isPending && order && (
                <Button asChild variant="outline" className="flex-1 border-border text-primary hover:bg-primary/5">
                  <Link to={`/payment-processing?order=${order}`}>Verificar estado</Link>
                </Button>
              )}
              <Button asChild variant="outline" className="flex-1 border-whatsapp text-whatsapp hover:bg-whatsapp hover:text-white sm:col-span-2">
                <a href={`${SHELBY_WHATSAPP_URL}?text=Hola%20Shelby%2C%20acabo%20de%20realizar%20un%20pedido`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-4 w-4" /> Contactar soporte
                </a>
              </Button>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};
export default OrderSuccess;
