type PixelParams = Record<string, unknown>;

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export const META_PIXEL_ID = "557138857223954";

export const isMetaPixelQueueAvailable = () =>
  typeof window !== "undefined" && typeof window.fbq === "function";

let lastQueuedPageViewPath: string | null = null;

export const trackPixelEvent = (eventName: string, params: PixelParams = {}, eventId?: string) => {
  if (!isMetaPixelQueueAvailable()) {
    console.warn("[meta-pixel] event was not queued because fbq is unavailable", { eventName });
    return false;
  }
  if (eventId) {
    window.fbq!("track", eventName, params, { eventID: eventId });
  } else {
    window.fbq!("track", eventName, params);
  }
  return true;
};

export const trackPageView = (pathname = typeof window === "undefined" ? "" : window.location.pathname) => {
  if (pathname && pathname === lastQueuedPageViewPath) return false;
  const queued = trackPixelEvent("PageView");
  if (queued && pathname) lastQueuedPageViewPath = pathname;
  return queued;
};

export const trackViewContent = (params: PixelParams) => trackPixelEvent("ViewContent", params);

export const trackAddToCart = (params: PixelParams) => trackPixelEvent("AddToCart", params);

export const trackInitiateCheckout = (params: PixelParams) => trackPixelEvent("InitiateCheckout", params);

export const trackPurchase = (params: PixelParams, eventId?: string) => trackPixelEvent("Purchase", params, eventId);