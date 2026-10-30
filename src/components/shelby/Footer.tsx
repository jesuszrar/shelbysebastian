import logo from "@/assets/products/logo.png";
import { Instagram, Facebook, Mail, MapPin, Phone } from "lucide-react";

export const Footer = () => (
  <footer className="bg-primary pt-16 pb-8 text-white">
    <div className="container-shelby grid gap-10 md:grid-cols-2 lg:grid-cols-4">
      <div className="lg:col-span-2">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Shelby Importaciones" className="h-12 w-12 rounded-md" />
          <div>
            <div className="font-display text-2xl tracking-[0.18em]">SHELBY</div>
            <div className="-mt-1 text-[10px] uppercase tracking-[0.28em] text-white/70">Importaciones</div>
          </div>
        </div>
        <p className="mt-5 max-w-md text-sm leading-relaxed text-white/75">
          Te acompañamos a imprimir tu éxito. Importamos y entregamos en toda Colombia impresoras térmicas portátiles, lectores y suministros con garantía y asesoría real.
        </p>
        <div className="mt-6 flex gap-3">
          {[Instagram, Facebook, Mail].map((Icon, i) => (
            <a key={i} href="#" className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white transition-smooth hover:bg-white hover:text-primary">
              <Icon className="h-4 w-4" />
            </a>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-4 font-display text-xl tracking-wide">Contacto</h4>
        <ul className="space-y-3 text-sm text-white/80">
          <li className="flex items-start gap-2"><Phone className="mt-0.5 h-4 w-4 text-secondary" /> +57 322 842 6561</li>
          <li className="flex items-start gap-2"><Mail className="mt-0.5 h-4 w-4 text-secondary" /> hola@shelbyimportaciones.com</li>
          <li className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 text-secondary" /> Bogotá, Colombia</li>
        </ul>
      </div>

      <div>
        <h4 className="mb-4 font-display text-xl tracking-wide">Enlaces</h4>
        <ul className="space-y-2 text-sm text-white/80">
          <li><a href="/products" className="transition-smooth hover:text-secondary">Catálogo</a></li>
          <li><a href="/#beneficios" className="transition-smooth hover:text-secondary">Beneficios</a></li>
          <li><a href="/#pagos" className="transition-smooth hover:text-secondary">Métodos de pago</a></li>
          <li><a href="/#contacto" className="transition-smooth hover:text-secondary">Contacto</a></li>
        </ul>
      </div>
    </div>

    <div className="container-shelby mt-12 border-t border-white/10 pt-6 text-center text-xs text-white/60">
      © {new Date().getFullYear()} Shelby Importaciones. Todos los derechos reservados.
    </div>
  </footer>
);
