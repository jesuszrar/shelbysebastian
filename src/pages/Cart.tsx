import { Link } from "react-router-dom";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { WhatsAppButton } from "@/components/shelby/WhatsAppButton";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { formatCOP } from "@/data/products";
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight, ShieldCheck } from "lucide-react";

const Cart = () => {
  const { detailedItems, subtotal, shipping, total, setQuantity, remove, count } = useCart();

  return (
    <div className="min-h-screen bg-[#f5f8f8]">
      <Navbar />
      <main className="flex-1 pb-16 pt-32">
        <div className="container-shelby">
          <div className="mb-8">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Tu pedido</span>
            <h1 className="mt-2 font-display text-4xl text-primary sm:text-5xl">Carrito {count > 0 && <span className="text-primary/80">({count})</span>}</h1>
          </div>

          {detailedItems.length === 0 ? (
            <div className="mx-auto max-w-xl rounded-[2rem] border border-border bg-white p-12 text-center shadow-soft">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#edf3f3]">
                <ShoppingBag className="h-7 w-7 text-primary" />
              </div>
              <h2 className="font-display text-3xl text-primary">Tu carrito está vacío</h2>
              <p className="mt-3 text-sm text-muted-foreground">Aún no agregas productos a tu compra.</p>
              <Button asChild className="mt-7 bg-primary text-primary-foreground shadow-soft hover:bg-primary/90">
                <Link to="/products">Ver catálogo</Link>
              </Button>
            </div>
          ) : (
            <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-4">
                {detailedItems.map((it) => (
                  <article key={`${it.productId}:${it.variantId || "base"}`} className="flex items-center gap-4 rounded-[1.8rem] border border-border bg-white p-4 shadow-soft sm:p-5">
                    <Link to={`/products/${it.product.id}`} className="shrink-0">
                      <img src={it.product.image} alt={it.product.name} className="h-24 w-24 rounded-2xl object-cover bg-muted sm:h-28 sm:w-28" />
                    </Link>

                    <div className="min-w-0 flex-1">
                      <Link to={`/products/${it.product.id}`}>
                        <h3 className="font-display text-xl text-primary hover:text-primary/80">{it.product.name}</h3>
                      </Link>
                      {it.variant && <p className="mt-1 text-sm font-medium text-secondary">{it.variant.name}</p>}
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">{it.product.category}</p>
                      <div className="mt-2 text-sm text-muted-foreground">
                        Stock disponible: <span className="font-semibold text-primary">{Math.max(0, Number(it.product.stock ?? 0))}</span>
                      </div>
                      <div className="mt-3 font-display text-2xl text-primary">{formatCOP(Number(it.variant?.price ?? it.product.price))}</div>
                    </div>

                    <div className="flex flex-col items-end gap-3">
                      <div className="flex items-center overflow-hidden rounded-2xl border border-border bg-[#f5f8f8]">
                        <button type="button" onClick={() => setQuantity(it.productId, it.quantity - 1, it.variantId)} className="flex h-10 w-10 items-center justify-center transition-smooth hover:bg-white">
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-10 text-center text-sm font-semibold text-primary">{it.quantity}</span>
                        <button type="button" onClick={() => setQuantity(it.productId, it.quantity + 1, it.variantId)} className="flex h-10 w-10 items-center justify-center transition-smooth hover:bg-white" disabled={it.quantity >= Math.max(0, Number(it.variant?.stock ?? it.product.stock ?? 0))}>
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <button type="button" onClick={() => remove(it.productId, it.variantId)} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-smooth hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" /> Quitar
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              <aside className="h-fit rounded-[2rem] border border-border bg-white p-6 shadow-elegant lg:sticky lg:top-32">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-primary">Resumen</p>
                    <h2 className="mt-1 font-display text-3xl text-primary">Tu compra</h2>
                  </div>
                </div>

                <div className="mt-6 space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Subtotal</span>
                    <span className="font-medium text-primary">{formatCOP(subtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Envío</span>
                    <span className="font-medium text-primary">{shipping === 0 ? <span className="text-emerald-600">Gratis</span> : formatCOP(shipping)}</span>
                  </div>
                  {shipping > 0 && (
                    <p className="rounded-2xl bg-[#f5f8f8] p-3 text-xs text-muted-foreground">
                      Te faltan <span className="font-semibold text-primary">{formatCOP(Math.max(0, 460000 - subtotal))}</span> para envío gratis.
                    </p>
                  )}
                  <div className="flex items-baseline justify-between border-t border-border pt-4">
                    <span className="text-base font-semibold text-primary">Total</span>
                    <span className="font-display text-4xl leading-none text-primary">{formatCOP(total)}</span>
                  </div>
                </div>

                <Button asChild size="lg" className="mt-6 h-12 w-full bg-primary text-primary-foreground shadow-soft hover:bg-primary/90">
                  <Link to="/checkout" className="inline-flex items-center gap-2">
                    Continuar al pago <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>

                <Button asChild variant="ghost" className="mt-2 w-full text-primary">
                  <Link to="/products">Seguir comprando</Link>
                </Button>
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
