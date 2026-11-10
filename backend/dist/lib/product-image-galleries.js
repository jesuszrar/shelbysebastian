const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const normalizeProductImageUrl = (image) => {
    const trimmed = image.trim();
    try {
        if (trimmed.startsWith("//"))
            return new URL(trimmed, "https://gallery.invalid").href;
        if (trimmed.startsWith("/")) {
            const url = new URL(trimmed, "https://gallery.invalid");
            return `${url.pathname}${url.search}${url.hash}`;
        }
        if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(trimmed))
            return new URL(trimmed).href;
        const suffixIndex = trimmed.search(/[?#]/);
        const path = suffixIndex < 0 ? trimmed : trimmed.slice(0, suffixIndex);
        const suffix = suffixIndex < 0 ? "" : trimmed.slice(suffixIndex);
        let normalizedPath = path;
        while (normalizedPath.startsWith("./"))
            normalizedPath = normalizedPath.slice(2);
        while (normalizedPath.includes("/./"))
            normalizedPath = normalizedPath.replace(/\/\.\//g, "/");
        if (normalizedPath.endsWith("/."))
            normalizedPath = normalizedPath.slice(0, -1);
        if (normalizedPath === ".")
            normalizedPath = "";
        return `${normalizedPath}${suffix}`;
    }
    catch {
        return trimmed;
    }
};
export const normalizeProductImageUrls = (images) => {
    const seen = new Set();
    const urls = [];
    for (const image of images) {
        const value = typeof image === "string"
            ? image
            : isRecord(image) && typeof image.url === "string"
                ? image.url
                : "";
        const url = value.trim();
        if (!url)
            continue;
        const normalized = normalizeProductImageUrl(url);
        if (seen.has(normalized))
            continue;
        seen.add(normalized);
        urls.push(url);
    }
    return urls;
};
export const separateProductImageGalleries = (variants, productImages) => ({
    variants: variants.map((variant) => {
        if (!isRecord(variant))
            return variant;
        const row = variant;
        if (!Array.isArray(row.images))
            return variant;
        return {
            ...row,
            images: typeof row.id === "string"
                ? row.images.filter((image) => isRecord(image) && image.variantId === row.id)
                : [],
        };
    }),
    images: productImages.filter((image) => isRecord(image) && image.variantId === null),
});
