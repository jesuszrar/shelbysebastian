import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { ProductCard, productHasCategory } from "@/components/shelby/Products";
import { useProductsCatalog } from "@/context/ProductsContext";
import type { CatalogCategory } from "@/data/products";
import { fetchData } from "@/integrations/api/client";

const fallbackCategories = ["Adhesivas", "Facturación", "Más vendidos", "Repuestos"];

const ProductsPage = ({ onlySupplies = false }: { onlySupplies?: boolean }) => {
  const { products, loading, error } = useProductsCatalog();
  const [searchParams, setSearchParams] = useSearchParams();
  const [active, setActive] = useState("");
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [categories, setCategories] = useState<CatalogCategory[]>([]);

  useEffect(() => {
    let mounted = true;
    void fetchData<CatalogCategory[]>("categories").then(({ data, error }) => {
      if (!mounted) return;
      if (error) console.error("Error loading catalog categories", error);
      setCategories(Array.isArray(data) ? data : []);
    });
    return () => { mounted = false; };
  }, []);

  const categoryNames = categories.length ? categories.map((category) => category.name) : fallbackCategories;

  useEffect(() => {
    if (categoryNames.length && !categoryNames.includes(active)) setActive(categoryNames[0]);
  }, [active, categories]);

  const list = useMemo(() => {
    let l = onlySupplies
      ? products.filter((product) => productHasCategory(product, "Repuestos"))
      : active ? products.filter((product) => productHasCategory(product, active)) : [];
    if (query.trim()) { const q = query.toLowerCase(); l = l.filter((p) => p.name.toLowerCase().includes(q)); }
    return l;
  }, [active, query, products, onlySupplies]);

  return (
    <div className="min-h-screen bg-[#f5f8f8]">
      <Navbar />
      <main className="pb-24 pt-32">
        <div className="container-shelby">
          <div className="relative mb-10 overflow-hidden rounded-[2rem] bg-primary px-6 py-12 text-white shadow-elegant sm:px-10 lg:px-14">
            <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full border border-white/10" />
            <div className="absolute -bottom-36 right-20 h-80 w-80 rounded-full border border-white/10" />
            <div className="relative max-w-2xl">
              <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/75"><Sparkles className="h-3.5 w-3.5" /> {onlySupplies ? "Insumos Shelby" : "Catálogo Shelby"}</span>
              <h1 className="mt-4 font-display text-5xl leading-[0.92] sm:text-6xl">{onlySupplies ? "Insumos listos para operar." : "Tecnología que trabaja contigo."}</h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-white/75">{onlySupplies ? "Rollos, baterías y repuestos para mantener tu operación en marcha." : "Impresoras térmicas, lectores y suministros listos para hacer más simple cada operación de tu negocio."}</p>
            </div>
          </div>
          <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Encuentra tu equipo</span>
              <h2 className="mt-2 font-display text-4xl text-primary sm:text-5xl">Elige lo que necesitas</h2>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><SlidersHorizontal className="h-4 w-4" /> {list.length} productos disponibles</div>
          </div>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input type="search" value={query} onChange={(e) => { const value = e.target.value; setQuery(value); setSearchParams(value ? { q: value } : {}, { replace: true }); }} placeholder="Buscar por nombre..." aria-label="Buscar productos"
                className="h-12 w-full rounded-2xl border border-border bg-white pl-11 pr-4 text-primary shadow-soft outline-none transition-smooth focus:border-primary focus:ring-2 focus:ring-primary/15" />
            </label>
          </div>
            {!onlySupplies && <div className="mb-10 flex flex-wrap gap-2">
            {categoryNames.map((c) => (
              <button key={c} type="button" onClick={() => setActive(c)} className={`rounded-full px-4 py-2 text-sm font-medium transition-smooth ${active === c ? "bg-primary text-primary-foreground shadow-soft" : "border border-border bg-white text-primary hover:bg-primary hover:text-primary-foreground"}`}>{c}</button>
            ))}
          </div>}
          {loading ? <div className="rounded-[2rem] border border-border bg-white px-6 py-20 text-center shadow-soft"><p className="text-muted-foreground">Cargando productos...</p></div> : error ? <div className="rounded-[2rem] border border-destructive/20 bg-destructive/5 px-6 py-20 text-center shadow-soft"><p className="text-destructive">No se pudo cargar el catálogo: {error}</p></div> : list.length === 0 ? (
            <div className="rounded-[2rem] border border-dashed border-border bg-white px-6 py-20 text-center shadow-soft"><Search className="mx-auto h-10 w-10 text-primary/50" /><p className="mt-4 text-muted-foreground">No encontramos productos con esa búsqueda.</p></div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">{list.map((p) => <ProductCard key={p.id} p={p} />)}</div>
          )}
        </div>
      </main>
      <Footer />\n    </div>
  );
};
export default ProductsPage;
