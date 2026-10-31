import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { ArrowLeft, Home, Search } from "lucide-react";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-[#f5f8f8]">
      <Navbar />
      <main className="flex min-h-[70vh] items-center justify-center px-4 pb-20 pt-36">
        <div className="relative w-full max-w-2xl overflow-hidden rounded-[2rem] bg-primary p-8 text-center text-white shadow-elegant sm:p-14">
          <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full border border-white/10" />
          <Search className="relative mx-auto h-10 w-10 text-white/70" />
          <p className="relative mt-6 text-xs font-semibold uppercase tracking-[0.3em] text-white/65">Ruta no encontrada</p>
          <h1 className="relative mt-3 font-display text-7xl leading-none sm:text-8xl">404</h1>
          <p className="relative mx-auto mt-4 max-w-md text-white/75">Esta página no está disponible, pero todavía puedes encontrar el equipo que necesitas.</p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild className="bg-white text-primary hover:bg-white/90"><Link to="/"><Home className="h-4 w-4" /> Ir al inicio</Link></Button>
            <Button asChild variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20"><Link to="/products"><ArrowLeft className="h-4 w-4" /> Ver catálogo</Link></Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default NotFound;
