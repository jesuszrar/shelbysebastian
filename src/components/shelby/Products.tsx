import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { formatCOP, type Product } from "@/data/products";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";
import { ShoppingCart, Star, Eye, ArrowRight } from "lucide-react";
import { useProductsCatalog } from "@/context/ProductsContext";
import { trackAddToCart } from "@/lib/metaPixel";

const categories = ["Todos", "Adhesivas", "Facturación", "Más vendidos", "Repuestos"] as const;

export const ProductCard = ({ p }: { p: Product }) => {
  const { add } = useCart();
  const stock = Math.max(0, Number(p.stock ?? 0));
  const hasVariants = Boolean(p.subproducts?.length);
  const hasPurchasableVariant = Boolean(p.subproducts?.some((variant) => variant.active !== false && variant.price !== undefined && variant.stock !== undefined && variant.stock > 0));

  const handleAdd = () => {
    if (stock <= 0 || hasVariants) return;
    add(p.id, 1);
    trackAddToCart({
      content_ids: [p.id],
      content_name: p.name,
      content_type: "product",
      currency: "COP",
      value: p.price,
      contents: [{ id: p.id, quantity: 1, item_price: p.price }],
    });
    toast.success("Añadido al carrito", { description: p.name });
  };

  return (
    <article className="group relative flex h-full flex-col overflow-hidden border border-border bg-white shadow-soft transition-smooth hover:-translate-y-1 hover:shadow-elegant">
      {p.badge && (
        <span className="absolute left-4 top-4 z-10 bg-brand-red px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white shadow-soft">
          {p.badge}
        </span>
      )}
      <span className={`absolute right-4 top-4 z-10 border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${stock > 0 || hasPurchasableVariant ? "border-border bg-white/90 text-primary" : "border-destructive/20 bg-destructive/10 text-destructive"}`}>
        {hasVariants ? (hasPurchasableVariant ? "Ver opciones" : "Opciones pendientes") : stock > 0 ? `Stock: ${stock}` : "Sin stock"}
      </span>

      <Link to={`/products/${p.id}`} className="block overflow-hidden bg-muted">
        <div className="aspect-[4/3] overflow-hidden bg-[#edf3f3]">
          <img src={p.image} alt={p.name} loading="lazy" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = "/placeholder.svg"; }} className="h-full w-full object-contain p-5 transition-smooth duration-500 group-hover:scale-[1.04]" />
        </div>
      </Link>

      <div className="flex flex-1 flex-col p-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-primary/75">{p.category}</span>
          <div className="flex items-center gap-1 text-primary">
            <Star className="h-3.5 w-3.5 fill-current" />
            <span className="text-[11px] text-muted-foreground">4.9</span>
          </div>
        </div>

        <Link to={`/products/${p.id}`} className="group/title">
          <h3 className="font-display text-[1.6rem] leading-none text-secondary transition-smooth group-hover/title:text-primary">
            {p.name}
          </h3>
        </Link>

        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {p.description}
        </p>

        <div className="mt-4 flex items-end gap-2">
          <span className="font-display text-[2rem] leading-none text-primary">{formatCOP(p.price)}</span>
          {p.oldPrice && <span className="pb-1 text-sm text-muted-foreground line-through">{formatCOP(p.oldPrice)}</span>}
        </div>

        <div className="mt-4 text-xs text-muted-foreground">
          {stock > 0 ? `Quedan ${stock} unidades` : "Actualmente sin disponibilidad"}
        </div>

        <div className="mt-auto flex gap-2 pt-5">
          <Button asChild className="flex-1 rounded-md bg-primary text-primary-foreground shadow-soft hover:bg-secondary">
            <Link to={`/products/${p.id}`}><ShoppingCart className="h-4 w-4" />{hasVariants ? "Elegir opción" : stock > 0 ? "Añadir" : "Sin stock"}</Link>
          </Button>
          <Button asChild variant="outline" size="icon" className="rounded-md border-border bg-white text-primary hover:bg-primary hover:text-primary-foreground">
            <Link to={`/products/${p.id}`} aria-label="Ver detalle">
              <Eye className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
};

export const Products = () => {
  const { products: liveProducts } = useProductsCatalog();
  const [active, setActive] = useState<(typeof categories)[number]>("Todos");
  const list = useMemo(() => active === "Todos" ? liveProducts : liveProducts.filter((p) => p.category === active), [active, liveProducts]);

  return (
    <section id="productos" className="bg-white py-24">
      <div className="container-shelby">
        <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="eyebrow-shelby text-primary">Colección Shelby / 2026</span>
            <h2 className="mt-3 font-display text-4xl text-primary sm:text-5xl">Lo que tu negocio necesita</h2>
            <p className="mt-3 max-w-xl text-base text-muted-foreground">
              Equipos seleccionados uno por uno para ayudarte a vender, imprimir y operar sin fricción.
            </p>
          </div>
          <Button asChild variant="outline" className="self-start border-primary text-primary hover:bg-primary hover:text-primary-foreground sm:self-end">
            <Link to="/products" className="inline-flex items-center gap-2">
              Ver todo el catálogo
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="mb-8 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setActive(c)}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-smooth ${active === c ? "bg-primary text-primary-foreground shadow-soft" : "border border-border bg-white text-primary hover:bg-primary hover:text-primary-foreground"}`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">{list.map((p) => <ProductCard key={p.id} p={p} />)}</div>
      </div>
    </section>
  );
};
