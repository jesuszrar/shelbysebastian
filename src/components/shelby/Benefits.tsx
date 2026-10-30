import { Truck, ShieldCheck, Headphones, Zap, CreditCard, Package } from "lucide-react";

const items = [
  { icon: Truck, title: "Envío gratis desde $460.000", desc: "A toda Colombia, sin letra pequeña ni recargos sorpresa." },
  { icon: ShieldCheck, title: "Garantía de 30 días", desc: "Si tu equipo falla, lo respondemos. Sin vueltas." },
  { icon: Headphones, title: "Asesoría real, no robots", desc: "Te ayudamos por WhatsApp a elegir lo que de verdad necesitas." },
  { icon: Zap, title: "Despacho en 24 horas", desc: "Facturas hoy, recibes mañana en las principales ciudades." },
  { icon: CreditCard, title: "Múltiples medios de pago", desc: "Nequi, Daviplata, Wompi, transferencia o contraentrega." },
  { icon: Package, title: "Producto original y probado", desc: "Cada equipo lo revisamos antes de empacarlo. Punto." },
];

export const Benefits = () => (
  <section id="beneficios" className="bg-[#edf3f3] py-24">
    <div className="container-shelby">
      <div className="mb-14 grid items-end gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <span className="eyebrow-shelby text-primary">El estándar Shelby</span>
          <div className="mt-4 font-display text-7xl leading-none text-secondary">01—06</div>
        </div>
        <div className="max-w-2xl">
          <h2 className="font-display text-4xl leading-none text-primary sm:text-5xl">Todo lo que necesitas para avanzar.</h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-primary/65">No se trata solo de comprar un equipo. Se trata de tener una operación más rápida, clara y lista para crecer.</p>
        </div>
      </div>
      <div className="grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-3">
        {items.map((it) => (
          <div key={it.title} className="group bg-white/95 p-7 transition-smooth hover:bg-primary hover:text-white">
            <div className="flex h-12 w-12 items-center justify-center bg-primary shadow-soft transition-smooth group-hover:scale-110">
              <it.icon className="h-5 w-5 text-white" />
            </div>
            <h3 className="mt-5 font-display text-2xl leading-none text-primary transition-colors group-hover:text-white">{it.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground transition-colors group-hover:text-white/70">{it.desc}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);
