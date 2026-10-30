import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { Button } from "@/components/ui/button";
import { CreditCard, MessageCircle } from "lucide-react";
import { resolveApiBaseUrl } from "@/integrations/api/client";
import { SHELBY_WHATSAPP_URL } from "@/lib/contact";

const PAYMENT_METHOD_HINTS: Record<string, string> = {
  nequi: "Nequi puede no devolver un enlace directo. Revisa el push en tu app o el teléfono registrado.",
  daviplata: "Daviplata pedirá autorización desde la app. Revisa tu teléfono y espera la confirmación.",
  pse: "PSE abre un portal bancario. Mantén esta pantalla abierta mientras se procesa.",
  card: "La pasarela de pago de tarjeta aparecerá en la siguiente pantalla.",
};
type PaymentTransaction = Record<string, unknown>;
type PaymentStatusResponse = {
  transaction?: PaymentTransaction | null;
  paymentMethod?: string | null;
  status?: string | null;
  mappedStatus?: string | null;
  pendingWithoutPaymentUrl?: boolean;
  transactionNotFound?: boolean;
};

const PaymentProcessing = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const orderId = searchParams.get("order") || "";
  const [status, setStatus] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<PaymentTransaction | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [pendingWithoutPaymentUrl, setPendingWithoutPaymentUrl] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isNequi, setIsNequi] = useState(false);

  useEffect(() => {
    const loadStoredPayment = () => {
      const stored = sessionStorage.getItem(`payment_${orderId}`);
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored);
        setPaymentUrl(parsed.paymentUrl || null);
        setTransaction(parsed.transaction || null);
        setTransactionId(parsed.transactionId || null);
        const method = parsed.paymentMethod || null;
        setPaymentMethod(method);
        setIsNequi(String(method).toLowerCase() === "nequi");
        setPendingWithoutPaymentUrl(Boolean(parsed.pendingWithoutPaymentUrl));
      } catch (error) {
        console.warn("[payment-processing] stored payment data is invalid", error);
      }
    };

    loadStoredPayment();
  }, [orderId]);

  useEffect(() => {
    let mounted = true;

    const fetchStatus = async () => {
      try {
        const params = new URLSearchParams();
        if (transactionId) {
          params.set("transactionId", transactionId);
        }
        if (orderId) {
          params.set("orderId", orderId);
          params.set("reference", orderId);
        }

        if (!params.toString()) return;

        const baseUrl = resolveApiBaseUrl();
        const url = `${baseUrl}/api/payments/transaction-status?${params.toString()}`;
        const res = await fetch(url);
        const data = await res.json() as PaymentStatusResponse;

        if (!mounted) return;
        if (data?.transaction) setTransaction(data.transaction);
        if (data?.transaction?.id) setTransactionId(String(data.transaction.id));
        if (data?.paymentMethod) setPaymentMethod(String(data.paymentMethod));
        if (data?.status) setStatus(data.status);
        if (data?.pendingWithoutPaymentUrl !== undefined) setPendingWithoutPaymentUrl(Boolean(data.pendingWithoutPaymentUrl));

        const fetchedMethod = String(data?.transaction?.payment_method_type ?? data?.transaction?.payment_method ?? data?.transaction?.type ?? data?.paymentMethod ?? "").toLowerCase();
        if (!paymentMethod && fetchedMethod) setPaymentMethod(fetchedMethod);
        if (!isNequi && fetchedMethod === "nequi") setIsNequi(true);

        console.log("[payment-processing] status check", {
          orderId,
          transactionId,
          status: data?.status ?? (data?.transaction?.status ?? null),
          mappedStatus: data?.mappedStatus,
          fetchedMethod,
          pendingWithoutPaymentUrl: data?.pendingWithoutPaymentUrl,
          isNequi: fetchedMethod === "nequi",
        });

        if (String(data.status).toUpperCase() === "APPROVED" || String(data.mappedStatus).toLowerCase() === "payment_approved") {
          navigate(`/order-success?order=${orderId}&status=payment_approved`);
        } else if (data?.transactionNotFound) {
          setStatus("PENDING");
          setTransaction(null);
          setTransactionId(null);
        }
      } catch (error) {
        console.warn("[payment-processing] failed to fetch transaction status", error);
      }
    };

    fetchStatus();
    const intervalId = window.setInterval(fetchStatus, 5000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [orderId, transactionId, navigate, paymentMethod, isNequi]);

  return (
    <div className="min-h-screen bg-[#f5f8f8]">
      <Navbar />
      <main className="flex items-center justify-center px-4 pb-20 pt-32">
        <div className="w-full max-w-xl rounded-[2rem] border border-border bg-white p-8 text-center shadow-elegant sm:p-12">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[1.6rem] bg-primary shadow-soft"><CreditCard className="h-9 w-9 text-white" /></div>
          <span className="mt-6 block text-xs font-semibold uppercase tracking-[0.3em] text-primary">Pago seguro Shelby</span>
          <h1 className="mt-3 font-display text-4xl text-primary sm:text-5xl">Estamos preparando tu pago</h1>
          <p className="mt-3 text-muted-foreground">Pedido <span className="font-mono text-primary">{orderId}</span></p>
          {paymentMethod && (
            <p className="mt-2 text-sm text-muted-foreground">Método: <strong className="capitalize text-primary">{paymentMethod}</strong></p>
          )}
          <div className="mt-6">
            <div className="mb-4 flex justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
          </div>
          <p className="text-sm text-muted-foreground">
            Estado: <strong className="text-primary">{status || "PENDING"}</strong>
          </p>
          {isNequi && (
            <p className="mt-3 text-sm text-muted-foreground">
              Revisa tu app Nequi para aprobar el pago. No necesitas un enlace externo.
            </p>
          )}
          {!isNequi && !paymentUrl && status && status.toUpperCase() === "PENDING" && (
            <p className="mt-3 text-sm text-muted-foreground">
              {pendingWithoutPaymentUrl
                ? "Wompi registró tu pago como pendiente sin enlace directo. Mantén esta página abierta y revisa la app o el teléfono registrado."
                : paymentMethod && ["nequi", "daviplata", "pse"].includes(paymentMethod.toLowerCase())
                ? (PAYMENT_METHOD_HINTS[paymentMethod] || "Mantén esta página abierta mientras verificamos el estado del pago.")
                : "Esperando la confirmación del pago. Mantén esta página abierta mientras verificamos el estado."}
            </p>
          )}
          {transaction?.id && (
            <div className="mt-4 text-left text-sm text-muted-foreground space-y-2">
              <div className="rounded-2xl bg-[#f5f8f8] p-4 text-left">
                <span className="font-medium text-primary">Transacción:</span> <span className="font-mono">{String(transaction.id)}</span>
              </div>
              <div>
                <span className="font-medium text-primary">Referencia pedido:</span> <span className="font-mono">{orderId}</span>
              </div>
            </div>
          )}
          {!paymentUrl && status && status.toUpperCase() !== "APPROVED" && (
            <p className="mt-3 text-sm text-muted-foreground">
              Si el pago ya se completó, vuelve a verificar en unos segundos o contacta soporte por WhatsApp.
            </p>
          )}
          </div>
          <div className="mt-6 grid gap-3">
            {paymentUrl ? (
              <Button size="lg" className="w-full" onClick={() => { window.location.href = paymentUrl; }}>
                Continuar pago
              </Button>
            ) : (
              <Button
                size="lg"
                className="w-full"
                onClick={async () => {
                  setLoading(true);
                  await new Promise((resolve) => setTimeout(resolve, 600));
                  setLoading(false);
                }}
              >
                Verificar estado
              </Button>
            )}
          <Button variant="outline" className="w-full border-border text-primary hover:bg-primary/5" onClick={() => navigate("/checkout")}>Volver al checkout</Button>
            {!paymentUrl && (
              <Button
                variant="outline"
                className="w-full border-whatsapp text-whatsapp hover:bg-whatsapp hover:text-white"
                onClick={() => window.open(`${SHELBY_WHATSAPP_URL}?text=Hola%20Shelby%2C%20necesito%20ayuda%20con%20mi%20pago`, "_blank")}
              >
                <MessageCircle className="h-4 w-4" /> Contactar soporte por WhatsApp
              </Button>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default PaymentProcessing;
