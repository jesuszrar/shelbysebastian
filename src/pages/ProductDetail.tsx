import { useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { WhatsAppButton } from "@/components/shelby/WhatsAppButton";
import { Button } from "@/components/ui/button";
import { getProductById, formatCOP, products } from "@/data/products";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";
import { ShoppingCart, Check, Star, Minus, Plus, ArrowLeft, MessageCircle } from "lucide-react";
import { useProductsCatalog } from "@/context/ProductsContext";

const ProductDetail = () => {
  const { productId } = useParams();
  const { products: liveProducts } = useProductsCatalog();
  const product = liveProducts.find((item) => item.id === (productId || ""));
  const { add } = useCart();
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);

  if (!product) return <Navigate to="/products" replace />;
  const related = liveProducts.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 3);

  const handleAdd = async () => {
    setAdding(true);
    add(product.id, qty);
    await new Promise((r) => setTimeout(r, 300));
    toast.success("Añadido al carrito", { description: `${qty} × ${product.name}` });
    setAdding(false);
  };

  const waMsg = encodeURIComponent(`Hola Shelby, me interesa la ${product.name} (${formatCOP(product.price)}). ¿Tienen disponible?`);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-32 pb-20">
        <div className="container-shelby">
          <Link to="/products" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-smooth mb-6">
            <ArrowLeft className="h-4 w-4" /> Volver al catálogo
          </Link>
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16">
            <div className="relative bg-muted rounded-3xl overflow-hidden aspect-square shadow-elegant">
              {product.badge && <span className="absolute top-4 left-4 z-10 bg-brand-red text-white text-sm font-bold px-3 py-1.5 rounded-md shadow-soft">{product.badge}</span>}
              <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
            </div>
            <div className="flex flex-col">
              <span className="text-primary text-xs uppercase tracking-[0.3em] font-semibold">{product.category}</span>
              <h1 className="font-display text-4xl sm:text-5xl text-secondary mt-2 leading-tight">{product.name}</h1>
              <div className="flex items-center gap-1 mt-3 text-primary">
                {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="h-4 w-4 fill-current" />)}
                <span className="text-sm text-muted-foreground ml-2">(4.9 · 120 reseñas)</span>
              </div>
              <div className="mt-5 flex items-baseline gap-3">
                <span className="font-display text-4xl text-secondary">{formatCOP(product.price)}</span>
                {product.oldPrice && <span className="text-lg text-muted-foreground line-through">{formatCOP(product.oldPrice)}</span>}
              </div>
              <p className="mt-5 text-muted-foreground leading-relaxed">{product.description}</p>
              <ul className="mt-6 space-y-2">
                {product.specs.map((s) => (
                  <li key={s} className="flex items-start gap-2 text-secondary/90 text-sm">
                    <Check className="h-4 w-4 text-brand-green flex-shrink-0 mt-0.5" />{s}
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex items-center gap-3">
                <span className="text-sm font-medium text-secondary">Cantidad:</span>
                <div className="flex items-center border border-border rounded-xl">
                  <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-10 w-10 flex items-center justify-center hover:bg-muted"><Minus className="h-4 w-4" /></button>
                  <span className="w-12 text-center font-semibold">{qty}</span>
                  <button onClick={() => setQty((q) => q + 1)} className="h-10 w-10 flex items-center justify-center hover:bg-muted"><Plus className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button onClick={handleAdd} disabled={adding} size="lg" className="flex-1 min-w-[200px] bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft h-14">
                  {adding ? "Añadiendo..." : <><ShoppingCart className="h-5 w-5" /> Añadir al carrito</>}
                </Button>
                <Button asChild size="lg" variant="outline" className="border-whatsapp text-whatsapp hover:bg-whatsapp hover:text-white h-14">
                  <a href={`https://wa.me/573228426561?text=${waMsg}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-5 w-5" /> Pedir por WhatsApp</a>
                </Button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">✓ Envío gratis desde $260.000 · ✓ Garantía 30 días · ✓ Despacho en 24h</p>
            </div>
          </div>
          {related.length > 0 && (
            <section className="mt-20">
              <h2 className="font-display text-3xl text-secondary mb-6">También te puede interesar</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {related.map((r) => (
                  <Link key={r.id} to={`/products/${r.id}`} className="group bg-card border border-border rounded-2xl overflow-hidden shadow-soft hover:shadow-elegant transition-smooth hover:-translate-y-1">
                    <div className="aspect-square bg-muted overflow-hidden"><img src={r.image} alt={r.name} className="w-full h-full object-cover group-hover:scale-105 transition-smooth duration-500" /></div>
                    <div className="p-4"><h3 className="font-display text-lg text-secondary tracking-wide">{r.name}</h3><span className="font-display text-xl text-primary mt-2 block">{formatCOP(r.price)}</span></div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
      <Footer />
      <WhatsAppButton />
    </div>
  );
};
export default ProductDetail;
