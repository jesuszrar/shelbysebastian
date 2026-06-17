import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
export const CTA = () => (
  <section id="contacto" className="py-24 bg-background">
    <div className="container-shelby">
      <div className="relative bg-primary rounded-2xl p-10 sm:p-16 overflow-hidden shadow-elegant">
        <div className="absolute inset-y-0 right-0 hidden lg:block w-[34%] bg-secondary/20 rounded-l-[2rem]" />
        <div className="relative grid lg:grid-cols-2 gap-8 items-center">
          <div>
            <h2 className="font-display text-4xl sm:text-5xl text-white leading-tight">¿Listo para imprimir <span className="text-white">tu próximo pedido?</span></h2>
            <p className="text-white/80 mt-4 max-w-lg">Escríbenos por WhatsApp y te asesoramos sin compromiso.</p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <Button asChild size="lg" className="bg-whatsapp hover:bg-whatsapp/90 text-white h-14 px-8 shadow-elegant">
              <a href="https://wa.me/573228426561" target="_blank" rel="noopener noreferrer"><MessageCircle className="h-5 w-5" /> Hablar por WhatsApp</a>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20 h-14 px-8"><Link to="/products">Ver catálogo</Link></Button>
          </div>
        </div>
      </div>
    </div>
  </section>
);
