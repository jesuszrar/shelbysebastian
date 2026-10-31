import { products as catalogProducts } from "./product-catalog-data.js";
const numberOrUndefined = (value) => {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    return undefined;
};
const normalizeUrl = (value) => {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
};
const uniqueUrls = (values) => [...new Set(values.map(normalizeUrl).filter((value) => Boolean(value)))];
const decimalNumber = (value) => (value === null || value === undefined ? null : Number(value));
const specsEqual = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
const productImages = (product) => uniqueUrls([...(product.images ?? []), product.image]).map((url, sortOrder) => ({
    productId: product.id,
    variantId: null,
    url,
    sortOrder,
    isPrimary: sortOrder === 0 && url === product.image,
}));
const variantImages = (productId, variant) => uniqueUrls([variant.image, ...(variant.images ?? [])]).map((url, sortOrder) => ({
    productId,
    variantId: variant.id,
    url,
    sortOrder,
    isPrimary: sortOrder === 0,
}));
const productChanged = (product, existing) => {
    if (!existing)
        return true;
    return existing.name !== product.name
        || existing.category !== product.category
        || decimalNumber(existing.price) !== product.price
        || (existing.image ?? null) !== product.image
        || (existing.description ?? null) !== product.description
        || !specsEqual(existing.specs, product.specs)
        || (existing.badge ?? null) !== (product.badge ?? null)
        || decimalNumber(existing.oldPrice) !== (product.oldPrice ?? null)
        || existing.highlight !== Boolean(product.highlight);
};
const variantChanged = (variant, existing) => {
    if (!existing)
        return true;
    const sourcePrice = numberOrUndefined(variant.price);
    const sourceStock = numberOrUndefined(variant.stock);
    return existing.name !== variant.name
        || (existing.description ?? null) !== variant.description
        || (existing.image ?? null) !== variant.image
        || existing.active !== (variant.active ?? true)
        || existing.sortOrder !== (variant.sortOrder ?? 0)
        || (sourcePrice !== undefined && decimalNumber(existing.price) !== sourcePrice)
        || (sourceStock !== undefined && existing.stock !== sourceStock);
};
export const buildCatalogSyncPlan = async (prisma, products = catalogProducts) => {
    const [existingProducts, existingVariants, existingImages] = await Promise.all([
        prisma.product.findMany({ select: { id: true, name: true, category: true, price: true, stock: true, image: true, description: true, specs: true, badge: true, oldPrice: true, highlight: true } }),
        prisma.productVariant.findMany({ select: { id: true, productId: true, name: true, description: true, image: true, active: true, sortOrder: true, price: true, stock: true } }),
        prisma.productImage.findMany({ select: { productId: true, variantId: true, url: true, sortOrder: true, isPrimary: true } }),
    ]);
    const productMap = new Map(existingProducts.map((item) => [item.id, item]));
    const variantMap = new Map(existingVariants.map((item) => [item.id, item]));
    const imageMap = new Set(existingImages.map((item) => `${item.productId}:${item.variantId ?? "product"}:${item.url}`));
    const plan = {
        sourceProducts: products.length,
        sourceVariants: products.reduce((total, product) => total + (product.subproducts?.length ?? 0), 0),
        products: { CREATE: [], UPDATE: [], SKIP: [] },
        variants: { CREATE: [], UPDATE: [], SKIP: [] },
        images: { CREATE: [], SKIP: [] },
        summary: { products: { CREATE: 0, UPDATE: 0, SKIP: 0 }, variants: { CREATE: 0, UPDATE: 0, SKIP: 0 }, images: { CREATE: 0, SKIP: 0 }, noDeletes: true, readOnly: true },
    };
    for (const product of products) {
        const existing = productMap.get(product.id);
        const sourceStock = numberOrUndefined(product.stock);
        const sourceStockDefined = sourceStock !== undefined;
        const item = { id: product.id, name: product.name, currentStock: existing?.stock ?? null, sourceStock, sourceStockDefined, defaultStockOnCreate: sourceStockDefined || existing ? null : 0, stockAction: sourceStockDefined ? "source" : existing ? "preserve" : "default-on-create" };
        const action = !existing ? "CREATE" : productChanged(product, existing) || (sourceStock !== undefined && existing.stock !== sourceStock) ? "UPDATE" : "SKIP";
        plan.products[action].push(item);
        plan.summary.products[action] += 1;
        for (const variant of product.subproducts ?? []) {
            const existingVariant = variantMap.get(variant.id);
            const sourcePrice = numberOrUndefined(variant.price);
            const sourceVariantStock = numberOrUndefined(variant.stock);
            const sourcePriceDefined = sourcePrice !== undefined;
            const sourceStockDefined = sourceVariantStock !== undefined;
            const variantItem = { id: variant.id, productId: product.id, name: variant.name, currentPrice: decimalNumber(existingVariant?.price), sourcePrice, sourcePriceDefined, defaultPriceOnCreate: sourcePriceDefined || existingVariant ? null : 0, currentStock: existingVariant?.stock ?? null, sourceStock: sourceVariantStock, sourceStockDefined, defaultStockOnCreate: sourceStockDefined || existingVariant ? null : 0, stockAction: sourceStockDefined ? "source" : existingVariant ? "preserve" : "default-on-create", action: !existingVariant ? "CREATE" : variantChanged(variant, existingVariant) ? "UPDATE" : "SKIP" };
            plan.variants[variantItem.action].push(variantItem);
            plan.summary.variants[variantItem.action] += 1;
        }
        for (const image of productImages(product)) {
            const item = { ...image, action: imageMap.has(`${image.productId}:product:${image.url}`) ? "SKIP" : "CREATE" };
            plan.images[item.action].push(item);
            plan.summary.images[item.action] += 1;
        }
        for (const variant of product.subproducts ?? []) {
            for (const image of variantImages(product.id, variant)) {
                const item = { ...image, action: imageMap.has(`${image.productId}:${image.variantId}:${image.url}`) ? "SKIP" : "CREATE" };
                plan.images[item.action].push(item);
                plan.summary.images[item.action] += 1;
            }
        }
    }
    return plan;
};
