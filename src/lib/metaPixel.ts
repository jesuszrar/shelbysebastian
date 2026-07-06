type PixelParams = Record<string, unknown>;

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export const META_PIXEL_ID = "557138857223954";

export const trackPixelEvent = (eventName: string, params: PixelParams = {}) => {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  window.fbq("track", eventName, params);
};

export const trackPageView = () => trackPixelEvent("PageView");

export const trackViewContent = (params: PixelParams) => trackPixelEvent("ViewContent", params);

export const trackAddToCart = (params: PixelParams) => trackPixelEvent("AddToCart", params);

export const trackInitiateCheckout = (params: PixelParams) => trackPixelEvent("InitiateCheckout", params);

export const trackPurchase = (params: PixelParams) => trackPixelEvent("Purchase", params);