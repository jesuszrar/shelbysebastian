import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, MessageCircle, ShoppingBag, XCircle } from "lucide-react";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { Button } from "@/components/ui/button";
import { formatCOP } from "@/data/products";

const OrderSuccess = () => {
  const [params] = useSearchParams();
  const order = params.get("order") || undefined;
  const totalNum = Number(params.get("total"));
  const method = params.get("method") || undefined;
  const status = (params.get("status") as "paid" | "pending" | "failed" | null) || "paid";
  const isFailed = status === "failed";
  const isPending = status === "pending";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 pt-32 pb-16 px-4">
        <div className="container-shelby max-w-xl">
          <div className="bg-card border border-border rounded-3xl p-10 text-center shadow-elegant">
            <div className={`mx-auto h-16 w-16 rounded-full flex items-center justify-center shadow-soft ${isFailed ? "bg-destructive" : "bg-primary"}`}>
              {isFailed ? <XCircle className="h-9 w-9 text-destructive-foreground" /> : <CheckCircle2 className="h-9 w-9 text-primary-foreground" />}
            </div>
            <h1 className="font-display text-3xl sm:text-4xl text-secondary mt-5">
              {isFailed ? "Pago no completado" : isPending ? "¡Pedido recibido!" : "¡Pago exitoso!"}
            </h1>
            <p className="text-muted-foreground mt-3">
              {isFailed
                ? "Tu pago no se procesó. Puedes intentarlo de nuevo o coordinar por WhatsApp."
                : isPending
                ? "Estamos validando tu pago. Te confirmamos por WhatsApp en cuanto se acredite."
                : "Tu pago fue procesado correctamente. Te enviaremos los detalles del envío por WhatsApp."}
            </p>
            <div className="mt-6 bg-accent/40 border border-border rounded-2xl p-5 text-left text-sm space-y-2">
              {order && <div className="flex justify-between"><span className="text-muted-foreground">N.º de pedido</span><span className="font-mono text-secondary">{order}</span></div>}
              {method && <div className="flex justify-between"><span className="text-muted-foreground">Método</span><span className="text-secondary">{method}</span></div>}
              {!Number.isNaN(totalNum) && totalNum > 0 && (
                <div className="flex justify-between items-baseline pt-2 border-t border-border"><span className="text-muted-foreground">Total</span><span className="font-display text-xl text-primary">{formatCOP(totalNum)}</span></div>
              )}
            </div>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Button asChild className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft">
                <Link to={isFailed ? "/checkout" : "/products"}><ShoppingBag className="h-4 w-4" /> {isFailed ? "Intentar de nuevo" : "Seguir comprando"}</Link>
              </Button>
              <Button asChild variant="outline" className="flex-1 border-whatsapp text-whatsapp hover:bg-whatsapp hover:text-white">
                <a href="https://wa.me/573228426561?text=Hola%20Shelby%2C%20acabo%20de%20realizar%20un%20pedido" target="_blank" rel="noopener noreferrer">
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
