import { wrap } from "./serialize.js";
import { separateProductImageGalleries } from "./product-image-galleries.js";
export const serializeProduct = (product) => {
    const categories = (product.categories ?? []).map((item) => item && typeof item === "object" && "category" in item
        ? item.category
        : item);
    const galleries = separateProductImageGalleries(product.variants ?? [], product.images ?? []);
    return wrap({ ...product, price: product.price, categories, variants: galleries.variants, images: galleries.images });
};
