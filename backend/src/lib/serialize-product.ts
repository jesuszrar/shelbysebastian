import { wrap } from "./serialize.js";
import { separateProductImageGalleries } from "./product-image-galleries.js";

type ProductSerializationInput = {
  price: unknown;
  categories?: unknown[];
  variants?: unknown[];
  images?: unknown[];
};

export const serializeProduct = <T extends ProductSerializationInput>(product: T): unknown => {
  const categories = (product.categories ?? []).map((item) =>
    item && typeof item === "object" && "category" in item
      ? (item as { category: unknown }).category
      : item,
  );
  const galleries = separateProductImageGalleries(product.variants ?? [], product.images ?? []);
  return wrap({ ...product, price: product.price, categories, variants: galleries.variants, images: galleries.images });
};
