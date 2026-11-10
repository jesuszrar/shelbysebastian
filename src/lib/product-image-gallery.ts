type VariantImageSource = {
  id: string;
  image?: string | null;
  images?: string[];
};

type ProductImageSource = {
  image?: string | null;
  images?: string[];
  subproducts?: VariantImageSource[];
};

const usableImages = (images: readonly unknown[] | undefined): string[] =>
  (images ?? []).filter((image): image is string =>
    typeof image === "string" && image.trim().length > 0);

const normalizeImageUrl = (image: string): string => {
  const trimmed = image.trim();
  try {
    if (trimmed.startsWith("//")) {
      return new URL(trimmed, "https://gallery.invalid").href;
    }
    if (trimmed.startsWith("/")) {
      const url = new URL(trimmed, "https://gallery.invalid");
      return `${url.pathname}${url.search}${url.hash}`;
    }
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(trimmed)) return new URL(trimmed).href;

    const suffixIndex = trimmed.search(/[?#]/);
    const path = suffixIndex < 0 ? trimmed : trimmed.slice(0, suffixIndex);
    const suffix = suffixIndex < 0 ? "" : trimmed.slice(suffixIndex);
    let normalizedPath = path;
    while (normalizedPath.startsWith("./")) normalizedPath = normalizedPath.slice(2);
    while (normalizedPath.includes("/./")) normalizedPath = normalizedPath.replace(/\/\.\//g, "/");
    if (normalizedPath.endsWith("/.")) normalizedPath = normalizedPath.slice(0, -1);
    if (normalizedPath === ".") normalizedPath = "";
    return `${normalizedPath}${suffix}`;
  } catch {
    return trimmed;
  }
};

const uniqueImages = (images: string[]): string[] => {
  const seen = new Set<string>();
  return images.filter((image) => {
    const normalized = normalizeImageUrl(image);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const galleryWithPrimaryFallback = (
  images: readonly unknown[] | undefined,
  primaryImage: unknown,
): string[] => {
  const gallery = uniqueImages(usableImages(images));
  const primary = usableImages([primaryImage])[0];
  if (!primary) return gallery;

  const primaryUrl = normalizeImageUrl(primary);
  if (gallery.some((image) => normalizeImageUrl(image) === primaryUrl)) return gallery;
  return [primary, ...gallery];
};

export const getProductImageGallery = (
  product: ProductImageSource,
  selectedVariantId?: string,
): string[] => {
  if (selectedVariantId) {
    const variant = product.subproducts?.find((item) => item.id === selectedVariantId);
    if (variant) return galleryWithPrimaryFallback(variant.images, variant.image);
  }

  return galleryWithPrimaryFallback(product.images, product.image);
};
