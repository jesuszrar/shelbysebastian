import niimbotB1 from "@/assets/products/niimbot-b1.jpg";
import niimbotD110 from "@/assets/products/niimbot-d110.jpg";
import lector from "@/assets/products/lector.jpg";
import mp58 from "@/assets/products/mp58.jpg";
import pt210 from "@/assets/products/pt210.jpg";
import bateria from "@/assets/products/bateria.jpg";
import rollo from "@/assets/products/rollo.jpg";

export type ProductCategory = "Adhesivas" | "Facturación" | "Más vendidos" | "Repuestos";

export type Product = {
  id: string;
  name: string;
  category: ProductCategory;
  image: string;
  price: number;
  stock?: number;
  oldPrice?: number;
  badge?: string;
  highlight?: boolean;
  description: string;
  specs: string[];
};

export const products: Product[] = [
  { id: "niimbot-b1", name: "Impresora NIIMBOT B1", category: "Adhesivas", image: niimbotB1, price: 169900, oldPrice: 260000, badge: "-35%", highlight: true,
    description: "Impresora térmica portátil para etiquetas adhesivas. Ideal para emprendedores que necesitan rotular productos, paquetes o inventario sin enredos.",
    specs: ["Conexión Bluetooth", "Compatible con iOS y Android", "Imprime etiquetas de 20–50 mm", "Batería recargable"] },
  { id: "mp58", name: "Impresora MP58 – 01", category: "Facturación", image: mp58, price: 149900, oldPrice: 160000, badge: "-6%",
    description: "Impresora térmica de facturación 58 mm. Rápida, silenciosa y compatible con la mayoría de POS y apps de facturación electrónica.",
    specs: ["Ancho 58 mm", "Bluetooth + USB", "Hasta 90 mm/s", "Compatible con apps de facturación"] },
  { id: "mp80-02h", name: "Impresora MP80-02H", category: "Facturación", image: mp58, price: 259900,
    description: "Impresora térmica de 80 mm para facturación rápida y operaciones con mayor volumen. Una opción robusta para puntos de venta.",
    specs: ["Ancho 80 mm", "Bluetooth + USB", "Impresión térmica", "Ideal para facturación"] },
  { id: "mp80-04", name: "Impresora MP80-04", category: "Facturación", image: pt210, price: 229900,
    description: "Impresora térmica de 80 mm pensada para tickets, facturación y atención al cliente con un flujo de trabajo más ágil.",
    specs: ["Ancho 80 mm", "Bluetooth + USB", "Impresión térmica", "Pensada para alto volumen"] },
  { id: "pt210", name: "Impresora Gooj PT-210", category: "Facturación", image: pt210, price: 130000, oldPrice: 160000, badge: "-19%",
    description: "Impresora portátil 58 mm con batería de larga duración. Perfecta para domicilios, mercados y ventas en la calle.",
    specs: ["Batería incluida", "Bluetooth", "Ancho 58 mm", "Tamaño compacto"] },
  { id: "niimbot-d110", name: "Impresora NIIMBOT D110", category: "Adhesivas", image: niimbotD110, price: 119900, oldPrice: 160000, badge: "-25%",
    description: "La etiquetadora más vendida de NIIMBOT. Diseño compacto, conexión por app y miles de plantillas listas.",
    specs: ["App con plantillas gratis", "Bluetooth", "Etiquetas 12–15 mm", "Recargable USB-C"] },
  { id: "d11h", name: "Impresora NIIMBOT D11H", category: "Adhesivas", image: niimbotD110, price: 149900,
    description: "Etiquetadora compacta para imprimir stickers y etiquetas desde el celular con una experiencia simple y portátil.",
    specs: ["Conexión Bluetooth", "Compatible con iOS y Android", "Etiquetas adhesivas", "Recargable por USB"] },
  { id: "lector", name: "Lector de código de barras", category: "Más vendidos", image: lector, price: 55000, oldPrice: 90000, badge: "-39%",
    description: "Lector láser USB plug & play. Reconoce códigos 1D rápido y sin configuración. Compatible con Windows, macOS y Linux.",
    specs: ["Conexión USB", "Lectura láser 1D", "Plug & Play", "Soporte incluido"] },
  { id: "bateria", name: "Batería Gooj PT-210 / MTP-11", category: "Repuestos", image: bateria, price: 50000, oldPrice: 60000, badge: "-17%",
    description: "Batería original de repuesto para impresoras Gooj PT-210 y MTP-11. Recupera la autonomía de tu equipo.",
    specs: ["Compatible PT-210 y MTP-11", "Capacidad original", "Fácil instalación"] },
  { id: "rollo", name: "Rollo adhesivo 58 mm × 7 m", category: "Repuestos", image: rollo, price: 5000, oldPrice: 22000, badge: "-77%",
    description: "Rollo de papel térmico adhesivo de 58 mm de ancho y 7 metros de largo. Perfecto para etiquetar productos y envíos.",
    specs: ["Ancho 58 mm", "Largo 7 m", "Adhesivo permanente", "Térmico de alta calidad"] },
];

export const formatCOP = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

export const getProductById = (id: string) => products.find((p) => p.id === id);
