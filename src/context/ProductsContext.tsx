import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchData } from "@/integrations/api/client";
import { products as defaultProducts, type Product, type Subproduct } from "@/data/products";

const CUSTOM_SUBPRODUCTS_KEY = "shelby:custom_subproducts";

const readCustomSubproducts = (): Record<string, Subproduct[]> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CUSTOM_SUBPRODUCTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Subproduct[]>) : {};
  } catch {
    return {};
  }
};

const writeCustomSubproducts = (value: Record<string, Subproduct[]>) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CUSTOM_SUBPRODUCTS_KEY, JSON.stringify(value));
};

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
  subproducts?: Subproduct[] | null;
  variants?: Array<{ id: string; name: string; image?: string | null; description?: string | null; price?: number; stock?: number; active?: boolean; images?: Array<{ url?: string }>; sortOrder?: number }> | null;
  images?: Array<{ url?: string }> | null;
};

type ProductsContextValue = {
  products: Product[];
  rows: ProductRow[];
  loading: boolean;
  refreshProducts: () => Promise<void>;
};

const ProductsContext = createContext<ProductsContextValue | undefined>(undefined);

const mergeProduct = (base: Product, row?: ProductRow): Product => ({
  ...base,
  name: row?.name ?? base.name,
  category: (row?.category as Product["category"]) ?? base.category,
  image: row?.image ?? base.image,
  price: typeof row?.price === "number" ? row.price : base.price,
  oldPrice: row?.oldPrice !== undefined ? row.oldPrice : base.oldPrice,
  badge: row?.badge !== undefined ? row.badge : base.badge,
  highlight: row?.highlight !== undefined ? row.highlight : base.highlight,
  stock: typeof row?.stock === "number" ? row.stock : base.stock,
  description: row?.description ?? base.description,
  specs: row?.specs?.length ? row.specs : base.specs,
  subproducts: Array.isArray(row?.variants) && row!.variants!.length > 0 ? row!.variants!.filter((variant) => variant.active !== false).sort((left, right) => Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0)).map((variant) => ({ id: variant.id, name: variant.name, image: variant.image || base.image, description: variant.description || "", price: variant.price, stock: variant.stock, active: variant.active, sortOrder: variant.sortOrder, images: variant.images?.map((image) => String(image.url ?? "")).filter(Boolean) })) : Array.isArray(row?.subproducts) && row!.subproducts!.length > 0 ? row!.subproducts! : base.subproducts,
  images: Array.isArray(row?.images) ? row!.images!.map((image) => String(image.url ?? "")).filter(Boolean) : base.images,
});

const rowToProduct = (row: ProductRow): Product => {
  const base = defaultProducts.find((product) => product.id === row.id);

  if (base) {
    return mergeProduct(base, row);
  }

  return {
    id: row.id,
    name: row.name,
    category: (row.category as Product["category"]) || "Adhesivas",
    image: row.image || defaultProducts[0]?.image || "",
    price: typeof row.price === "number" ? row.price : 0,
    oldPrice: row.oldPrice ?? undefined,
    badge: row.badge ?? undefined,
    highlight: row.highlight ?? false,
    stock: typeof row.stock === "number" ? row.stock : 0,
    description: row.description || "",
    specs: row.specs?.length ? row.specs : [],
    subproducts: Array.isArray(row.variants) && row.variants.length > 0 ? row.variants.filter((variant) => variant.active !== false).sort((left, right) => Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0)).map((variant) => ({ id: variant.id, name: variant.name, image: variant.image || row.image || "", description: variant.description || "", price: variant.price, stock: variant.stock, active: variant.active, sortOrder: variant.sortOrder, images: variant.images?.map((image) => String(image.url ?? "")).filter(Boolean) })) : Array.isArray(row.subproducts) ? row.subproducts : undefined,
    images: Array.isArray(row.images) ? row.images.map((image) => String(image.url ?? "")).filter(Boolean) : undefined,
  };
};

export const ProductsProvider = ({ children }: { children: ReactNode }) => {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshProducts = async () => {
    setLoading(true);
    const { data, error } = await fetchData<ProductRow>("products", { orderBy: "created_at", ascending: false });

    if (error) {
      console.error("Error loading products", error);
      // Keep the last server snapshot during transient failures; replacing it
      // with local defaults would make real stock appear as zero.
      if (rows.length === 0) setRows([]);
      setLoading(false);
      return;
    }

    const fetchedRows = (data || []) as ProductRow[];
    if (fetchedRows.length === 0) {
      // An empty response is not permission to seed or overwrite inventory.
      // Keep the last snapshot and let the UI use the static catalog only when
      // the database has never returned data in this browser session.
      if (rows.length === 0) setRows([]);
    } else {
      setRows(fetchedRows);
    }
    setLoading(false);
  };

  useEffect(() => {
    refreshProducts();
  }, []);

  const mergedProducts = useMemo(() => {
    const customSubproducts = readCustomSubproducts();
    const byId = new Map(rows.map((row) => [row.id, { ...row, subproducts: row.subproducts ?? customSubproducts[row.id] ?? undefined }] as const));
    const seededProducts = defaultProducts.map((product) => mergeProduct(product, byId.get(product.id)));
    const extraProducts = rows
      .filter((row) => !defaultProducts.some((product) => product.id === row.id))
      .map((row) => rowToProduct({ ...row, subproducts: row.subproducts ?? customSubproducts[row.id] ?? undefined }));

    return [...seededProducts, ...extraProducts];
  }, [rows]);

  return <ProductsContext.Provider value={{ products: mergedProducts, rows, loading, refreshProducts }}>{children}</ProductsContext.Provider>;
};

export const useProductsCatalog = () => {
  const ctx = useContext(ProductsContext);
  if (!ctx) throw new Error("useProductsCatalog must be used within ProductsProvider");
  return ctx;
};
