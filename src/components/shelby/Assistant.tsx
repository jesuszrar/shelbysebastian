import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bot, Printer, Send, X } from "lucide-react";
import { useProductsCatalog } from "@/context/ProductsContext";
import type { Product } from "@/data/products";
import { formatCOP } from "@/lib/format";
import { SHELBY_WHATSAPP_URL } from "@/lib/contact";

type AssistantAction = {
  label: string;
  kind: "product" | "niimbot" | "consumables" | "support";
  productId?: string;
  href?: string;
};

type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  actions?: AssistantAction[];
};

type AssistantResponse = {
  text: string;
  actions?: AssistantAction[];
};

const normalizeText = (value: string) => value
  .toLocaleLowerCase("es-CO")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const productMatches = (product: Product, text: string) => {
  const normalizedName = normalizeText(product.name);
  const normalizedId = normalizeText(product.id);
  const aliases = [normalizedName, normalizedId, ...product.name.split(/\s+/).map(normalizeText)];
  return aliases.some((alias) => alias && text.includes(alias));
};

const getProductAvailability = (product: Product) => {
  const variantStock = product.subproducts?.filter((variant) => variant.active !== false && (variant.stock ?? 0) > 0);
  if (variantStock?.length) return `${variantStock.length} opción${variantStock.length === 1 ? "" : "es"} con stock disponible`;
  if (Number(product.stock) > 0) return `Stock disponible: ${product.stock} unidades`;
  if (product.subproducts?.some((variant) => variant.active !== false)) return "Tiene opciones, pero no se reporta disponibilidad para todas";
  return "No se reporta stock disponible en este momento";
};

const getAssistantResponse = (message: string, products: Product[]): AssistantResponse => {
  const text = normalizeText(message);
  const requestedProduct = products.find((product) => productMatches(product, text));
  const niimbotProducts = products.filter((product) =>
    ["niimbot-b1", "niimbot-d110", "d11h"].some((id) => product.id === id),
  );
  const consumables = products.flatMap((product) =>
    (product.subproducts || []).filter((variant) => variant.active !== false).map((variant) => ({ product, variant })),
  );
  const productLines = (items: Product[]) => items.slice(0, 3).map((product) =>
    `${product.name}: ${formatCOP(product.price)} · ${getProductAvailability(product)}`,
  ).join("\n");
  const productActions = (items: Product[]) => items.slice(0, 3).map((product) => ({
    label: "Ver producto",
    kind: "product" as const,
    productId: product.id,
  }));

  if (/\b(support|soporte|contacto|hablar|telefono|llamar|whatsapp|atencion)\b/.test(text)) {
    return {
      text: "Claro. Puedes comunicarte con el equipo de Shelby mediante nuestros canales de contacto disponibles. También puedes abrir WhatsApp para conversar con nuestra atención al cliente.",
      actions: [{ label: "Hablar con Shelby", kind: "support", href: SHELBY_WHATSAPP_URL }],
    };
  }

  if (/\b(comparar|diferencia|mejor|cuál es mejor|cual es mejor|vs\.?|contra)\b/.test(text)) {
    const comparisonProducts = niimbotProducts.length ? niimbotProducts : products.slice(0, 3);
    if (comparisonProducts.length >= 2) {
      const [first, second] = comparisonProducts;
      const comparison = [first, second].map((product) =>
        `${product.name}: ${formatCOP(product.price)} · ${product.description || "Sin descripción disponible"}`,
      ).join("\n");
      return {
        text: `Aquí tienes una comparación basada en los datos disponibles:\n${comparison}\n\n${first.description || ""}\n${second.description || ""}`,
        actions: productActions([first, second]),
      };
    }
  }

  if (/\b(recomiend|recomend|necesito|quiero|busco|buscar|para mi|para mi negocio|para productos|para etiquetas)\b/.test(text)) {
    const labelIntent = /\b(etiqueta|etiquetas|rollo|consumible|producto)\b/.test(text);
    const b1 = products.find((product) => product.id === "niimbot-b1");
    const d110 = products.find((product) => product.id === "niimbot-d110");
    const d11h = products.find((product) => product.id === "d11h");

    if (labelIntent && b1) {
      const b1Consumables = b1.subproducts?.filter((variant) => variant.active !== false).map((variant) => variant.name) || [];
      return {
        text: `Claro 😊 Podemos revisar las opciones NIIMBOT disponibles. La B1 está pensada para impresión de etiquetas y actualmente tengo sus datos y consumibles asociados.\n\n${b1Consumables.length ? `Consumibles disponibles: ${b1Consumables.join(", ")}.` : "No hay consumibles asociados reportados para esta opción."}`,
        actions: [{ label: "Ver producto", kind: "product", productId: b1.id }, { label: "Ver consumibles", kind: "consumables" }],
      };
    }

    const recommendationCandidates = [b1, d110, d11h].filter(Boolean) as Product[];
    if (recommendationCandidates.length) {
      const recommended = recommendationCandidates[0];
      return {
        text: `${recommended.name} es una opción disponible para revisar según tu necesidad. ${recommended.description || ""}\n\nPrecio actual: ${formatCOP(recommended.price)}. ${getProductAvailability(recommended)}.`,
        actions: [{ label: "Ver producto", kind: "product", productId: recommended.id }],
      };
    }
  }

  if (/\b(niimbot|b1|d110|d11h|etiquetadora|impresora)\b/.test(text)) {
    if (!niimbotProducts.length) {
      return { text: "No tengo información suficiente sobre los modelos NIIMBOT disponibles en este momento." };
    }
    const matches = niimbotProducts.filter((product) => productMatches(product, text));
    const target = matches[0] || niimbotProducts[0];
    return {
      text: `${target.name} es una opción disponible en Shelby. ${target.description || ""}\n\nPrecio actual: ${formatCOP(target.price)}. ${getProductAvailability(target)}.`,
      actions: [{ label: "Ver producto", kind: "product", productId: target.id }, { label: "Ver NIIMBOT", kind: "niimbot" }],
    };
  }

  if (/\b(precio|cuanto|cuesta|valor|costo|descuento|precio anterior|oferta|promocion)\b/.test(text)) {
    if (requestedProduct) {
      const oldPrice = requestedProduct.oldPrice ? ` Precio anterior: ${formatCOP(requestedProduct.oldPrice)}.` : "";
      const discount = requestedProduct.oldPrice && requestedProduct.price > 0
        ? ` Descuento indicado: ${Math.round(((requestedProduct.oldPrice - requestedProduct.price) / requestedProduct.oldPrice) * 100)}%.`
        : "";
      return {
        text: `${requestedProduct.name} tiene un precio actual de ${formatCOP(requestedProduct.price)}.${oldPrice}${discount}`,
        actions: [{ label: "Ver producto", kind: "product", productId: requestedProduct.id }],
      };
    }
    return { text: "Puedo consultar el precio de un producto concreto. Indícame el nombre, por ejemplo: B1, D110 o D11H." };
  }

  if (/\b(stock|disponible|disponibilidad|queda|sin stock|agotado|cantidad)\b/.test(text)) {
    if (requestedProduct) {
      return {
        text: `${requestedProduct.name}: ${getProductAvailability(requestedProduct)}.`,
        actions: [{ label: "Ver producto", kind: "product", productId: requestedProduct.id }],
      };
    }
    const available = products.filter((product) => Number(product.stock) > 0 || product.subproducts?.some((variant) => variant.active !== false && (variant.stock ?? 0) > 0));
    return {
      text: available.length
        ? `Tenemos ${available.length} producto${available.length === 1 ? "" : "s"} con disponibilidad reportada.\n\n${productLines(available)}`
        : "No se reporta stock disponible para los productos actuales. Puedes consultar con nuestro equipo de soporte para confirmar disponibilidad.",
      actions: available.slice(0, 3).map((product) => ({ label: "Ver producto", kind: "product" as const, productId: product.id })),
    };
  }

  if (/\b(etiqueta|etiquetas|consumible|consumibles|rollo|insumo|accesorio|kit)\b/.test(text)) {
    const matchingConsumables = consumables.filter(({ product }) => productMatches(product, text) || productMatches(product, text.replace(/consumible|etiqueta|etiquetas|rollo|insumo|accesorio|kit/g, "")));
    const availableConsumables = matchingConsumables.length ? matchingConsumables : consumables.slice(0, 6);
    if (availableConsumables.length) {
      return {
        text: `En el catálogo encontramos ${availableConsumables.length} consumible${availableConsumables.length === 1 ? "" : "s"} relacionado${availableConsumables.length === 1 ? "" : "s"}:\n${availableConsumables.map(({ product, variant }) => `• ${variant.name} · ${product.name}`).join("\n")}`,
        actions: [{ label: "Ver consumibles", kind: "consumables" }, ...productActions(availableConsumables.slice(0, 2).map(({ product }) => product))],
      };
    }
    return { text: "No tengo consumibles asociados a esa búsqueda en el catálogo actual." };
  }

  if (/\b(producto|productos|catalogo|comprar|compra|precio|disponibilidad|niimbot|consumible|soporte)\b/.test(text)) {
    const catalogProducts = products.slice(0, 4);
    return {
      text: `Puedo ayudarte con el catálogo actual. Aquí tienes algunas opciones:\n${productLines(catalogProducts)}`,
      actions: productActions(catalogProducts),
    };
  }

  return {
    text: "No tengo información suficiente para responder eso todavía. Puedo ayudarte con nuestros productos, precios, disponibilidad, NIIMBOT, consumibles o soporte.",
  };
};

const CHECKOUT_PATHS = ["/cart", "/checkout", "/payment-processing", "/order-success"];

export const Assistant = () => {
  const { pathname } = useLocation();
  const { products, loading, error } = useProductsCatalog();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const responseTimerRef = useRef<number | undefined>(undefined);
  const isCheckoutFlow = CHECKOUT_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}?`));

  const initialMessage = useMemo<AssistantMessage>(() => ({
    id: "welcome",
    role: "assistant",
    text: "¡Hola! 👋 Soy el asistente de Shelby Importaciones.\n\nPuedo ayudarte a encontrar productos, consultar precios y disponibilidad, conocer nuestras impresoras NIIMBOT, encontrar consumibles o resolver dudas sobre tu compra.\n\n¿Qué estás buscando?",
  }), []);

  useEffect(() => {
    if (isOpen && messages.length === 0) setMessages([initialMessage]);
  }, [initialMessage, isOpen, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, isThinking]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => () => {
    if (responseTimerRef.current) window.clearTimeout(responseTimerRef.current);
  }, []);

  const sendMessage = (message: string) => {
    const cleanMessage = message.trim();
    if (!cleanMessage || isThinking || loading || error) return;

    const userMessage: AssistantMessage = { id: `user-${Date.now()}`, role: "user", text: cleanMessage };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setIsThinking(true);

    responseTimerRef.current = window.setTimeout(() => {
      const response = getAssistantResponse(cleanMessage, products);
      setMessages((current) => [...current, {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        text: response.text,
        actions: response.actions,
      }]);
      setIsThinking(false);
    }, 300);
  };

  const openAssistant = () => {
    if (messages.length === 0) setMessages([initialMessage]);
    setIsOpen(true);
  };

  const actionLink = (action: AssistantAction) => {
    if (action.kind === "product" && action.productId) {
      return <Link to={`/products/${action.productId}`} onClick={() => setIsOpen(false)} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-secondary">{action.label}</Link>;
    }
    if (action.kind === "niimbot") {
      return <Link to="/niimbot" onClick={() => setIsOpen(false)} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-secondary">{action.label}</Link>;
    }
    if (action.kind === "consumables") {
      return <Link to="/niimbot#consumibles" onClick={() => setIsOpen(false)} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-secondary">{action.label}</Link>;
    }
    return <a href={action.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-secondary">{action.label}</a>;
  };

  if (isCheckoutFlow) return null;

  return (
    <>
      {isOpen && (
        <section role="dialog" aria-modal="false" aria-label="Asistente Shelby" className="fixed bottom-[5.5rem] right-3 z-50 flex h-[min(78vh,560px)] w-[calc(100vw-1.5rem)] max-w-[390px] flex-col overflow-hidden rounded-[1.5rem] border border-primary/10 bg-white shadow-[0_24px_70px_rgba(25,55,65,0.24)] sm:bottom-6 sm:right-6 sm:h-[560px] sm:w-[390px]">
          <header className="relative overflow-hidden bg-primary px-5 py-4 text-white">
            <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-secondary/30 blur-2xl" />
            <div className="relative flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20"><Bot className="h-5 w-5" /></span>
                <div>
                  <h2 className="font-display text-xl tracking-wide">Asistente Shelby</h2>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/75"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Estoy aquí para ayudarte</div>
                </div>
              </div>
              <button type="button" onClick={() => setIsOpen(false)} aria-label="Cerrar asistente" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-smooth hover:bg-white/20"><X className="h-4 w-4" /></button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col bg-[#f7faf9]">
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5" aria-live="polite">
              {messages.map((message) => (
                <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${message.role === "user" ? "rounded-br-sm bg-primary text-white" : "rounded-bl-sm border border-border bg-white text-foreground"}`}>
                    <p className="whitespace-pre-line">{message.text}</p>
                    {message.actions && message.actions.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">{message.actions.map((action, index) => <span key={`${action.label}-${index}`}>{actionLink(action)}</span>)}</div>
                    )}
                  </div>
                </div>
              ))}
              {isThinking && <div className="flex justify-start"><div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm"><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:150ms]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:300ms]" /></div></div>}
              <div ref={messagesEndRef} />
            </div>

            <div className="border-t border-border bg-white p-3">
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label="Respuestas rápidas">
                {[
                  { label: "🛍️ Ver productos", intent: "Ver productos" },
                  { label: "🖨️ NIIMBOT", intent: "NIIMBOT" },
                  { label: "🏷️ Consumibles", intent: "Consumibles" },
                  { label: "📦 Disponibilidad", intent: "Disponibilidad" },
                  { label: "💬 Soporte", intent: "Soporte" },
                ].map((quick) => <button key={quick.label} type="button" onClick={() => sendMessage(quick.intent)} disabled={isThinking || loading || Boolean(error)} className="shrink-0 rounded-full border border-primary/15 bg-primary/5 px-3 py-1.5 text-[11px] font-semibold text-primary transition-smooth hover:bg-primary hover:text-white disabled:opacity-50">{quick.label}</button>)}
              </div>
              <form onSubmit={(event) => { event.preventDefault(); sendMessage(draft); }} className="flex items-end gap-2 rounded-xl border border-border bg-muted/30 p-2 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(draft); } }} rows={1} placeholder="Escribe tu pregunta..." aria-label="Mensaje para el asistente" className="max-h-24 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/70" />
                <button type="submit" disabled={!draft.trim() || isThinking || loading || Boolean(error)} aria-label="Enviar mensaje" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white transition-smooth hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-4 w-4" /></button>
              </form>
            </div>
          </div>
        </section>
      )}

      <button type="button" onClick={openAssistant} aria-label="Abrir asistente Shelby" className="fixed bottom-5 right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white shadow-elegant transition-smooth hover:-translate-y-0.5 hover:bg-secondary sm:bottom-6 sm:right-6 sm:px-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15"><Bot className="h-4 w-4" /></span>
        <span>🤖 Asistente Shelby</span>
        <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" />
      </button>
    </>
  );
};
