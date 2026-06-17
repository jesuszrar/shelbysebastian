import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { products, formatCOP, type Product } from "@/data/products";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";
import { ShoppingCart, Star, Eye } from "lucide-react";

const categories = ["Todos", "Adhesivas", "Facturación", "Más vendidos", "Repuestos"] as const;

export const ProductCard = ({ p }: { p: Product }) => {
  const { add } = useCart();
  const handleAdd = () => { add(p.id, 1); toast.success("Añadido al carrito", { description: p.name }); };
  return (
    <article className="group relative bg-card border border-border rounded-2xl overflow-hidden shadow-soft hover:shadow-elegant transition-smooth hover:-translate-y-1 flex flex-col">
      {p.badge && <span className="absolute top-3 left-3 z-10 bg-brand-red text-white text-xs font-bold px-2.5 py-1 rounded-md shadow-soft">{p.badge}</span>}
      <Link to={`/products/${p.id}`} className="block aspect-square bg-muted overflow-hidden">
        <img src={p.image} alt={p.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-smooth duration-500" />
      </Link>
      <div className="p-5 flex flex-col flex-1">
        <span className="text-[10px] uppercase tracking-[0.2em] text-primary font-semibold">{p.category}</span>
        <Link to={`/products/${p.id}`}>
          <h3 className="font-display text-lg text-secondary mt-1 tracking-wide line-clamp-2 hover:text-primary transition-smooth">{p.name}</h3>
        </Link>
        <div className="flex items-center gap-1 mt-2 text-primary">
          {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="h-3.5 w-3.5 fill-current" />)}
          <span className="text-xs text-muted-foreground ml-1">(4.9)</span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="font-display text-2xl text-secondary">{formatCOP(p.price)}</span>
          {p.oldPrice && <span className="text-sm text-muted-foreground line-through">{formatCOP(p.oldPrice)}</span>}
        </div>
        <div className="mt-auto pt-4 flex gap-2">
          <Button onClick={handleAdd} className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft"><ShoppingCart className="h-4 w-4" /> Añadir</Button>
          <Button asChild variant="outline" size="icon" className="border-border"><Link to={`/products/${p.id}`} aria-label="Ver detalle"><Eye className="h-4 w-4" /></Link></Button>
        </div>
      </div>
    </article>
  );
};

export const Products = () => {
  const [active, setActive] = useState<(typeof categories)[number]>("Todos");
  const list = useMemo(() => active === "Todos" ? products : products.filter((p) => p.category === active), [active]);
  return (
    <section id="productos" className="py-24 bg-background">
      <div className="container-shelby">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-10">
          <div>
            <span className="text-secondary text-xs uppercase tracking-[0.3em] font-semibold">Catálogo</span>
            <h2 className="font-display text-4xl sm:text-5xl text-primary mt-3">Lo que tu negocio necesita</h2>
            <p className="text-primary/80 mt-3 max-w-xl">Equipos seleccionados uno por uno. Si no lo usaríamos nosotros, no lo vendemos.</p>
          </div>
          <Button asChild variant="outline" className="self-start sm:self-end border-primary text-primary hover:bg-primary hover:text-primary-foreground"><Link to="/products">Ver todo el catálogo →</Link></Button>
        </div>
        <div className="flex flex-wrap gap-2 mb-8">
          {categories.map((c) => (
            <button key={c} onClick={() => setActive(c)} className={`px-4 py-2 rounded-full text-sm font-medium transition-smooth ${active === c ? "bg-primary text-white shadow-soft" : "bg-white text-primary hover:bg-primary hover:text-white border border-border"}`}>{c}</button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">{list.map((p) => <ProductCard key={p.id} p={p} />)}</div>
      </div>
    </section>
  );
};
