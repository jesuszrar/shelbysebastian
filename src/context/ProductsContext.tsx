import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { products as defaultProducts, type Product } from "@/data/products";

type ProductRow = {
  id: string;
  name: string;
  category: string;
  price: number;
  image: string | null;
  stock: number | null;
  description: string | null;
  specs: string[] | null;
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
  name: row?.name || base.name,
  category: (row?.category as Product["category"]) || base.category,
  image: row?.image || base.image,
  price: typeof row?.price === "number" ? row.price : base.price,
  description: row?.description || base.description,
  specs: row?.specs?.length ? row.specs : base.specs,
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
    oldPrice: undefined,
    badge: undefined,
    highlight: false,
    description: row.description || "",
    specs: row.specs?.length ? row.specs : [],
  };
};

const seedProducts = async () => {
  const rows = defaultProducts.map((product) => ({
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    image: product.image,
    description: product.description,
    specs: product.specs,
    stock: 0,
  }));

  const { error } = await supabase.from("products").upsert(rows, { onConflict: "id" });
  if (error) {
    console.error("Error seeding products", error);
  }
};

export const ProductsProvider = ({ children }: { children: ReactNode }) => {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshProducts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from<ProductRow>("products")
      .select("id,name,category,price,image,stock,description,specs")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading products", error);
      const defaults = defaultProducts.map((product) => ({
        id: product.id,
        name: product.name,
        category: product.category,
        price: product.price,
        image: product.image,
        stock: 0,
        description: product.description,
        specs: product.specs,
      }));
      setRows(defaults);
      setLoading(false);
      return;
    }

    const fetchedRows = (data || []) as ProductRow[];
    if (fetchedRows.length === 0) {
      await seedProducts();
      const { data: seeded } = await supabase
        .from<ProductRow>("products")
        .select("id,name,category,price,image,stock,description,specs")
        .order("created_at", { ascending: false });
      setRows((seeded || []) as ProductRow[]);
    } else {
      setRows(fetchedRows);
    }
    setLoading(false);
  };

  useEffect(() => {
    refreshProducts();
  }, []);

  const mergedProducts = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.id, row] as const));
    const seededProducts = defaultProducts.map((product) => mergeProduct(product, byId.get(product.id)));
    const extraProducts = rows
      .filter((row) => !defaultProducts.some((product) => product.id === row.id))
      .map(rowToProduct);

    return [...seededProducts, ...extraProducts];
  }, [rows]);

  return <ProductsContext.Provider value={{ products: mergedProducts, rows, loading, refreshProducts }}>{children}</ProductsContext.Provider>;
};

export const useProductsCatalog = () => {
  const ctx = useContext(ProductsContext);
  if (!ctx) throw new Error("useProductsCatalog must be used within ProductsProvider");
  return ctx;
};
