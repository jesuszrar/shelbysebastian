import { Link } from "react-router-dom";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { WhatsAppButton } from "@/components/shelby/WhatsAppButton";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { formatCOP } from "@/data/products";
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight } from "lucide-react";

const Cart = () => {
  const { detailedItems, subtotal, shipping, total, setQuantity, remove, count } = useCart();
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 pt-32 pb-16">
        <div className="container-shelby">
          <div className="mb-8">
            <span className="text-primary text-xs uppercase tracking-[0.3em] font-semibold">Tu pedido</span>
            <h1 className="font-display text-4xl sm:text-5xl text-secondary mt-2">Carrito {count > 0 && <span className="text-primary">({count})</span>}</h1>
          </div>
          {detailedItems.length === 0 ? (
            <div className="bg-card border border-border rounded-3xl p-12 text-center shadow-soft">
              <div className="inline-flex h-16 w-16 rounded-2xl bg-muted items-center justify-center mb-4"><ShoppingBag className="h-7 w-7 text-muted-foreground" /></div>
              <h2 className="font-display text-2xl text-secondary">Tu carrito está vacío</h2>
              <Button asChild className="mt-6 bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft"><Link to="/products">Ver catálogo</Link></Button>
            </div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-4">
                {detailedItems.map((it) => (
                  <article key={it.productId} className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-soft flex gap-4 items-center">
                    <Link to={`/products/${it.product.id}`} className="flex-shrink-0">
                      <img src={it.product.image} alt={it.product.name} className="h-20 w-20 sm:h-24 sm:w-24 rounded-xl object-cover bg-muted" />
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link to={`/products/${it.product.id}`}>
                        <h3 className="font-display text-base sm:text-lg text-secondary tracking-wide line-clamp-2 hover:text-primary">{it.product.name}</h3>
                      </Link>
                      <span className="text-xs text-muted-foreground">{it.product.category}</span>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Stock disponible: <span className="font-semibold text-secondary">{Math.max(0, Number(it.product.stock ?? 0))}</span>
                      </div>
                      <div className="font-display text-xl text-primary mt-1">{formatCOP(it.product.price)}</div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center border border-border rounded-lg">
                        <button onClick={() => setQuantity(it.productId, it.quantity - 1)} className="h-8 w-8 flex items-center justify-center hover:bg-muted"><Minus className="h-3.5 w-3.5" /></button>
                        <span className="w-8 text-center text-sm font-semibold">{it.quantity}</span>
                        <button
                          onClick={() => setQuantity(it.productId, it.quantity + 1)}
                          className="h-8 w-8 flex items-center justify-center hover:bg-muted disabled:opacity-40"
                          disabled={it.quantity >= Math.max(0, Number(it.product.stock ?? 0))}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button onClick={() => remove(it.productId)} className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"><Trash2 className="h-3 w-3" /> Quitar</button>
                    </div>
                  </article>
                ))}
              </div>
              <aside className="lg:sticky lg:top-32 h-fit bg-card border border-border rounded-2xl p-6 shadow-elegant">
                <h2 className="font-display text-2xl text-secondary">Resumen</h2>
                <div className="mt-5 space-y-3 text-sm">
                  <div className="flex justify-between text-secondary/80"><span>Subtotal</span><span className="text-secondary">{formatCOP(subtotal)}</span></div>
                  <div className="flex justify-between text-secondary/80"><span>Envío</span><span className="text-secondary">{shipping === 0 ? <span className="text-brand-green font-semibold">Gratis</span> : formatCOP(shipping)}</span></div>
                  {shipping > 0 && <p className="text-xs text-muted-foreground">Te faltan <span className="font-semibold text-secondary">{formatCOP(460000 - subtotal)}</span> para envío gratis.</p>}
                  <div className="border-t border-border pt-3 flex justify-between items-baseline"><span className="font-semibold text-secondary">Total</span><span className="font-display text-2xl text-primary">{formatCOP(total)}</span></div>
                </div>
                <Button asChild size="lg" className="w-full mt-6 h-12 bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft"><Link to="/checkout">Continuar al pago <ArrowRight className="h-4 w-4" /></Link></Button>
                <Button asChild variant="ghost" className="w-full mt-2"><Link to="/products">Seguir comprando</Link></Button>
              </aside>
            </div>
          )}
        </div>
      </main>
      <Footer />
      <WhatsAppButton />
    </div>
  );
};
export default Cart;
