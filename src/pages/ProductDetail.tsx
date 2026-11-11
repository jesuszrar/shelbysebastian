import { useEffect, useMemo, useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { Button } from "@/components/ui/button";
import { formatCOP } from "@/lib/format";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";
import { ShoppingCart, Check, Star, Minus, Plus, ArrowLeft, ChevronLeft, ChevronRight, MessageCircle, ShieldCheck, Truck, Sparkles, X } from "lucide-react";
import { useProductsCatalog } from "@/context/ProductsContext";
import { trackAddToCart, trackViewContent } from "@/lib/metaPixel";
import { SHELBY_WHATSAPP_URL } from "@/lib/contact";
import { getProductImageGallery } from "@/lib/product-image-gallery";

type PersistedGallerySelection = {
  variantId: string | null;
  image: string | null;
};

const gallerySelectionStorageKey = (productId: string) =>
  `shelby:product-gallery:${encodeURIComponent(productId)}`;

const readGallerySelection = (productId: string): PersistedGallerySelection | null => {
  try {
    const stored = window.sessionStorage.getItem(gallerySelectionStorageKey(productId));
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const selection = parsed as Record<string, unknown>;
    if (
      (selection.variantId !== null && typeof selection.variantId !== "string") ||
      (selection.image !== null && typeof selection.image !== "string")
    ) return null;
    return { variantId: selection.variantId, image: selection.image } as PersistedGallerySelection;
  } catch (error) {
    console.warn("No se pudo recuperar la selección de galería", error);
    return null;
  }
};

const writeGallerySelection = (productId: string, selection: PersistedGallerySelection) => {
  try {
    window.sessionStorage.setItem(gallerySelectionStorageKey(productId), JSON.stringify(selection));
  } catch (error) {
    console.warn("No se pudo guardar la selección de galería", error);
  }
};

const ProductDetail = () => {
  const { productId } = useParams();
  const { products: liveProducts, loading, error } = useProductsCatalog();
  const product = liveProducts.find((item) => item.id === (productId || ""));
  const { add } = useCart();
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>();
  const [selectionReadyProductId, setSelectionReadyProductId] = useState<string | null>(null);
  const [variantPreview, setVariantPreview] = useState<{ name: string; image: string } | null>(null);

  const selectedVariant = product?.subproducts?.find((variant) => variant.id === selectedVariantId);
  const variantDataIncomplete = Boolean(selectedVariant && (selectedVariant.price === undefined || selectedVariant.stock === undefined));
  const stock = Math.max(0, Number(selectedVariant?.stock ?? product?.stock ?? 0));
  const displayPrice = Number(selectedVariant?.price ?? product?.price ?? 0);
  const maxQty = Math.max(1, stock || 1);
  const related = useMemo(
    () => product ? liveProducts.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 3) : [],
    [liveProducts, product],
  );

  useEffect(() => {
    if (!product) return;
    if (selectionReadyProductId !== product.id) {
      const savedSelection = readGallerySelection(product.id);
      const savedVariantExists = Boolean(
        savedSelection?.variantId && product.subproducts?.some((variant) => variant.id === savedSelection.variantId),
      );
      const restoredVariantId = savedVariantExists ? savedSelection?.variantId ?? undefined : undefined;
      const gallery = getProductImageGallery(product);
      const restoredImage = savedSelection?.image && gallery.includes(savedSelection.image)
        ? savedSelection.image
        : gallery[0] ?? null;
      setActiveImage(restoredImage);
      setSelectedVariantId(restoredVariantId);
      setVariantPreview(null);
      writeGallerySelection(product.id, { variantId: restoredVariantId ?? null, image: restoredImage });
      setSelectionReadyProductId(product.id);
      return;
    }

    const variantStillExists = Boolean(
      selectedVariantId && product.subproducts?.some((variant) => variant.id === selectedVariantId),
    );
    const validVariantId = variantStillExists ? selectedVariantId : undefined;
    const gallery = getProductImageGallery(product);
    const validImage = activeImage && gallery.includes(activeImage) ? activeImage : gallery[0] ?? null;
    if (selectedVariantId !== validVariantId) setSelectedVariantId(validVariantId);
    if (activeImage !== validImage) setActiveImage(validImage);
    writeGallerySelection(product.id, { variantId: validVariantId ?? null, image: validImage });
  }, [product, selectedVariantId, activeImage, selectionReadyProductId]);

  useEffect(() => {
    if (!product) return;
    trackViewContent({
      content_ids: [product.id],
      content_name: product.name,
      content_type: "product",
      currency: "COP",
      value: product.price,
    });
  }, [product]);

  if (loading) return <div className="min-h-screen px-6 py-32 text-sm text-muted-foreground">Cargando producto...</div>;
  if (error) return <div className="min-h-screen px-6 py-32 text-sm text-destructive">No se pudo cargar el catálogo: {error}</div>;
  if (!product) return <Navigate to="/products" replace />;

  const handleAdd = async () => {
    if (stock <= 0) return;
    setAdding(true);
    add(product.id, Math.min(qty, maxQty), selectedVariantId);
    trackAddToCart({
      content_ids: [product.id],
      content_name: product.name,
      content_type: "product",
      currency: "COP",
      value: displayPrice * qty,
      contents: [{ id: selectedVariantId || product.id, quantity: qty, item_price: displayPrice }],
    });
    await new Promise((r) => setTimeout(r, 300));
    toast.success("Añadido al carrito", { description: `${qty} × ${product.name}` });
    setAdding(false);
  };

  const waMsg = encodeURIComponent(`Hola Shelby, me interesa la ${product.name} (${formatCOP(product.price)}). ¿Tienen disponible?`);
  const gallery = getProductImageGallery(product);
  const displayedImage = activeImage && gallery.includes(activeImage)
    ? activeImage
    : gallery[0] ?? "/placeholder.svg";
  const displayedImageIndex = gallery.indexOf(displayedImage);
  const galleryLabel = product.name;
  const moveGallery = (direction: -1 | 1) => {
    if (gallery.length <= 1) return;
    const nextIndex = (displayedImageIndex + direction + gallery.length) % gallery.length;
    setActiveImage(gallery[nextIndex]);
  };

  return (
    <div className="min-h-screen bg-[#f5f8f8]">
      <Navbar />
      <main className="pb-20 pt-32">
        <div className="container-shelby">
          <Link to="/products" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-smooth hover:text-primary">
            <ArrowLeft className="h-4 w-4" /> Volver al catálogo
          </Link>

          <div className="grid gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:gap-14">
            <div className="space-y-4">
              <div className="relative overflow-hidden rounded-[2rem] border border-border bg-white p-3 shadow-elegant">
                {product.badge && (
                  <span className="absolute left-6 top-6 z-10 rounded-full bg-brand-red px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white shadow-soft">
                    {product.badge}
                  </span>
                )}
                <div className="aspect-[4/3] overflow-hidden rounded-[1.4rem] bg-muted">
                  <img src={displayedImage} alt={product.name} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = "/placeholder.svg"; }} className="h-full w-full object-contain" />
                </div>
                <button
                  type="button"
                  aria-label={`Imagen anterior de ${galleryLabel}`}
                  onClick={() => moveGallery(-1)}
                  disabled={gallery.length <= 1}
                  className="absolute left-5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-white/90 text-primary shadow-soft transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Imagen siguiente de ${galleryLabel}`}
                  onClick={() => moveGallery(1)}
                  disabled={gallery.length <= 1}
                  className="absolute right-5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-white/90 text-primary shadow-soft transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              {gallery.length > 0 && <div className={product.subproducts?.length ? "grid grid-cols-3 gap-3" : "grid grid-cols-4 gap-3"} aria-label="Imágenes del producto">
                {gallery.map((img, index) => (
                  <button
                    key={`${img}-${index}`}
                    type="button"
                    onClick={() => setActiveImage(img)}
                    aria-label={`Ver imagen ${index + 1} de ${galleryLabel}`}
                    aria-pressed={displayedImage === img}
                    className={`overflow-hidden rounded-2xl border p-1.5 transition-smooth ${product.subproducts?.length ? "aspect-[4/3]" : ""} ${activeImage === img ? "border-primary bg-primary/5 shadow-soft" : "border-border bg-white hover:border-primary/40"}`}
                  >
                    <img src={img} alt="" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = "/placeholder.svg"; }} className={product.subproducts?.length ? "h-full w-full rounded-xl object-contain" : "h-20 w-full rounded-xl object-contain"} />
                  </button>
                ))}
              </div>}
            </div>

            <div className="flex flex-col justify-center">
              <div className="mb-4 inline-flex w-fit items-center rounded-full border border-primary/15 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-primary">
                {product.category}
              </div>

              <h1 className="font-display text-5xl leading-[0.92] text-primary sm:text-6xl">{product.name}</h1>

              <div className="mt-5 flex items-center gap-2 text-primary">
                {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="h-4 w-4 fill-current" />)}
                <span className="ml-1 text-sm text-muted-foreground">4.9 · 120 reseñas</span>
              </div>

              <div className="mt-6 flex items-end gap-3">
                <span className="font-display text-[3rem] leading-none text-primary">{formatCOP(displayPrice)}</span>
                {product.oldPrice && <span className="pb-1 text-lg text-muted-foreground line-through">{formatCOP(product.oldPrice)}</span>}
              </div>

              {product.activateWholesale && product.wholesaleMinQty && product.wholesaleDiscountPercent ? (
                <div className="mt-4 inline-flex w-fit items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800">
                  Precio por mayor: {product.wholesaleDiscountPercent}% off desde {product.wholesaleMinQty} unidades
                </div>
              ) : null}

              <div className={`mt-5 inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${variantDataIncomplete ? "border-amber-200 bg-amber-50 text-amber-800" : stock > 0 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-600"}`}>
                {variantDataIncomplete ? "Precio y stock pendientes de configurar" : stock > 0 ? `Stock disponible: ${stock}` : "Sin stock disponible"}
              </div>

              <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">{product.description}</p>

              {product.subproducts && product.subproducts.length > 0 && (
                <section className="mt-8" aria-labelledby="subproducts-title">
                  <div className="mb-4">
                    <span className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">Complementos compatibles</span>
                    <h2 id="subproducts-title" className="mt-2 font-display text-3xl text-primary">Subproductos</h2>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button type="button" onClick={() => { setSelectedVariantId(undefined); setActiveImage(getProductImageGallery(product)[0] ?? null); }} className={`rounded-2xl border p-3 text-left ${!selectedVariantId ? "border-primary bg-primary/5" : "border-border bg-white"}`}>
                      <span className="font-medium text-primary">Producto principal</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{formatCOP(product.price)}</span>
                    </button>
                    {product.subproducts.map((subproduct) => {
                      const incomplete = subproduct.price === undefined || subproduct.stock === undefined;
                      const unavailable = subproduct.active === false || incomplete || subproduct.stock === 0;
                      return <button type="button" key={subproduct.id} onClick={() => {
                        if (!unavailable) {
                          setSelectedVariantId(subproduct.id);
                          setVariantPreview({ name: subproduct.name, image: subproduct.image?.trim() || getProductImageGallery(product, subproduct.id)[0] || "/placeholder.svg" });
                        }
                      }} className={`flex gap-3 rounded-2xl border p-3 text-left shadow-soft ${selectedVariantId === subproduct.id ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border bg-white hover:border-primary/50"} ${unavailable ? "cursor-not-allowed opacity-60" : ""}`} disabled={unavailable}>
                        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-muted">
                          <img src={(subproduct.image?.trim() ? subproduct.image : getProductImageGallery(product, subproduct.id)[0]) || "/placeholder.svg"} alt={subproduct.name} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = "/placeholder.svg"; }} className="h-full w-full object-cover" loading="lazy" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-medium leading-tight text-primary">{subproduct.name}</h3>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{subproduct.description}</p>
                          {subproduct.price !== undefined ? <p className="mt-1 text-sm font-semibold text-primary">{formatCOP(subproduct.price)}</p> : <p className="mt-1 text-xs font-medium text-amber-700">Precio pendiente de configurar</p>}
                          {subproduct.stock !== undefined ? <p className="mt-1 text-xs text-muted-foreground">{subproduct.stock > 0 ? `Stock disponible: ${subproduct.stock}` : "Sin stock"}</p> : <p className="mt-1 text-xs font-medium text-amber-700">Stock pendiente de configurar</p>}
                        </div>
                      </button>;
                    })}
                  </div>
                </section>
              )}

              <div className="mt-8 flex items-center gap-4">
                <span className="text-sm font-medium text-primary">Cantidad:</span>
                <div className="flex items-center overflow-hidden rounded-2xl border border-border bg-white shadow-soft">
                  <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex h-12 w-12 items-center justify-center transition-smooth hover:bg-muted" disabled={stock <= 0}>
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-12 text-center text-base font-semibold text-primary">{qty}</span>
                  <button type="button" onClick={() => setQty((q) => Math.min(maxQty, q + 1))} className="flex h-12 w-12 items-center justify-center transition-smooth hover:bg-muted" disabled={stock <= 0 || qty >= maxQty}>
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <Button onClick={handleAdd} disabled={adding || stock <= 0} size="lg" className="h-14 min-w-[220px] flex-1 bg-primary text-primary-foreground shadow-soft hover:bg-primary/90 disabled:opacity-50">
                  {adding ? "Añadiendo..." : stock > 0 ? <><ShoppingCart className="h-5 w-5" /> Añadir al carrito</> : "Sin stock"}
                </Button>
                <Button asChild size="lg" variant="outline" className="h-14 border-[#25D366] text-[#25D366] hover:bg-[#25D366] hover:text-white">
                  <a href={`${SHELBY_WHATSAPP_URL}?text=${waMsg}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
                    <MessageCircle className="h-5 w-5" /> Pedir por WhatsApp
                  </a>
                </Button>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-border bg-white p-4 shadow-soft">
                  <Truck className="h-5 w-5 text-primary" />
                  <p className="mt-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">Envío</p>
                  <p className="mt-2 text-sm font-medium text-primary">Gratis desde $460.000</p>
                </div>
                <div className="rounded-2xl border border-border bg-white p-4 shadow-soft">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  <p className="mt-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">Garantía</p>
                  <p className="mt-2 text-sm font-medium text-primary">30 días</p>
                </div>
                <div className="rounded-2xl border border-border bg-white p-4 shadow-soft">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <p className="mt-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">Entrega</p>
                  <p className="mt-2 text-sm font-medium text-primary">24 horas hábiles</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-16 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-[2rem] border border-border bg-white p-8 shadow-soft">
              <span className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Detalles</span>
              <h2 className="mt-3 font-display text-4xl text-primary">Información del producto</h2>
              <ul className="mt-6 space-y-4">
                {product.specs.map((s) => (
                  <li key={s} className="flex items-start gap-3 rounded-2xl bg-[#f5f8f8] p-4 text-sm text-primary">
                    <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-[2rem] border border-border bg-primary p-8 text-white shadow-elegant">
              <span className="text-xs font-semibold uppercase tracking-[0.28em] text-white/80">Asesoría rápida</span>
              <h2 className="mt-3 font-display text-4xl text-white">¿Dudas sobre este producto?</h2>
              <p className="mt-4 text-sm leading-relaxed text-white/80">
                Te asesoramos para elegir la mejor opción según tu operación, tipo de venta y volumen de impresión.
              </p>
              <Button asChild size="lg" className="mt-6 bg-white text-primary hover:bg-white/90">
                <a href={`${SHELBY_WHATSAPP_URL}?text=${encodeURIComponent(`Hola Shelby, quiero asesoría sobre ${product.name}`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
                  <MessageCircle className="h-5 w-5" /> Consultar por WhatsApp
                </a>
              </Button>
            </section>
          </div>

          {related.length > 0 && (
            <section className="mt-20">
              <div className="mb-8 flex items-end justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Relacionados</span>
                  <h2 className="mt-3 font-display text-4xl text-primary">También te puede interesar</h2>
                </div>
              </div>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((r) => (
                  <Link key={r.id} to={`/products/${r.id}`} className="group overflow-hidden rounded-[1.8rem] border border-border bg-white shadow-soft transition-smooth hover:-translate-y-1 hover:shadow-elegant">
                    <div className="aspect-[4/3] overflow-hidden bg-muted">
                      <img src={r.image} alt={r.name} className="h-full w-full object-cover transition-smooth duration-500 group-hover:scale-[1.04]" />
                    </div>
                    <div className="p-5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">{r.category}</p>
                      <h3 className="mt-2 font-display text-[1.8rem] leading-none text-primary">{r.name}</h3>
                      <span className="mt-3 block font-display text-[2rem] text-primary">{formatCOP(r.price)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      {variantPreview && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label={variantPreview.name} onClick={() => setVariantPreview(null)}>
          <div className="relative max-h-[90vh] w-full max-w-4xl rounded-3xl bg-white p-3 shadow-2xl sm:p-5" onClick={(event) => event.stopPropagation()}>
            <button type="button" aria-label="Cerrar imagen" onClick={() => setVariantPreview(null)} className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white text-primary shadow-lg"><X className="h-5 w-5" /></button>
            <div className="flex max-h-[82vh] items-center justify-center overflow-hidden rounded-2xl bg-[#f5f8f8]">
              <img src={variantPreview.image} alt={variantPreview.name} className="max-h-[78vh] w-full object-contain" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = "/placeholder.svg"; }} />
            </div>
            <p className="px-2 pt-3 text-center font-medium text-primary">{variantPreview.name}</p>
          </div>
        </div>
      )}
      </main>
      <Footer />\n    </div>
  );
};

export default ProductDetail;
