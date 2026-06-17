import logo from "@/assets/products/logo.png";
import { Instagram, Facebook, Mail, MapPin, Phone } from "lucide-react";
export const Footer = () => (
  <footer className="bg-primary text-white pt-16 pb-8">
    <div className="container-shelby grid md:grid-cols-4 gap-10">
      <div className="md:col-span-2">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Shelby Importaciones" className="h-12 w-12 rounded-md" />
          <div>
            <div className="font-display text-2xl tracking-wide">SHELBY</div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-white/70 -mt-1">Importaciones</div>
          </div>
        </div>
        <p className="mt-5 text-white/75 max-w-md text-sm leading-relaxed">
          Te acompañamos a imprimir tu éxito. Importamos y entregamos en toda Colombia impresoras térmicas portátiles, lectores y suministros con garantía y asesoría real.
        </p>
        <div className="flex gap-3 mt-6">
          {[Instagram, Facebook, Mail].map((Icon, i) => (
            <a key={i} href="#" className="h-10 w-10 rounded-lg bg-white/10 hover:bg-white hover:text-primary flex items-center justify-center transition-smooth"><Icon className="h-4 w-4" /></a>
          ))}
        </div>
      </div>
      <div>
        <h4 className="font-display text-lg tracking-wide mb-4">Contacto</h4>
        <ul className="space-y-3 text-sm text-white/80">
          <li className="flex items-start gap-2"><Phone className="h-4 w-4 mt-0.5 text-secondary" /> +57 322 842 6561</li>
          <li className="flex items-start gap-2"><Mail className="h-4 w-4 mt-0.5 text-secondary" /> hola@shelbyimportaciones.com</li>
          <li className="flex items-start gap-2"><MapPin className="h-4 w-4 mt-0.5 text-secondary" /> Bogotá, Colombia</li>
        </ul>
      </div>
      <div>
        <h4 className="font-display text-lg tracking-wide mb-4">Enlaces</h4>
        <ul className="space-y-2 text-sm text-white/80">
          <li><a href="/products" className="hover:text-secondary transition-smooth">Catálogo</a></li>
          <li><a href="/#beneficios" className="hover:text-secondary transition-smooth">Beneficios</a></li>
          <li><a href="/#pagos" className="hover:text-secondary transition-smooth">Métodos de pago</a></li>
          <li><a href="/#contacto" className="hover:text-secondary transition-smooth">Contacto</a></li>
        </ul>
      </div>
    </div>
    <div className="container-shelby border-t border-white/10 mt-12 pt-6 text-xs text-white/60 text-center">
      © {new Date().getFullYear()} Shelby Importaciones. Todos los derechos reservados.
    </div>
  </footer>
);
