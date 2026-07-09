import { Truck, ShieldCheck, Headphones, Zap, CreditCard, Package } from "lucide-react";
const items = [
  { icon: Truck, title: "Envío gratis desde $460.000", desc: "A toda Colombia, sin letra pequeña ni recargos sorpresa." },
  { icon: ShieldCheck, title: "Garantía de 30 días", desc: "Si tu equipo falla, lo respondemos. Sin vueltas." },
  { icon: Headphones, title: "Asesoría real, no robots", desc: "Te ayudamos por WhatsApp a elegir lo que de verdad necesitas." },
  { icon: Zap, title: "Despacho en 24 horas", desc: "Facturas hoy, recibes mañana en las principales ciudades." },
  { icon: CreditCard, title: "Múltiples medios de pago", desc: "Nequi, Daviplata, Mercado Pago, transferencia o contraentrega." },
  { icon: Package, title: "Producto original y probado", desc: "Cada equipo lo revisamos antes de empacarlo. Punto." },
];
export const Benefits = () => (
  <section id="beneficios" className="py-24 bg-background">
    <div className="container-shelby">
      <div className="text-center max-w-2xl mx-auto mb-16">
        <span className="text-secondary text-xs uppercase tracking-[0.3em] font-semibold">Por qué elegirnos</span>
        <h2 className="font-display text-4xl sm:text-5xl text-primary mt-3">No vendemos cajas, vendemos tranquilidad</h2>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {items.map((it) => (
          <div key={it.title} className="group bg-card border border-border rounded-2xl p-7 shadow-soft hover:shadow-elegant transition-smooth hover:-translate-y-1">
            <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center shadow-soft group-hover:scale-110 transition-smooth">
              <it.icon className="h-6 w-6 text-white" />
            </div>
            <h3 className="font-display text-xl text-primary mt-5 tracking-wide">{it.title}</h3>
            <p className="text-primary/80 text-sm mt-2 leading-relaxed">{it.desc}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);
