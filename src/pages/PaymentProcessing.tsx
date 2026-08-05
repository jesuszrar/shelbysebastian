import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { resolveApiBaseUrl } from "@/integrations/api/client";

const PAYMENT_METHOD_HINTS: Record<string, string> = {
  nequi: "Nequi puede no devolver un enlace directo. Revisa el push en tu app o el teléfono registrado.",
  daviplata: "Daviplata pedirá autorización desde la app. Revisa tu teléfono y espera la confirmación.",
  pse: "PSE abre un portal bancario. Mantén esta pantalla abierta mientras se procesa.",
  card: "La pasarela de pago de tarjeta aparecerá en la siguiente pantalla.",
};

const PaymentProcessing = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const orderId = searchParams.get("order") || "";
  const [status, setStatus] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<any>(null);
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
      } catch {
        /* ignore malformed data */
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
        } else if (orderId) {
          params.set("orderId", orderId);
        }

        if (!params.toString()) return;

        const baseUrl = resolveApiBaseUrl();
        const url = `${baseUrl}/api/payments/transaction-status?${params.toString()}`;
        const res = await fetch(url);
        const data = await res.json();

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
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 flex items-center justify-center pt-32 pb-16 px-4">
        <div className="bg-card border border-border rounded-3xl p-12 text-center shadow-soft max-w-md">
          <img src="/assets/logo.png" alt="Shelby" className="mx-auto mb-4 h-16" />
          <h1 className="font-display text-2xl text-secondary">Estamos preparando tu pago</h1>
          <p className="text-muted-foreground mt-2">Pedido <span className="font-mono">{orderId}</span></p>
          {paymentMethod && (
            <p className="text-sm text-muted-foreground mt-2">Método: <strong className="text-secondary capitalize">{paymentMethod}</strong></p>
          )}
          <div className="mt-6">
            <div className="flex justify-center mb-4">
            <div className="h-12 w-12 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
          </div>
          <p className="text-sm text-muted-foreground">
            Estado: <strong className="text-secondary">{status || "PENDING"}</strong>
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
              <div>
                <span className="font-medium text-secondary">Transacción:</span> <span className="font-mono">{String(transaction.id)}</span>
              </div>
              <div>
                <span className="font-medium text-secondary">Referencia pedido:</span> <span className="font-mono">{orderId}</span>
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
            <Button variant="outline" className="w-full" onClick={() => navigate("/checkout")}>Volver al checkout</Button>
            {!paymentUrl && (
              <Button
                variant="outline"
                className="w-full border-whatsapp text-whatsapp hover:bg-whatsapp hover:text-white"
                onClick={() => window.open("https://wa.me/573228426561?text=Hola%20Shelby%2C%20necesito%20ayuda%20con%20mi%20pago", "_blank")}
              >
                Contactar soporte por WhatsApp
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
