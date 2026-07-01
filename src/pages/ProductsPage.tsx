import { useState, useMemo } from "react";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { WhatsAppButton } from "@/components/shelby/WhatsAppButton";
import { ProductCard } from "@/components/shelby/Products";
import { useProductsCatalog } from "@/context/ProductsContext";

const categories = ["Todos", "Adhesivas", "Facturación", "Más vendidos", "Repuestos"] as const;

const ProductsPage = () => {
  const { products } = useProductsCatalog();
  const [active, setActive] = useState<(typeof categories)[number]>("Todos");
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    let l = active === "Todos" ? products : products.filter((p) => p.category === active);
    if (query.trim()) { const q = query.toLowerCase(); l = l.filter((p) => p.name.toLowerCase().includes(q)); }
    return l;
  }, [active, query, products]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-32 pb-20">
        <div className="container-shelby">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <span className="text-primary text-xs uppercase tracking-[0.3em] font-semibold">Catálogo completo</span>
            <h1 className="font-display text-5xl sm:text-6xl text-secondary mt-3">Todo lo que necesita tu negocio</h1>
            <p className="text-muted-foreground mt-4">Compra fácil y rápido. Envíos a todo Colombia.</p>
          </div>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto..."
            className="w-full px-4 py-3 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40 transition-smooth mb-6" />
          <div className="flex flex-wrap gap-2 mb-8">
            {categories.map((c) => (
              <button key={c} onClick={() => setActive(c)} className={`px-4 py-2 rounded-full text-sm font-medium transition-smooth ${active === c ? "bg-secondary text-secondary-foreground shadow-soft" : "bg-muted text-muted-foreground hover:bg-accent"}`}>{c}</button>
            ))}
          </div>
          {list.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">No encontramos productos.</div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">{list.map((p) => <ProductCard key={p.id} p={p} />)}</div>
          )}
        </div>
      </main>
      <Footer />
      <WhatsAppButton />
    </div>
  );
};
export default ProductsPage;
