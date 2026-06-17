const items = [
  { name: "Andrés M.", city: "Medellín", text: "Pedí la NIIMBOT B1 un viernes y me llegó el lunes. Funciona perfecto con mi celular para etiquetar el inventario de la tienda." },
  { name: "Laura P.", city: "Bogotá", text: "Me asesoraron por WhatsApp, me explicaron sin enredos cuál impresora me servía. Excelente atención, súper recomendados." },
  { name: "Camilo R.", city: "Cali", text: "Llevo 6 meses con la PT-210 facturando en mi food truck. Ni un solo problema y la batería rinde toda la jornada." },
  { name: "Diana S.", city: "Barranquilla", text: "Compré rollos y un lector. Precios honestos y todo original. Volveré a pedir sin pensarlo." },
];
export const Testimonials = () => (
  <section className="py-24 bg-background">
    <div className="container-shelby">
      <div className="text-center mb-14">
        <span className="text-secondary text-xs uppercase tracking-[0.3em] font-semibold">Lo que dicen nuestros clientes</span>
        <h2 className="font-display text-4xl sm:text-5xl text-primary mt-3">Historias reales, negocios creciendo</h2>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {items.map((t) => (
          <figure key={t.name} className="bg-card border border-border rounded-2xl p-7 shadow-soft hover:shadow-elegant transition-smooth hover:-translate-y-1 flex flex-col">
            <div className="text-primary text-4xl font-display leading-none">"</div>
            <blockquote className="text-primary/80 leading-relaxed text-sm mt-2 flex-1">{t.text}</blockquote>
            <figcaption className="mt-5 pt-4 border-t border-border">
              <div className="font-semibold text-primary">{t.name}</div>
              <div className="text-xs text-primary/70">{t.city}, Colombia</div>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  </section>
);
