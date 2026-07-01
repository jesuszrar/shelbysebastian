import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { type Product } from "@/data/products";
import { useProductsCatalog } from "@/context/ProductsContext";

export type CartItem = { productId: string; quantity: number };

type CartContextValue = {
  items: CartItem[];
  detailedItems: Array<CartItem & { product: Product }>;
  count: number;
  subtotal: number;
  shipping: number;
  total: number;
  city: string;
  setCity: (c: string) => void;
  add: (productId: string, quantity?: number) => void;
  remove: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | undefined>(undefined);

const CART_KEY = "shelby:cart";
const CITY_KEY = "shelby:city";
const FREE_SHIPPING_THRESHOLD = 260000;
const SHIPPING_BOGOTA = 8000;
const SHIPPING_OTHER = 15000;

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const { products } = useProductsCatalog();
  const [items, setItems] = useState<CartItem[]>([]);
  const [city, setCityState] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) setItems(JSON.parse(raw));
      setCityState(localStorage.getItem(CITY_KEY) || "");
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => { if (hydrated) localStorage.setItem(CART_KEY, JSON.stringify(items)); }, [items, hydrated]);

  const setCity = (c: string) => { setCityState(c); localStorage.setItem(CITY_KEY, c); };

  const add = (productId: string, quantity = 1) =>
    setItems((prev) => {
      const ex = prev.find((i) => i.productId === productId);
      return ex ? prev.map((i) => i.productId === productId ? { ...i, quantity: i.quantity + quantity } : i) : [...prev, { productId, quantity }];
    });
  const remove = (productId: string) => setItems((p) => p.filter((i) => i.productId !== productId));
  const setQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) return remove(productId);
    setItems((p) => p.map((i) => i.productId === productId ? { ...i, quantity } : i));
  };
  const clear = () => setItems([]);

  const value = useMemo<CartContextValue>(() => {
    const detailedItems = items
      .map((i) => { const product = products.find((p) => p.id === i.productId); return product ? { ...i, product } : null; })
      .filter((x): x is CartItem & { product: Product } => x !== null);
    const count = detailedItems.reduce((s, i) => s + i.quantity, 0);
    const subtotal = detailedItems.reduce((s, i) => s + i.product.price * i.quantity, 0);
    const isBogota = city.toLowerCase().includes("bogot");
    const baseShipping = isBogota ? SHIPPING_BOGOTA : SHIPPING_OTHER;
    const shipping = subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : baseShipping;
    const total = subtotal + shipping;
    return { items, detailedItems, count, subtotal, shipping, total, city, setCity, add, remove, setQuantity, clear };
  }, [items, city, products]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
};
