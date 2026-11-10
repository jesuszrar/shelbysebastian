type ProductImageRecord = Record<string, unknown> & { variantId?: unknown };
type ProductVariantRecord = Record<string, unknown> & { id?: unknown; images?: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const normalizeProductImageUrl = (image: string): string => {
  const trimmed = image.trim();
  try {
    if (trimmed.startsWith("//")) return new URL(trimmed, "https://gallery.invalid").href;
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

export const normalizeProductImageUrls = (images: readonly unknown[]): string[] => {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const image of images) {
    const value = typeof image === "string"
      ? image
      : isRecord(image) && typeof image.url === "string"
        ? image.url
        : "";
    const url = value.trim();
    if (!url) continue;
    const normalized = normalizeProductImageUrl(url);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(url);
  }
  return urls;
};

export const separateProductImageGalleries = (
  variants: unknown[],
  productImages: unknown[],
): { variants: unknown[]; images: ProductImageRecord[] } => ({
  variants: variants.map((variant) => {
    if (!isRecord(variant)) return variant;

    const row = variant as ProductVariantRecord;
    if (!Array.isArray(row.images)) return variant;

    return {
      ...row,
      images: typeof row.id === "string"
        ? row.images.filter((image): image is ProductImageRecord =>
          isRecord(image) && image.variantId === row.id)
        : [],
    };
  }),
  images: productImages.filter((image): image is ProductImageRecord =>
    isRecord(image) && image.variantId === null),
});
