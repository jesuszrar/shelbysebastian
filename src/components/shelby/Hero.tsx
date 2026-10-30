import { useEffect, useRef, useState, type TouchEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Truck, Sparkles, ArrowRight, MessageCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { SHELBY_WHATSAPP_URL } from "@/lib/contact";
import { useProductsCatalog } from "@/context/ProductsContext";

const carouselIds = [
  "niimbot-b1",
  "mp58",
  "mp80-02h",
  "mp80-04",
  "pt210",
  "niimbot-d110",
  "d11h",
];

const getStockLabel = (stock?: number | null) => stock === undefined || stock === null ? "Stock no disponible" : stock > 0 ? "En stock" : "Agotado";
const formatCOP = (value: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);

export const Hero = () => {
  const { products, loading, error } = useProductsCatalog();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const carouselProducts = products.filter((product) => carouselIds.includes(product.id));
  const activeProduct = carouselProducts[activeIndex];

  useEffect(() => {
    if (isPaused || carouselProducts.length === 0) return undefined;
    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % carouselProducts.length);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [isPaused, carouselProducts.length]);

  const moveTo = (index: number) => setActiveIndex((index + carouselProducts.length) % carouselProducts.length);

  const moveBy = (amount: number) => moveTo(activeIndex + amount);

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    touchStartX.current = event.touches[0].clientX;
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (touchStartX.current === null) return;
    const distance = event.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(distance) > 45) moveBy(distance > 0 ? -1 : 1);
    touchStartX.current = null;
  };

  if (loading) return <section id="inicio" className="min-h-[92vh] bg-[#edf3f3] px-6 py-32"><div className="container-shelby text-sm text-primary">Cargando catálogo...</div></section>;
  if (error) return <section id="inicio" className="min-h-[92vh] bg-[#edf3f3] px-6 py-32"><div className="container-shelby text-sm text-destructive">No se pudo cargar el catálogo: {error}</div></section>;
  if (!activeProduct) return <section id="inicio" className="min-h-[92vh] bg-[#edf3f3] px-6 py-32"><div className="container-shelby text-sm text-primary">No hay productos disponibles.</div></section>;

  return (
    <section id="inicio" className="relative flex min-h-[92vh] items-center overflow-hidden bg-[#edf3f3] pb-16 pt-32">
      <div className="absolute inset-0">
        <div className="absolute inset-0 tech-grid opacity-60" />
        <div className="absolute -right-32 top-28 h-72 w-[32rem] rotate-[-18deg] border-y-[18px] border-[#d9f24b]/40" />
      </div>
      <div className="container-shelby relative z-10 grid items-center gap-14 lg:grid-cols-[1fr_0.9fr]">
        <div className="max-w-2xl animate-[fadeInUp_0.7s_ease-out]">
          <span className="eyebrow-shelby inline-flex items-center gap-2 text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Tecnología para negocios en movimiento
          </span>
          <h1 className="mt-6 max-w-3xl text-6xl font-black leading-[0.86] tracking-[-0.04em] text-primary sm:text-7xl lg:text-[6.5rem]">
            Imprime ideas.
            <span className="mt-3 block text-secondary">Mueve tu negocio.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-primary/70 sm:text-lg">
            Soluciones de impresión térmica, lectura de código y suministros pensados para acelerar cada venta, cada factura y cada operación.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 sm:gap-4">
            <Button asChild size="lg" className="h-14 rounded-md bg-primary px-8 text-base text-white shadow-elegant hover:bg-secondary">
              <Link to="/products" className="inline-flex items-center gap-2">
                Ver catálogo
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-14 rounded-md border-primary/20 bg-white/60 px-8 text-base text-primary hover:bg-white">
              <a href={SHELBY_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
                <MessageCircle className="h-4 w-4" /> Hablar con Shelby
              </a>
            </Button>
          </div>
          <div className="mt-10 grid max-w-xl grid-cols-3 gap-4 sm:gap-6">
            {[
              { icon: Truck, k: "+1.500", v: "Envíos" },
              { icon: ShieldCheck, k: "30 días", v: "Garantía" },
              { icon: Sparkles, k: "4.9 ★", v: "Clientes" },
            ].map((s) => (
              <div key={s.v} className="border-l-2 border-secondary pl-3">
                <s.icon className="mb-2 h-4 w-4 text-secondary" />
                <div className="font-display text-2xl text-primary">{s.k}</div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-primary/60">{s.v}</div>
              </div>
            ))}
          </div>
        </div>

        <div
          className="relative block"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          onFocus={() => setIsPaused(true)}
          onBlur={() => setIsPaused(false)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          aria-roledescription="carrusel"
          aria-label="Productos destacados de Shelby"
        >
          <div className="absolute -inset-8 border border-secondary/20" />
          <div className="relative overflow-hidden border border-primary/10 bg-white p-5 shadow-elegant">
            <div className="border border-primary/10 bg-[#f3f7f7] p-5">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <div className="min-w-0 pr-3">
                  <p className="eyebrow-shelby text-slate-500">{String(activeIndex + 1).padStart(2, "0")} / Shelby selection</p>
                  <p className="mt-2 truncate font-display text-3xl text-slate-900">{activeProduct.name}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${activeProduct.stock === undefined || activeProduct.stock === null ? "bg-amber-100 text-amber-800" : activeProduct.stock === 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                  {getStockLabel(activeProduct.stock)}
                </span>
              </div>
              <Link to={`/products/${activeProduct.id}`} className="group relative mt-5 block aspect-[4/5] overflow-hidden bg-white shadow-soft" aria-label={`Ver detalle de ${activeProduct.name}`}>
                <img key={activeProduct.id} src={activeProduct.image} alt={`${activeProduct.name}, producto de impresión térmica`} className="h-full w-full animate-[fadeIn_0.35s_ease-out] object-contain p-6 transition-transform duration-500 group-hover:scale-[1.03]" />
              </Link>
              <div className="mt-4 flex items-center justify-between gap-3">
                <button type="button" onClick={() => moveBy(-1)} aria-label="Producto anterior" className="inline-flex h-10 w-10 shrink-0 items-center justify-center border border-primary/15 text-primary transition-smooth hover:border-secondary hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="flex min-w-0 items-center justify-center gap-1.5" role="tablist" aria-label="Seleccionar producto">
                  {carouselProducts.map((product, index) => (
                    <button key={product.id} type="button" role="tab" aria-selected={index === activeIndex} aria-label={`Ver ${product.name}`} onClick={() => moveTo(index)} className={`h-2 rounded-full transition-all ${index === activeIndex ? "w-6 bg-secondary" : "w-2 bg-primary/20 hover:bg-primary/45"}`} />
                  ))}
                </div>
                <button type="button" onClick={() => moveBy(1)} aria-label="Producto siguiente" className="inline-flex h-10 w-10 shrink-0 items-center justify-center border border-primary/15 text-primary transition-smooth hover:border-secondary hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary">
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-4 flex items-end justify-between gap-4">
                <div>
                  <p className="eyebrow-shelby text-slate-500">Desde</p>
                  <p className="font-display text-4xl text-slate-900">{formatCOP(activeProduct.price)}</p>
                </div>
                <Button asChild size="lg" className="h-12 rounded-md bg-secondary px-5 text-white hover:bg-primary">
                  <Link to={`/products/${activeProduct.id}`}>Comprar</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
