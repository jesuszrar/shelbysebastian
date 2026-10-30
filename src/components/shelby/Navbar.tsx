import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Menu, ShoppingCart, User, X, LogOut, ShieldCheck, Search } from "lucide-react";
import logo from "@/assets/products/logo.png";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";

const links = [
  { label: "Inicio", to: "/", hash: false },
  { label: "Productos", to: "/products", hash: false },
  { label: "Insumos", to: "/insumos", hash: false },
  { label: "Certificado", to: "/certificado", hash: false },
  { label: "Beneficios", to: "/#beneficios", hash: true },
  { label: "Pagos", to: "/#pagos", hash: true },
  { label: "Contacto", to: "/#contacto", hash: true },
] as const;

export const Navbar = () => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { count } = useCart();
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate(search.trim() ? `/products?q=${encodeURIComponent(search.trim())}` : "/products");
  };

  return (
    <header className={`fixed inset-x-0 top-0 z-50 border-b transition-smooth ${scrolled ? "border-border bg-white/95 shadow-soft backdrop-blur-xl" : "border-primary/10 bg-[#edf3f3]/90 backdrop-blur-md"}`}>
      <div className="bg-primary px-4 py-2 text-center text-[10px] font-bold uppercase tracking-[0.22em] text-white sm:text-xs">
        Envío gratis desde $460.000 a toda Colombia
      </div>
      <nav className="container-shelby flex items-center justify-between py-3">
        <Link to="/" className="flex items-center gap-3 group">
          <div className="bg-white p-1.5 shadow-soft ring-1 ring-border">
            <img src={logo} alt="Logo Shelby Importaciones" className="h-9 w-9 object-cover transition-smooth group-hover:scale-105" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-xl tracking-[0.18em] text-primary sm:text-2xl">SHELBY</div>
            <div className="-mt-1 text-[9px] uppercase tracking-[0.28em] text-muted-foreground">Importaciones</div>
          </div>
        </Link>

        <div className="hidden items-center gap-7 lg:flex">
          {links.map((l) =>
            l.hash ? (
              <a key={l.to} href={l.to} className="text-sm font-medium text-primary/75 hover:text-primary transition-smooth">{l.label}</a>
            ) : (
              <NavLink key={l.to} to={l.to} className={({ isActive }) => `text-sm font-medium transition-smooth ${isActive ? "text-primary" : "text-primary/75 hover:text-primary"}`}>{l.label}</NavLink>
            )
          )}
        </div>

        <form onSubmit={submitSearch} className="hidden items-center gap-2 xl:flex">
          <label className="flex items-center gap-2 rounded-full border border-border bg-white/80 px-3 py-2 shadow-soft">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar" aria-label="Buscar productos" className="w-24 bg-transparent text-sm text-primary outline-none placeholder:text-muted-foreground" />
          </label>
        </form>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {user ? (
            <>
              <span className="hidden md:inline max-w-[150px] truncate text-sm font-medium text-primary/80">Hola, {user.name?.split(" ")[0] || "Cliente"}</span>
              <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex text-primary hover:bg-primary/5">
                <Link to="/profile">Mi cuenta</Link>
              </Button>
              {isAdmin && (
                <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex gap-2 text-primary hover:bg-primary/5">
                  <Link to="/admin"><ShieldCheck className="h-4 w-4" /> Admin</Link>
                </Button>
              )}
              <Button variant="ghost" size="icon" className="hidden md:inline-flex hover:bg-primary/5" onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut className="h-4 w-4" /></Button>
            </>
          ) : (
            <Button asChild variant="ghost" size="icon" className="hidden md:inline-flex hover:bg-primary/5" aria-label="Iniciar sesión"><Link to="/login"><User className="h-4 w-4" /></Link></Button>
          )}
          <Button asChild variant="ghost" size="icon" className="relative hover:bg-primary/5" aria-label="Carrito">
            <Link to="/cart" className="relative inline-flex h-10 w-10 items-center justify-center">
              <ShoppingCart className="h-4 w-4" />
              {count > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">{count}</span>
              )}
            </Link>
          </Button>
          <Link to="/niimbot" className="hidden items-center gap-1 text-sm font-semibold text-primary transition-smooth hover:text-secondary xl:inline-flex">
            Niimbot <span aria-hidden="true">↗</span>
          </Link>
          <Button asChild className="hidden rounded-md bg-primary text-primary-foreground shadow-soft hover:bg-secondary sm:inline-flex">
            <Link to="/products">Ver catálogo</Link>
          </Button>
          <Button variant="ghost" size="icon" className="shrink-0 text-primary hover:bg-primary/5 lg:hidden" onClick={() => setOpen((value) => !value)} aria-label="Menú">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </nav>

      {open && createPortal(
        <div className="fixed inset-0 z-[60]" aria-hidden={!open}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside
            className="absolute right-0 top-0 h-[100dvh] w-[min(88vw,24rem)] overflow-y-auto border-l border-border bg-background shadow-elegant"
            role="dialog"
            aria-label="Menú lateral"
          >
            <div className="flex min-h-full flex-col pb-[env(safe-area-inset-bottom)]">
              <div className="flex items-center justify-between border-b border-border px-6 py-5">
                <div>
                  <div className="font-display text-2xl tracking-[0.12em] text-primary">SHELBY</div>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Importaciones</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar menú" className="rounded-xl p-2 hover:bg-muted">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 px-6 py-5">
                <form onSubmit={submitSearch} className="mb-4 flex items-center gap-2 rounded-2xl border border-border bg-white px-3 py-2.5 shadow-soft">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar productos" aria-label="Buscar productos" className="min-w-0 flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-muted-foreground" />
                </form>
                <div className="space-y-2">
                  {links.map((l) =>
                    l.hash ? (
                      <a key={l.to} href={l.to} onClick={() => setOpen(false)} className="block border-b border-border/60 py-3 text-base font-medium text-primary">{l.label}</a>
                    ) : (
                      <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="block border-b border-border/60 py-3 text-base font-medium text-primary">{l.label}</Link>
                    )
                  )}
                  <Link to="/niimbot" onClick={() => setOpen(false)} className="block border-b border-border/60 py-3 text-base font-semibold text-primary">
                    Niimbot <span aria-hidden="true">↗</span>
                  </Link>
                  {!user ? (
                    <Link to="/login" onClick={() => setOpen(false)} className="block border-b border-border/60 py-3 text-base font-medium text-primary">Iniciar sesión</Link>
                  ) : (
                    <>
                      <Link to="/profile" onClick={() => setOpen(false)} className="block border-b border-border/60 py-3 text-base font-medium text-primary">Mi cuenta</Link>
                      <button
                        type="button"
                        onClick={async () => { await logout(); setOpen(false); }}
                        className="block w-full border-b border-border/60 py-3 text-left text-base font-medium text-primary"
                      >
                        Cerrar sesión
                      </button>
                    </>
                  )}
                  {user && isAdmin && (
                    <Link to="/admin" onClick={() => setOpen(false)} className="inline-flex items-center gap-2 border-b border-border/60 py-3 text-base font-medium text-primary">
                      <ShieldCheck className="h-4 w-4" /> Panel admin
                    </Link>
                  )}
                  <Button asChild className="mt-6 h-12 w-full rounded-md bg-primary text-primary-foreground shadow-soft hover:bg-secondary">
                    <Link to="/products" onClick={() => setOpen(false)}>Ver catálogo</Link>
                  </Button>
                </div>
              </div>
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </header>
  );
};
