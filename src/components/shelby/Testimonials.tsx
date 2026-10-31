const items = [
  { name: "Andrés M.", city: "Medellín", text: "Pedí una etiqueta y un lector para mi negocio y todo llegó muy rápido. La atención fue clara y el equipo me ayudó a elegir bien." },
  { name: "Laura P.", city: "Bogotá", text: "Me asesoraron por WhatsApp, me explicaron sin enredos cuál impresora me servía. Excelente atención, súper recomendados." },
  { name: "Camilo R.", city: "Cali", text: "Llevo meses facturando desde mi food truck. El equipo funciona bien y la atención siempre responde rápido cuando tengo dudas." },
  { name: "Diana S.", city: "Barranquilla", text: "Compré rollos y un lector. Precios honestos y todo original. Volveré a pedir sin pensarlo." },
];

export const Testimonials = () => (
  <section className="bg-primary py-24 text-white">
    <div className="container-shelby">
      <div className="mb-14 grid items-end gap-8 lg:grid-cols-[0.7fr_1.3fr]">
        <div className="border-l-2 border-[#d9f24b] pl-5">
          <div className="font-display text-7xl leading-none text-[#d9f24b]">4.9</div>
          <div className="mt-2 text-xs font-bold uppercase tracking-[0.25em] text-white/60">Experiencia promedio</div>
        </div>
        <div>
          <span className="eyebrow-shelby text-white/65">Lo que dicen nuestros clientes</span>
          <h2 className="mt-3 max-w-2xl font-display text-4xl leading-none text-white sm:text-5xl">Equipos que se convierten en negocios que avanzan.</h2>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {items.map((t) => (
          <figure key={t.name} className="group flex h-full flex-col border border-white/15 bg-white/10 p-7 backdrop-blur-sm transition-smooth hover:-translate-y-1 hover:bg-white hover:text-primary">
            <div className="font-display text-4xl leading-none text-[#d9f24b]">“</div>
            <blockquote className="mt-2 flex-1 text-sm leading-relaxed text-white/75 transition-colors group-hover:text-primary">{t.text}</blockquote>
            <figcaption className="mt-5 border-t border-white/15 pt-4">
              <div className="font-semibold">{t.name}</div>
              <div className="text-xs uppercase tracking-[0.18em] text-white/55 transition-colors group-hover:text-primary/55">{t.city}, Colombia</div>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  </section>
);
