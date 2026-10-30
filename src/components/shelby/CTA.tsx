import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { SHELBY_WHATSAPP_URL } from "@/lib/contact";
export const CTA = () => (
  <section id="contacto" className="bg-white py-24">
    <div className="container-shelby">
      <div className="relative overflow-hidden bg-primary p-10 shadow-elegant sm:p-14">
        <div className="absolute inset-y-0 right-0 hidden w-[38%] border-l border-white/10 bg-secondary/30 lg:block" />
        <div className="relative grid items-center gap-8 lg:grid-cols-2">
          <div>
            <span className="eyebrow-shelby text-white/80">Hablemos de tu operación</span>
            <h2 className="mt-3 max-w-2xl font-display text-4xl leading-none text-white sm:text-6xl">Haz que cada venta se vea mejor.</h2>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-white/75">Encuentra el equipo correcto, recibe asesoría real y empieza a operar con más confianza desde el primer día.</p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <Button asChild size="lg" className="h-14 bg-whatsapp px-8 text-white shadow-elegant hover:bg-whatsapp/90">
              <a href={SHELBY_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
                <MessageCircle className="h-5 w-5" /> Hablar por WhatsApp
              </a>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-14 border-white/30 bg-white/10 px-8 text-white hover:bg-white/20">
              <Link to="/products">Ver catálogo</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  </section>
);
