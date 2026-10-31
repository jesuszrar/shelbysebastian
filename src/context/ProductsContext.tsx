import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchData, resolveImageUrl } from "@/integrations/api/client";
import type { CatalogCategory, Product, Subproduct } from "@/data/products";

type ProductRow = {
  id: string;
  name: string;
  category: string;
  price: number;
  oldPrice?: number | null;
  badge?: string | null;
  highlight?: boolean | null;
  image: string | null;
  stock: number | null;
  description: string | null;
  specs: string[] | null;
  activateWholesale?: boolean | null;
  wholesaleMinQty?: number | null;
  wholesaleDiscountPercent?: number | null;
  categories?: CatalogCategory[] | null;
  subproducts?: Subproduct[] | null;
  variants?: Array<{ id: string; name: string; image?: string | null; description?: string | null; price?: number; stock?: number; active?: boolean; images?: Array<{ url?: string }>; sortOrder?: number }> | null;
  images?: Array<{ url?: string }> | null;
};

type ProductsContextValue = {
  products: Product[];
  rows: ProductRow[];
  loading: boolean;
  error: string | null;
  refreshProducts: () => Promise<void>;
};

const ProductsContext = createContext<ProductsContextValue | undefined>(undefined);

const rowToProduct = (row: ProductRow): Product => {
  return {
    id: row.id,
    name: row.name,
    category: (row.category as Product["category"]) || "Adhesivas",
    image: resolveImageUrl(row.image),
    price: row.price,
    oldPrice: row.oldPrice ?? undefined,
    badge: row.badge ?? undefined,
    highlight: row.highlight ?? false,
    stock: row.stock ?? undefined,
    description: row.description ?? "",
    specs: row.specs ?? [],
    activateWholesale: Boolean(row.activateWholesale),
    wholesaleMinQty: Number(row.wholesaleMinQty ?? 0),
    wholesaleDiscountPercent: Number(row.wholesaleDiscountPercent ?? 0),
    categories: row.categories ?? [],
    variants: row.variants?.map((variant) => ({ id: variant.id, name: variant.name, image: resolveImageUrl(variant.image), description: variant.description ?? "", price: variant.price, stock: variant.stock, active: variant.active, sortOrder: variant.sortOrder, images: variant.images?.map((image) => resolveImageUrl(image.url)).filter(Boolean) })),
    subproducts: row.variants?.filter((variant) => variant.active !== false).sort((left, right) => Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0)).map((variant) => ({ id: variant.id, name: variant.name, image: resolveImageUrl(variant.image), description: variant.description ?? "", price: variant.price, stock: variant.stock, active: variant.active, sortOrder: variant.sortOrder, images: variant.images?.map((image) => resolveImageUrl(image.url)).filter(Boolean) })),
    images: Array.isArray(row.images) ? row.images.map((image) => resolveImageUrl(image.url)).filter(Boolean) : undefined,
  };
};

export const ProductsProvider = ({ children }: { children: ReactNode }) => {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProducts = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await fetchData<ProductRow>("products", { orderBy: "created_at", ascending: false });

    if (error) {
      console.error("Error loading products", error);
      setRows([]);
      setError(error.message || "No se pudo cargar el catálogo");
      setLoading(false);
      return;
    }

    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => {
    refreshProducts();
  }, []);

  const products = rows.map(rowToProduct);

  return <ProductsContext.Provider value={{ products, rows, loading, error, refreshProducts }}>{children}</ProductsContext.Provider>;
};

export const useProductsCatalog = () => {
  const ctx = useContext(ProductsContext);
  if (!ctx) throw new Error("useProductsCatalog must be used within ProductsProvider");
  return ctx;
};
