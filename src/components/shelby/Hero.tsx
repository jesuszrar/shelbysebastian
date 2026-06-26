import hero from "@/assets/hero-warehouse.jpg";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Truck, Sparkles } from "lucide-react";

export const Hero = () => (
  <section id="inicio" className="relative min-h-[92vh] flex items-center pt-32 pb-20 overflow-hidden">
    <img src={hero} alt="Bodega Shelby Importaciones" className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-hero" />
    <div className="absolute inset-0 bg-primary/30" />
    <div className="container-shelby relative z-10 grid lg:grid-cols-12 gap-10 items-center">
      <div className="lg:col-span-7 animate-fade-in-up">
        <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/20 border border-white/20 text-white text-xs font-semibold tracking-wider uppercase backdrop-blur-sm">
          <Sparkles className="h-3.5 w-3.5" />
          Tienda 100% colombiana · Envíos a todo el país
        </span>
        <h1 className="mt-6 font-display text-5xl sm:text-6xl lg:text-7xl xl:text-8xl text-white leading-[0.95] text-balance">
          Imprime tu negocio,<br />
          <span className="text-white">imprime tu éxito.</span>
        </h1>
        <p className="mt-6 text-lg sm:text-xl text-white/90 max-w-2xl leading-relaxed">
          Impresoras térmicas portátiles, lectores de código y suministros para que factures, etiquetes y crezcas sin enredarte con cables ni equipos pesados. Asesoría real, precios honestos.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft text-base h-14 px-8"><Link to="/products">Ver catálogo completo</Link></Button>
          <Button asChild size="lg" variant="outline" className="border-white/35 bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm h-14 px-8">
            <a href="https://wa.me/573228426561" target="_blank" rel="noopener noreferrer">Hablar con un asesor</a>
          </Button>
        </div>
        <div className="mt-10 grid grid-cols-3 gap-6 max-w-xl">
          {[
            { icon: Truck, k: "+1.500", v: "Envíos hechos" },
            { icon: ShieldCheck, k: "30 días", v: "Garantía real" },
            { icon: Sparkles, k: "4.9 ★", v: "Clientes felices" },
          ].map((s) => (
            <div key={s.v} className="text-white">
              <s.icon className="h-5 w-5 text-white mb-2" />
              <div className="font-display text-2xl">{s.k}</div>
              <div className="text-xs text-white/75 uppercase tracking-wider">{s.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);
