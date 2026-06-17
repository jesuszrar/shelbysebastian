import { Banknote, Building2, CheckCircle2, CreditCard, Smartphone, ArrowLeftRight } from "lucide-react";
import { SiMastercard, SiMercadopago, SiVisa } from "react-icons/si";

type PaymentMethod = {
  name: string;
  label: string;
  badgeClassName: string;
  logo: React.ReactNode;
};

const methods: PaymentMethod[] = [
  {
    name: "Nequi",
    label: "Nequi",
    badgeClassName: "bg-white/15 text-white",
    logo: <img src="https://cdn.prod.website-files.com/6317a229ebf7723658463b4b/663a6b0d43303ddf38035997_logo-nequi.svg" alt="Logo Nequi" className="h-8 w-8 object-contain" />,
  },
  {
    name: "Daviplata",
    label: "Daviplata",
    badgeClassName: "bg-white/15 text-white",
    logo: <img src="https://www.daviplata.com/documents/d/guest/daviplata-3" alt="Logo Daviplata" className="h-8 w-8 object-contain" />,
  },
  {
    name: "Mercado Pago",
    label: "Mercado Pago",
    badgeClassName: "bg-white text-[#009ee3]",
    logo: <SiMercadopago className="h-8 w-8" />,
  },
  {
    name: "Visa",
    label: "Visa",
    badgeClassName: "bg-white text-[#1a1f71]",
    logo: <SiVisa className="h-8 w-8" />,
  },
  {
    name: "Mastercard",
    label: "Mastercard",
    badgeClassName: "bg-white text-[#eb001b]",
    logo: <SiMastercard className="h-8 w-8" />,
  },
  {
    name: "PSE",
    label: "PSE",
    badgeClassName: "bg-white/15 text-white",
    logo: <img src="https://www.pse.com.co/documents/1176709/209440457/Logo+PSE.png/5499f6e1-41fc-0d6e-b7d5-33b471bddb0c?version=1.0&t=1764195667958" alt="Logo PSE" className="h-8 w-8 object-contain" />,
  },
  {
    name: "Transferencia",
    label: "Transferencia",
    badgeClassName: "bg-white text-[#0f766e]",
    logo: <ArrowLeftRight className="h-8 w-8" />,
  },
  {
    name: "Bancolombia",
    label: "Bancolombia",
    badgeClassName: "bg-white/15 text-white",
    logo: <img src="https://www.bancolombia.com/wcm/connect/a67af2d6-c768-4f4f-a33b-fd58074f7ce9/logo-bancolombia-black.svg?MOD=AJPERES" alt="Logo Bancolombia" className="h-8 w-8 object-contain" />,
  },
  {
    name: "Contraentrega",
    label: "Contraentrega",
    badgeClassName: "bg-white text-[#334155]",
    logo: <Banknote className="h-8 w-8" />,
  },
];
export const Payments = () => (
  <section id="pagos" className="py-24 bg-primary text-secondary-foreground relative overflow-hidden">
    <div className="container-shelby relative">
      <div className="grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className="text-white text-xs uppercase tracking-[0.3em] font-semibold">Pagos seguros</span>
          <h2 className="font-display text-4xl sm:text-5xl mt-3 leading-tight">Paga como te quede más fácil</h2>
          <p className="mt-4 text-secondary-foreground/80 leading-relaxed max-w-lg">
            Aceptamos los métodos más usados en Colombia. Tu plata viaja segura, tu compra llega rápido, y si algo no cuadra, te respondemos por WhatsApp en minutos.
          </p>
          <ul className="mt-6 space-y-3">
            {["Sin recargos por usar Nequi o Daviplata", "Pago con tarjeta crédito o débito (Visa, Mastercard) vía Mercado Pago", "Confirmación inmediata por WhatsApp", "Contraentrega disponible en ciudades principales"].map((b) => (
              <li key={b} className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-white flex-shrink-0 mt-0.5" /><span className="text-secondary-foreground/90">{b}</span></li>
            ))}
          </ul>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {methods.map((m) => (
            <div key={m.name} className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl p-5 hover:border-white/25 hover:-translate-y-1 transition-smooth">
              <div className={`h-12 w-12 rounded-xl ${m.badgeClassName} flex items-center justify-center shadow-elegant overflow-hidden`}>
                {m.logo}
              </div>
              <div className="font-display text-lg mt-3 tracking-wide">{m.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);
