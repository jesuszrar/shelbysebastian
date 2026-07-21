import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink } from "react-router-dom";
import { Menu, ShoppingCart, User, X, LogOut, ShieldCheck } from "lucide-react";
import logo from "@/assets/products/logo.png";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";

const links = [
  { label: "Inicio", to: "/", hash: false },
  { label: "Productos", to: "/products", hash: false },
  { label: "Beneficios", to: "/#beneficios", hash: true },
  { label: "Pagos", to: "/#pagos", hash: true },
  { label: "Contacto", to: "/#contacto", hash: true },
] as const;

export const Navbar = () => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { count } = useCart();
  const { user, logout, isAdmin } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
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

  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-smooth ${scrolled ? "bg-background/90 backdrop-blur-md shadow-soft" : "bg-background/60 backdrop-blur-sm"}`}>
      <div className="bg-primary text-white text-xs sm:text-sm py-2 text-center px-4">
        🇨🇴 Envío <span className="font-semibold text-[#DB9F74] drop-shadow-[0_0_1px_rgba(0,0,0,0.25)]">GRATIS</span> en compras superiores a $460.000 a toda Colombia
      </div>
      <nav className="container-shelby flex items-center justify-between py-3">
        <Link to="/" className="flex items-center gap-3 group">
          <img src={logo} alt="Logo Shelby Importaciones" className="h-12 w-12 rounded-md shadow-soft transition-smooth group-hover:scale-105" />
          <div className="leading-tight">
            <div className="font-display text-xl tracking-wide text-primary">SHELBY</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground -mt-1">Importaciones</div>
          </div>
        </Link>

        <div className="hidden lg:flex items-center gap-8">
          {links.map((l) =>
            l.hash ? (
              <a key={l.to} href={l.to} className="text-sm font-medium text-primary/80 hover:text-primary transition-smooth">{l.label}</a>
            ) : (
              <NavLink key={l.to} to={l.to} className={({ isActive }) => `text-sm font-medium transition-smooth ${isActive ? "text-primary" : "text-primary/80 hover:text-primary"}`}>{l.label}</NavLink>
            )
          )}
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {user ? (
            <>
              <span className="hidden md:inline text-sm text-primary/80 max-w-[140px] truncate">Hola, {user.name?.split(" ")[0] || "Cliente"}</span>
              <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex text-primary">
                <Link to="/profile">Mi cuenta</Link>
              </Button>
              {isAdmin && (
                <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex gap-2 text-primary">
                  <Link to="/admin"><ShieldCheck className="h-4 w-4" /> Admin</Link>
                </Button>
              )}
              <Button variant="ghost" size="icon" className="hidden md:inline-flex" onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut className="h-5 w-5" /></Button>
            </>
          ) : (
            <Button asChild variant="ghost" size="icon" className="hidden md:inline-flex" aria-label="Iniciar sesión"><Link to="/login"><User className="h-5 w-5" /></Link></Button>
          )}
          <Button asChild variant="ghost" size="icon" className="relative" aria-label="Carrito">
            <Link to="/cart">
              <ShoppingCart className="h-5 w-5" />
              {count > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] min-w-4 h-4 px-1 rounded-full flex items-center justify-center font-bold animate-scale-in">{count}</span>
              )}
            </Link>
          </Button>
          <Button asChild className="hidden sm:inline-flex bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft"><Link to="/products">Ver catálogo</Link></Button>
          <Button variant="ghost" size="icon" className="shrink-0 text-primary" onClick={() => setOpen((value) => !value)} aria-label="Menú">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </nav>

      {open && createPortal(
        <div className="fixed inset-0 z-[60]" aria-hidden={!open}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside
            className="absolute right-0 top-0 h-[100dvh] w-[min(88vw,24rem)] overflow-y-auto bg-background border-l border-border shadow-elegant"
            role="dialog"
            aria-label="Menú lateral"
          >
            <div className="flex min-h-full flex-col pb-[env(safe-area-inset-bottom)]">
              <div className="flex items-center justify-between border-b border-border px-6 py-5">
                <div>
                  <div className="font-display text-2xl tracking-wide text-primary">SHELBY</div>
                  <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground mt-1">Importaciones</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar menú" className="rounded-md p-2 hover:bg-muted">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 flex flex-col gap-2 px-6 py-5 overflow-y-auto">
                {links.map((l) =>
                  l.hash ? (
                    <a key={l.to} href={l.to} onClick={() => setOpen(false)} className="py-3 text-primary font-medium border-b border-border/50">{l.label}</a>
                  ) : (
                    <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="py-3 text-primary font-medium border-b border-border/50">{l.label}</Link>
                  )
                )}
                {!user ? (
                  <Link to="/login" onClick={() => setOpen(false)} className="py-3 text-primary font-medium border-b border-border/50">Iniciar sesión</Link>
                ) : (
                  <>
                    <Link to="/profile" onClick={() => setOpen(false)} className="py-3 text-primary font-medium border-b border-border/50">Mi cuenta</Link>
                    <button
                      type="button"
                      onClick={async () => { await logout(); setOpen(false); }}
                      className="py-3 text-primary font-medium text-left border-b border-border/50"
                    >
                      Cerrar sesión
                    </button>
                  </>
                )}
                {user && isAdmin && (
                  <Link to="/admin" onClick={() => setOpen(false)} className="py-3 text-primary font-medium border-b border-border/50 inline-flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" /> Panel admin
                  </Link>
                )}
              </div>
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </header>
  );
};
