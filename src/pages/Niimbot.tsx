import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Download,
  Headphones,
  Package,
  Printer,
  ShieldCheck,
  Smartphone,
  Tag,
} from "lucide-react";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { useProductsCatalog } from "@/context/ProductsContext";
import { fetchNiimbotPageImageUrl, fetchNiimbotPageImages } from "@/integrations/api/client";
import { formatCOP } from "@/lib/format";
import type { Product } from "@/data/products";
import b1PrinterImage from "@/assets/subproducts/b1-printer.jpg";
import niimbotLogo from "@/assets/niimbot-logo.png";
import certificateImage from "@/assets/certificate/WhatsApp Image 2026-09-02 at 3.21.52 PM.jpeg";

const editorialAltDefaults: Record<string, string> = {
  hero_desktop: "Impresora NIIMBOT para escritorio",
  hero_mobile: "Impresora NIIMBOT móvil",
  hardware_b1: "Impresora NIIMBOT B1",
  hardware_d110: "Impresora NIIMBOT D110",
  hardware_d11h: "Impresora NIIMBOT D11H",
  consumables: "Consumibles NIIMBOT",
  solution_comercio: "Solución NIIMBOT para comercio",
  solution_inventario: "Solución NIIMBOT para inventario",
  solution_organizacion: "Solución NIIMBOT para organización",
  solution_identificacion: "Identificación NIIMBOT",
  trust: "Certificado de distribuidor autorizado NIIMBOT",
};

const solutions = [
  {
    number: "01",
    icon: Package,
    title: "Comercio",
    description: "Identifica productos y pedidos con las etiquetas disponibles en el catálogo.",
  },
  {
    number: "02",
    icon: Printer,
    title: "Inventario",
    description: "Mantén referencias y artículos identificados para organizar tu operación.",
  },
  {
    number: "03",
    icon: Tag,
    title: "Organización",
    description: "Explora rollos y etiquetas de distintos formatos ligados a cada modelo.",
  },
];

const Niimbot = () => {
  const { products, loading, error } = useProductsCatalog();
  const [editorialImages, setEditorialImages] = useState<Record<string, string>>({});
  const [editorialAlts, setEditorialAlts] = useState<Record<string, string>>({});

  useEffect(() => {
    let isMounted = true;

    const loadEditorialImages = async () => {
      const { data, error: fetchError } = await fetchNiimbotPageImages();
      if (!isMounted || fetchError || !Array.isArray(data)) return;

      const resolvedEntries = await Promise.allSettled(
        data.map(async (item) => {
          if (!item?.key) return null;
          const urlResult = await fetchNiimbotPageImageUrl(item.key);
          if (urlResult.error || !urlResult.data?.url) return null;
          return {
            key: item.key,
            url: urlResult.data.url,
            alt: item.alt || editorialAltDefaults[item.key] || "Imagen editorial NIIMBOT",
          };
        }),
      );

      if (!isMounted) return;

      const nextUrls: Record<string, string> = {};
      const nextAlts: Record<string, string> = {};

      resolvedEntries.forEach((result) => {
        if (result.status === "fulfilled" && result.value) {
          nextUrls[result.value.key] = result.value.url;
          nextAlts[result.value.key] = result.value.alt;
        }
      });

      setEditorialImages(nextUrls);
      setEditorialAlts(nextAlts);
    };

    void loadEditorialImages();
    return () => {
      isMounted = false;
    };
  }, []);

  const resolveEditorialImage = (key: string, fallback: string) => editorialImages[key] || fallback;
  const resolveEditorialAlt = (key: string, fallback: string) => editorialAlts[key] || fallback;

  const hardware = products.filter((product) => product.categories?.some((category) => category.slug === "niimbot"));
  const featured = hardware.find((product) => product.id === "niimbot-b1") || hardware[0];
  const consumables = hardware.flatMap((parent) =>
    (parent.variants ?? parent.subproducts ?? []).map((subproduct) => ({ parent, subproduct })),
  );
  const optionCount = hardware.reduce((total, product) => total + (product.variants?.length ?? product.subproducts?.length ?? 0), 0);
  const heroDesktopImage = resolveEditorialImage(
    "hero_desktop",
    featured?.id === "niimbot-b1" ? b1PrinterImage : featured?.image || b1PrinterImage,
  );
  const heroMobileImage = resolveEditorialImage("hero_mobile", heroDesktopImage);
  const heroAlt = resolveEditorialAlt("hero_desktop", "Impresora NIIMBOT Shelby Importaciones");

  const solutionImages = [
    resolveEditorialImage("solution_comercio", featured?.image || b1PrinterImage),
    resolveEditorialImage("solution_inventario", hardware[1]?.image || featured?.image || b1PrinterImage),
    resolveEditorialImage("solution_organizacion", consumables[0]?.subproduct.image || featured?.image || b1PrinterImage),
  ];

  return (
    <div className="min-h-screen bg-[#f7f8f6] text-[#172d2c]">
      <Navbar />
      <main className="pt-[7.25rem]">
        <section className="overflow-hidden border-b border-[#d9e4e2] bg-[#e4f1ef]">
          <div className="container-shelby grid items-center gap-4 py-8 sm:min-h-[39rem] sm:gap-6 sm:py-16 lg:min-h-[42rem] lg:grid-cols-[0.88fr_1.12fr] lg:gap-10 lg:py-20">
            <div className="relative z-10 max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#55706d]">
                Tecnología seleccionada por Shelby
              </p>
              <h1 className="mt-4 font-display text-5xl leading-[0.9] text-[#172d2c] sm:mt-5 sm:text-7xl lg:text-8xl">
                NIIMBOT
                <span className="mt-2 block text-[#55706d]">Imprime. Organiza. Sigue.</span>
              </h1>
              <p className="mt-4 max-w-lg text-sm leading-relaxed text-[#526462] sm:mt-6 sm:text-lg">
                Impresoras de etiquetas y consumibles del catálogo de Shelby Importaciones, reunidos en un solo lugar.
              </p>
              <div className="mt-6 flex flex-wrap gap-3 sm:mt-8">
                <a
                  href="#hardware"
                  className="inline-flex min-h-12 items-center gap-2 bg-[#172d2c] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#294541]"
                >
                  Ver impresoras <ArrowRight className="h-4 w-4" />
                </a>
                <a
                  href="#consumibles"
                  className="inline-flex min-h-12 items-center gap-2 border border-[#9fb8b4] bg-white/75 px-5 py-3 text-sm font-semibold text-[#172d2c] transition-colors hover:bg-white"
                >
                  Ver consumibles <ArrowRight className="h-4 w-4" />
                </a>
              </div>
              <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-[#b9cdca] pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#526462] sm:mt-10 sm:gap-x-8 sm:pt-5 sm:text-xs">
                <span>{loading ? "Catálogo" : `${hardware.length} modelos en catálogo`}</span>
                <span>{loading ? "Opciones" : `${optionCount} opciones y complementos`}</span>
              </div>
            </div>

            <figure className="relative flex min-h-[14rem] items-center justify-center sm:min-h-[25rem] lg:min-h-[34rem]">
              <div className="absolute inset-x-4 top-5 h-px bg-[#b9cdca] sm:inset-x-12" />
              <img
                src={heroMobileImage}
                alt={heroAlt}
                className="relative z-10 block max-h-[14rem] w-full object-contain mix-blend-multiply sm:hidden"
              />
              <img
                src={heroDesktopImage}
                alt={heroAlt}
                className="relative z-10 hidden max-h-[14rem] w-full object-contain mix-blend-multiply sm:block sm:max-h-[27rem] lg:max-h-[34rem]"
              />
              <figcaption className="absolute bottom-0 right-0 z-20 border-l-2 border-[#a1b80a] bg-white/90 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#172d2c] sm:bottom-6 sm:right-2 sm:px-4 sm:py-3 sm:text-xs sm:tracking-[0.16em]">
                Selección NIIMBOT · Shelby
              </figcaption>
            </figure>
          </div>
        </section>

        <nav
          aria-label="Navegación NIIMBOT"
          className="sticky top-[119px] z-30 border-b border-[#d9e4e2] bg-white/95 backdrop-blur min-[398px]:top-[104px] min-[640px]:top-[105px]"
        >
          <div className="container-shelby relative overflow-x-visible sm:overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden after:pointer-events-none after:absolute after:bottom-0 after:right-0 after:top-0 after:w-8 after:bg-gradient-to-l after:from-white after:to-transparent sm:after:hidden">
            <div className="flex w-full min-w-0 items-center gap-6 py-1.5 sm:min-w-max sm:gap-8 sm:py-2 sm:pr-8 lg:min-w-full lg:gap-8 lg:pr-0">
              <img
                src={niimbotLogo}
                alt="NIIMBOT"
                loading="eager"
                className="h-auto w-36 shrink-0 object-contain sm:w-40 lg:w-44"
              />
              <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:min-w-max sm:flex-none sm:overflow-visible sm:gap-1 sm:pr-0 lg:flex-1 lg:justify-between">
                {[
                  ["Impresoras", "hardware"],
                  ["Consumibles", "consumibles"],
                  ["Soluciones", "soluciones"],
                  ["Confianza", "confianza"],
                  ["Soporte", "soporte"],
                ].map(([label, id]) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    className="inline-flex min-h-10 shrink-0 items-center whitespace-nowrap px-3 text-xs font-semibold text-[#526462] transition-colors hover:bg-[#f1f6f4] hover:text-[#172d2c] sm:px-4 sm:text-sm"
                  >
                    {label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </nav>

        <section id="hardware" className="scroll-mt-40 border-b border-[#d9e4e2] bg-white py-10 sm:py-20 lg:py-24">
          <div className="container-shelby">
            <SectionHeading
              eyebrow="Hardware"
              title="Impresoras para cada jornada."
              description="Modelos NIIMBOT disponibles en el catálogo de Shelby, con sus precios, existencias y opciones actuales."
            />

            {loading ? (
              <p className="mt-10 text-sm text-[#526462]">Cargando catálogo...</p>
            ) : error ? (
              <p className="mt-10 text-sm text-red-700">No se pudo cargar el catálogo: {error}</p>
            ) : hardware.length ? (
              <div className="mt-6 grid grid-cols-1 gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
                {hardware.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    resolveEditorialImage={resolveEditorialImage}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-10 text-sm text-[#526462]">No hay impresoras NIIMBOT disponibles en el catálogo.</p>
            )}
          </div>
        </section>

        <section id="consumibles" className="scroll-mt-40 border-b border-[#d9e4e2] bg-[#f1f6f4] py-16 sm:py-20 lg:py-24">
          <div className="container-shelby">
            <SectionHeading
              eyebrow="Etiquetas y complementos"
              title="El formato que necesitas."
              description="Estas opciones aparecen como subproductos de sus impresoras en el catálogo. Entra a la ficha correspondiente para revisar precio, stock y selección."
            />

            {loading ? (
              <p className="mt-10 text-sm text-[#526462]">Cargando opciones...</p>
            ) : consumables.length ? (
              <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {consumables.map(({ parent, subproduct }) => {
                  const consumablesEditorialImage = resolveEditorialImage("consumables", subproduct.image || parent.image || b1PrinterImage);

                  return (
                    <article key={`${parent.id}:${subproduct.id}`} className="flex h-full flex-col border border-[#d9e4e2] border-l-4 border-l-[#9aaa28] bg-white p-4 sm:p-5">
                      <Link to={`/products/${parent.id}`} className="group block overflow-hidden bg-[#f7f8f6]">
                        <img
                          src={consumablesEditorialImage}
                          alt={resolveEditorialAlt("consumables", subproduct.name)}
                          loading="lazy"
                          className="aspect-[4/3] w-full object-contain p-3 transition-transform duration-300 group-hover:scale-[1.02]"
                        />
                      </Link>
                      <div className="flex flex-1 flex-col pt-4">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#6b7f7c]">
                          Para {parent.name}
                        </p>
                        <h3 className="mt-2 font-display text-2xl leading-tight text-[#172d2c]">{subproduct.name}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-[#526462]">{subproduct.description}</p>
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#d9e4e2] pt-4">
                          {subproduct.price !== undefined
                            ? <span className="font-semibold text-[#172d2c]">{formatCOP(subproduct.price)}</span>
                            : <span className="text-xs text-[#8a4242]">Precio pendiente</span>}
                          <span className={`text-xs ${subproduct.active === false || subproduct.stock === 0 ? "text-[#8a4242]" : subproduct.stock === undefined ? "text-[#8a6a2c]" : "text-[#3f6f4d]"}`}>
                            {subproduct.active === false
                              ? "Inactivo"
                              : subproduct.stock === undefined
                                ? "Disponibilidad pendiente"
                                : subproduct.stock > 0
                                  ? `Stock: ${subproduct.stock}`
                                  : "Sin stock"}
                          </span>
                        </div>
                        <Link
                          to={`/products/${parent.id}`}
                          className="mt-auto inline-flex min-h-11 items-center gap-2 pt-4 text-sm font-semibold text-[#172d2c] hover:text-[#55706d]"
                        >
                          Ver opciones en la ficha <ArrowUpRight className="h-4 w-4" />
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="mt-10 border-y border-[#d9e4e2] py-8 text-sm text-[#526462]">
                No hay etiquetas o rollos relacionados disponibles en el catálogo actual.
              </div>
            )}
          </div>
        </section>

        <section id="soluciones" className="scroll-mt-40 border-b border-[#d9e4e2] bg-white py-16 sm:py-20 lg:py-24">
          <div className="container-shelby">
            <SectionHeading
              eyebrow="Usos"
              title="Una etiqueta para cada momento."
              description="Usos cotidianos respaldados por los equipos y consumibles que ofrece Shelby."
            />
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {solutions.map((solution, index) => {
                const Icon = solution.icon;
                const solutionImage = solutionImages[index];
                return (
                  <article key={solution.number} className="group relative min-h-[23rem] overflow-hidden border border-[#d9e4e2] bg-[#e4f1ef] p-6 sm:min-h-[25rem] sm:p-7">
                    {solutionImage && <img src={solutionImage} alt={resolveEditorialAlt(["solution_comercio", "solution_inventario", "solution_organizacion"][index], solution.title)} loading="lazy" className="absolute inset-0 h-full w-full object-contain opacity-20 mix-blend-multiply transition-transform duration-500 group-hover:scale-105" />}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#e4f1ef] via-[#e4f1ef]/85 to-transparent" />
                    <div className="relative z-10 flex h-full flex-col justify-between">
                      <div className="flex items-start justify-between gap-4">
                        <Icon className="h-7 w-7 text-[#55706d]" />
                        <span className="font-display text-4xl leading-none text-[#9aaa28]">{solution.number}</span>
                      </div>
                      <div>
                        <h3 className="font-display text-4xl leading-none text-[#172d2c]">{solution.title}</h3>
                        <p className="mt-3 max-w-xs text-sm leading-relaxed text-[#526462]">{solution.description}</p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="confianza" className="scroll-mt-40 border-b border-[#d9e4e2] bg-[#e4f1ef] py-16 sm:py-20 lg:py-24">
          <div className="container-shelby grid items-center gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#55706d]">Shelby Importaciones × NIIMBOT</p>
              <h2 className="mt-4 max-w-xl font-display text-5xl leading-[0.92] text-[#172d2c] sm:text-6xl">
                Respaldo autorizado para Colombia.
              </h2>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-[#526462]">
                Shelby Importaciones cuenta con autorización para distribuir productos NIIMBOT en Colombia. Consulta el documento disponible y compra desde nuestro catálogo.
              </p>
              <Link
                to="/certificado"
                className="mt-7 inline-flex min-h-12 items-center gap-2 bg-[#172d2c] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#294541]"
              >
                <Download className="h-4 w-4" /> Ver certificado
              </Link>
            </div>
            <Link to="/certificado" className="block max-w-3xl justify-self-center border border-[#d9e4e2] bg-white p-2 shadow-sm">
              <img
                src={resolveEditorialImage("trust", certificateImage)}
                alt={resolveEditorialAlt("trust", "Certificado de distribuidor autorizado NIIMBOT para Shelby Importaciones")}
                loading="lazy"
                className="h-auto max-h-[36rem] w-full object-contain"
              />
            </Link>
          </div>
        </section>

        <section id="soporte" className="scroll-mt-40 bg-[#172d2c] py-16 text-white sm:py-20 lg:py-24">
          <div className="container-shelby grid items-end gap-8 lg:grid-cols-[1fr_auto]">
            <div className="max-w-2xl">
              <Headphones className="h-7 w-7 text-[#d9e67b]" />
              <p className="mt-6 text-xs font-bold uppercase tracking-[0.24em] text-white/60">Atención Shelby</p>
              <h2 className="mt-3 font-display text-5xl leading-[0.92] sm:text-6xl">¿Buscas la impresora adecuada?</h2>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-white/70">
                Consulta con Shelby sobre los modelos, formatos de etiqueta y opciones que aparecen en el catálogo.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link to="/#contacto" className="inline-flex min-h-12 items-center gap-2 bg-white px-5 py-3 text-sm font-semibold text-[#172d2c] transition-colors hover:bg-[#e4f1ef]">
                Contactar a Shelby <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/certificado" className="inline-flex min-h-12 items-center gap-2 border border-white/30 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                <ShieldCheck className="h-4 w-4" /> Distribución autorizada
              </Link>
            </div>
          </div>
        </section>

        <section className="bg-[#dfe9a6] py-12 sm:py-16">
          <div className="container-shelby flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#526462]">NIIMBOT en Shelby</p>
              <h2 className="mt-2 font-display text-4xl leading-none text-[#172d2c] sm:text-5xl">Encuentra la NIIMBOT ideal para ti.</h2>
            </div>
            <a href="#hardware" className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 bg-[#172d2c] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#294541]">
              Ver impresoras <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

const SectionHeading = ({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) => (
  <header className="max-w-2xl">
    <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#6b7f7c]">{eyebrow}</p>
    <h2 className="mt-3 font-display text-4xl leading-[0.95] text-[#172d2c] sm:text-5xl">{title}</h2>
    <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#526462] sm:text-base">{description}</p>
  </header>
);

const ProductCard = ({
  product,
  resolveEditorialImage,
}: {
  product: Product;
  resolveEditorialImage: (key: string, fallback: string) => string;
}) => {
  const slotMap: Record<string, string> = {
    "niimbot-b1": "hardware_b1",
    "niimbot-d110": "hardware_d110",
    d11h: "hardware_d11h",
  };

  const productImage = slotMap[product.id]
    ? resolveEditorialImage(slotMap[product.id], product.image)
    : product.image;

  return (
    <article className="flex h-full flex-col overflow-hidden border border-[#d9e4e2] bg-white">
      <div className="flex flex-1 flex-col 2xl:grid 2xl:grid-cols-[0.85fr_1.15fr]">
        <Link to={`/products/${product.id}`} className="flex min-h-48 items-center justify-center bg-[#f1f6f4] p-4 sm:min-h-72 sm:p-6">
          <img
            src={productImage}
            alt={product.name}
            loading="lazy"
            className="max-h-44 w-full object-contain transition-transform duration-300 hover:scale-[1.02] sm:max-h-64"
          />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#6b7f7c]">NIIMBOT</span>
            {product.badge && <span className="bg-[#edf2cb] px-2 py-1 text-[10px] font-semibold text-[#445016]">{product.badge}</span>}
          </div>
          <Link to={`/products/${product.id}`} className="mt-2 font-display text-3xl leading-none text-[#172d2c] hover:text-[#55706d] sm:mt-3 sm:text-4xl">
            {product.name}
          </Link>
          <p className="mt-2 text-sm leading-relaxed text-[#526462] sm:mt-3">{product.description}</p>

          <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[#d9e4e2] pt-3 sm:mt-5 sm:pt-4">
            {Number.isFinite(product.price) && <span className="font-display text-3xl leading-none text-[#172d2c]">{formatCOP(product.price)}</span>}
            {product.oldPrice !== undefined && <span className="text-sm text-[#6b7f7c] line-through">{formatCOP(product.oldPrice)}</span>}
            {product.stock !== undefined && (
              <span className={`text-xs font-medium ${product.stock > 0 ? "text-[#3f6f4d]" : "text-[#8a4242]"}`}>
                {product.stock > 0 ? `Stock: ${product.stock}` : "Sin stock"}
              </span>
            )}
          </div>

          <Link to={`/products/${product.id}`} className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 bg-[#172d2c] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#294541] sm:py-3">
            Ver producto <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </article>
  );
};

export default Niimbot;