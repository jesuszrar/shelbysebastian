import { Prisma } from "@prisma/client";
import { lockProductCatalogIds } from "../lib/productCatalogLock.js";
import { products as staticProducts } from "./product-catalog-data.js";
const numberOrUndefined = (value) => {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
};
const toDecimal = (value, fallback = 0) => new Prisma.Decimal(String(value ?? fallback));
const toNullableDecimal = (value) => (value === undefined ? null : new Prisma.Decimal(String(value)));
const normalizeUrl = (value) => {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};
const dedupeUrls = (values) => {
    const seen = new Set();
    const unique = [];
    for (const value of values) {
        const normalized = normalizeUrl(value);
        if (!normalized || seen.has(normalized))
            continue;
        seen.add(normalized);
        unique.push(normalized);
    }
    return unique;
};
const normalizeSpecs = (specs) => {
    if (!Array.isArray(specs))
        return null;
    const normalized = specs
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    return normalized.length > 0 ? normalized : null;
};
const buildProductSummary = (product) => ({
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    stock: product.stock,
    image: product.image,
    oldPrice: product.oldPrice,
    badge: product.badge,
    highlight: product.highlight,
    variantsCount: product.subproducts?.length ?? 0,
    galleryCount: product.images?.length ?? 0,
});
const buildVariantSummary = (productId, subproduct) => ({
    id: subproduct.id,
    productId,
    name: subproduct.name,
    image: subproduct.image,
    price: subproduct.price,
    stock: subproduct.stock,
    active: subproduct.active,
    sortOrder: subproduct.sortOrder,
});
const getProductCreateInput = (product) => {
    const sourceStock = numberOrUndefined(product.stock);
    return {
        id: product.id,
        name: product.name,
        category: product.category,
        price: toDecimal(product.price),
        stock: sourceStock ?? 0,
        image: normalizeUrl(product.image),
        description: product.description ?? null,
        specs: normalizeSpecs(product.specs) ?? Prisma.JsonNull,
        badge: product.badge ?? null,
        oldPrice: toNullableDecimal(product.oldPrice),
        highlight: Boolean(product.highlight),
    };
};
const getProductUpdateInput = (product) => {
    const productData = {
        name: product.name,
        category: product.category,
        price: toDecimal(product.price),
        image: normalizeUrl(product.image),
        description: product.description ?? null,
        specs: normalizeSpecs(product.specs) ?? Prisma.JsonNull,
        badge: product.badge ?? null,
        oldPrice: toNullableDecimal(product.oldPrice),
        highlight: Boolean(product.highlight),
    };
    return productData;
};
const getVariantCreateInput = (productId, subproduct) => {
    const sourcePrice = numberOrUndefined(subproduct.price);
    const sourceStock = numberOrUndefined(subproduct.stock);
    return {
        id: subproduct.id,
        product: {
            connect: { id: productId },
        },
        name: subproduct.name,
        description: subproduct.description ?? null,
        image: normalizeUrl(subproduct.image),
        price: toDecimal(sourcePrice, 0),
        stock: sourceStock ?? 0,
        active: subproduct.active ?? true,
        sortOrder: subproduct.sortOrder ?? 0,
    };
};
const getVariantUpdateInput = (subproduct, existingVariant) => {
    const variantData = {
        name: subproduct.name,
        description: subproduct.description ?? null,
        image: normalizeUrl(subproduct.image),
        active: subproduct.active ?? true,
        sortOrder: subproduct.sortOrder ?? 0,
    };
    const sourcePrice = numberOrUndefined(subproduct.price);
    if (sourcePrice !== undefined && !(existingVariant && Number(existingVariant.price ?? 0) === sourcePrice)) {
        variantData.price = toDecimal(sourcePrice);
    }
    return variantData;
};
const getGalleryImageRecords = (product) => {
    const urls = dedupeUrls([
        ...(product.images ?? []),
        normalizeUrl(product.image),
    ]);
    return urls.map((url, index) => ({
        productId: product.id,
        variantId: null,
        url,
        sortOrder: index,
        isPrimary: index === 0 && url === normalizeUrl(product.image),
    }));
};
const getVariantImageRecords = (productId, subproduct) => {
    const imageUrls = dedupeUrls([
        normalizeUrl(subproduct.image),
        ...(Array.isArray(subproduct.images) ? subproduct.images : []),
    ]);
    return imageUrls.map((url, index) => ({
        productId,
        variantId: subproduct.id,
        url,
        sortOrder: index,
        isPrimary: index === 0,
    }));
};
const readExpectedState = async (prisma) => {
    const [existingProducts, existingVariants, existingProductImages, excludedVariants, excludedProducts] = await Promise.all([
        prisma.product.findMany({
            select: {
                id: true,
                name: true,
                category: true,
                price: true,
                stock: true,
                image: true,
                description: true,
                specs: true,
                badge: true,
                oldPrice: true,
                highlight: true,
            },
        }),
        prisma.productVariant.findMany({
            select: {
                id: true,
                productId: true,
                name: true,
                description: true,
                image: true,
                active: true,
                sortOrder: true,
                price: true,
                stock: true,
            },
        }),
        prisma.productImage.findMany({
            select: {
                id: true,
                productId: true,
                variantId: true,
                url: true,
                sortOrder: true,
                isPrimary: true,
            },
        }),
        prisma.productVariantExclusion.findMany({ select: { variantId: true } }),
        prisma.productExclusion.findMany({ select: { productId: true } }),
    ]);
    return {
        existingProducts: new Map(existingProducts.map((product) => [product.id, product])),
        existingVariants: new Map(existingVariants.map((variant) => [variant.id, variant])),
        existingProductImages: new Map(existingProductImages.map((image) => [`${image.productId}:${image.variantId ?? "product"}:${image.url}`, image])),
        excludedVariantIds: new Set(excludedVariants.map((variant) => variant.variantId)),
        excludedProductIds: new Set(excludedProducts.map((product) => product.productId)),
    };
};
const compareProductData = (product, existingProduct) => {
    if (!existingProduct)
        return true;
    const sourcePrice = Number(product.price);
    const existingPrice = Number(existingProduct.price ?? 0);
    const sourceOldPrice = product.oldPrice === undefined ? null : Number(product.oldPrice);
    const existingOldPrice = existingProduct.oldPrice === null ? null : Number(existingProduct.oldPrice ?? 0);
    const sourceSpecs = normalizeSpecs(product.specs);
    return (existingProduct.name !== product.name ||
        existingProduct.category !== product.category ||
        existingPrice !== sourcePrice ||
        (existingProduct.image ?? null) !== (normalizeUrl(product.image) ?? null) ||
        (existingProduct.description ?? null) !== (product.description ?? null) ||
        JSON.stringify(existingProduct.specs ?? null) !== JSON.stringify(sourceSpecs ?? null) ||
        (existingProduct.badge ?? null) !== (product.badge ?? null) ||
        existingOldPrice !== sourceOldPrice ||
        Boolean(existingProduct.highlight) !== Boolean(product.highlight));
};
const compareVariantData = (subproduct, existingVariant) => {
    if (!existingVariant)
        return true;
    const sourcePrice = numberOrUndefined(subproduct.price);
    const existingPrice = Number(existingVariant.price ?? 0);
    return (existingVariant.name !== subproduct.name ||
        (existingVariant.description ?? null) !== (subproduct.description ?? null) ||
        (existingVariant.image ?? null) !== (normalizeUrl(subproduct.image) ?? null) ||
        existingVariant.active !== (subproduct.active ?? true) ||
        existingVariant.sortOrder !== (subproduct.sortOrder ?? 0) ||
        (sourcePrice !== undefined && existingPrice !== sourcePrice));
};
const assertVariantOwnership = (variantId, expectedProductId, existingProductId) => {
    if (existingProductId !== expectedProductId) {
        throw new Error(`La variante ${variantId} pertenece al producto ${existingProductId}, pero el catálogo estático la asigna al producto ${expectedProductId}`);
    }
};
export const syncProductCatalog = async (prisma, products = staticProducts) => {
    products = Array.from(new Map(products.map((product) => [product.id, product])).values());
    const { existingProducts, existingVariants, existingProductImages, excludedVariantIds, excludedProductIds } = await readExpectedState(prisma);
    for (const product of products) {
        if (excludedProductIds.has(product.id))
            continue;
        for (const subproduct of product.subproducts ?? []) {
            if (excludedVariantIds.has(subproduct.id))
                continue;
            const existingVariant = existingVariants.get(subproduct.id);
            if (existingVariant)
                assertVariantOwnership(subproduct.id, product.id, existingVariant.productId);
        }
    }
    const plannedProducts = {
        create: [],
        update: [],
        skip: [],
        excluded: [],
    };
    const plannedVariants = {
        create: [],
        update: [],
        skip: [],
        excluded: [],
    };
    const plannedImages = {
        create: [],
        skip: [],
    };
    for (const product of products) {
        if (excludedProductIds.has(product.id)) {
            plannedProducts.excluded.push({ type: "excluded", product, summary: buildProductSummary(product) });
            continue;
        }
        const existingProduct = existingProducts.get(product.id) ?? null;
        if (!existingProduct) {
            plannedProducts.create.push({ type: "create", product, summary: buildProductSummary(product) });
        }
        else if (compareProductData(product, existingProduct)) {
            plannedProducts.update.push({ type: "update", product, summary: buildProductSummary(product) });
        }
        else {
            plannedProducts.skip.push({ type: "skip", product, summary: buildProductSummary(product) });
        }
        for (const subproduct of product.subproducts ?? []) {
            if (excludedVariantIds.has(subproduct.id)) {
                plannedVariants.excluded.push({ type: "excluded", productId: product.id, subproduct, summary: buildVariantSummary(product.id, subproduct) });
                continue;
            }
            const existingVariant = existingVariants.get(subproduct.id) ?? null;
            if (!existingVariant) {
                plannedVariants.create.push({ type: "create", productId: product.id, subproduct, summary: buildVariantSummary(product.id, subproduct) });
            }
            else if (compareVariantData(subproduct, existingVariant)) {
                plannedVariants.update.push({ type: "update", productId: product.id, subproduct, summary: buildVariantSummary(product.id, subproduct) });
            }
            else {
                plannedVariants.skip.push({ type: "skip", productId: product.id, subproduct, summary: buildVariantSummary(product.id, subproduct) });
            }
            for (const image of getVariantImageRecords(product.id, subproduct)) {
                const key = `${image.productId}:${image.variantId ?? "product"}:${image.url}`;
                if (existingProductImages.has(key)) {
                    plannedImages.skip.push(image);
                }
                else {
                    plannedImages.create.push(image);
                }
            }
        }
        for (const image of getGalleryImageRecords(product)) {
            const key = `${image.productId}:${image.variantId ?? "product"}:${image.url}`;
            if (existingProductImages.has(key)) {
                plannedImages.skip.push(image);
            }
            else {
                plannedImages.create.push(image);
            }
        }
    }
    const summary = {
        dryRun: false,
        sourceProducts: products.length,
        products: {
            create: plannedProducts.create.length,
            update: plannedProducts.update.length,
            skip: plannedProducts.skip.length,
            excluded: plannedProducts.excluded.length,
        },
        variants: {
            create: plannedVariants.create.length,
            update: plannedVariants.update.length,
            skip: plannedVariants.skip.length,
            excluded: plannedVariants.excluded.length,
        },
        images: {
            create: plannedImages.create.length,
            skip: plannedImages.skip.length,
        },
        protection: {
            noDelete: true,
            noInventoryMovement: true,
            preserveExistingStockWhenSourceOmitsValue: true,
            preserveNiimbotB1Stock: true,
        },
    };
    await prisma.$transaction(async (tx) => {
        const productIdsToLock = Array.from(new Set(products.map((product) => product.id)));
        await lockProductCatalogIds(tx, productIdsToLock);
        const excludedProductsDuringSync = productIdsToLock.length > 0
            ? new Set((await tx.productExclusion.findMany({ where: { productId: { in: productIdsToLock } }, select: { productId: true } })).map((item) => item.productId))
            : new Set();
        const currentProducts = productIdsToLock.length > 0
            ? await tx.product.findMany({
                where: { id: { in: productIdsToLock } },
                select: {
                    id: true,
                    name: true,
                    category: true,
                    price: true,
                    stock: true,
                    image: true,
                    description: true,
                    specs: true,
                    badge: true,
                    oldPrice: true,
                    highlight: true,
                },
            })
            : [];
        const currentProductsById = new Map(currentProducts.map((item) => [item.id, item]));
        const staticVariants = products.flatMap((product) => (product.subproducts ?? []).map((subproduct) => ({ productId: product.id, subproduct })));
        const variantIdsToCheck = Array.from(new Set(staticVariants.map((item) => item.subproduct.id)));
        const currentVariants = variantIdsToCheck.length > 0
            ? await tx.productVariant.findMany({
                where: { id: { in: variantIdsToCheck } },
                select: {
                    id: true,
                    productId: true,
                    name: true,
                    description: true,
                    image: true,
                    active: true,
                    sortOrder: true,
                    price: true,
                    stock: true,
                },
            })
            : [];
        const currentVariantsById = new Map(currentVariants.map((item) => [item.id, item]));
        const excludedDuringSync = variantIdsToCheck.length > 0
            ? new Set((await tx.productVariantExclusion.findMany({ where: { variantId: { in: variantIdsToCheck } }, select: { variantId: true } })).map((item) => item.variantId))
            : new Set();
        for (const { productId, subproduct } of staticVariants) {
            if (excludedProductsDuringSync.has(productId) || excludedDuringSync.has(subproduct.id))
                continue;
            const existingVariant = currentVariantsById.get(subproduct.id);
            if (existingVariant)
                assertVariantOwnership(subproduct.id, productId, existingVariant.productId);
        }
        const currentImages = productIdsToLock.length > 0
            ? await tx.productImage.findMany({ where: { productId: { in: productIdsToLock } }, select: { productId: true, variantId: true, url: true } })
            : [];
        const currentImageKeys = new Set(currentImages.map((image) => `${image.productId}:${image.variantId ?? "product"}:${image.url}`));
        for (const product of products) {
            if (excludedProductsDuringSync.has(product.id))
                continue;
            const existingProduct = currentProductsById.get(product.id) ?? null;
            if (!existingProduct) {
                await tx.product.create({ data: getProductCreateInput(product) });
            }
            else if (compareProductData(product, existingProduct)) {
                await tx.product.update({
                    where: { id: product.id },
                    data: getProductUpdateInput(product),
                });
            }
        }
        for (const { productId, subproduct } of staticVariants) {
            if (excludedProductsDuringSync.has(productId) || excludedDuringSync.has(subproduct.id))
                continue;
            const existingVariant = currentVariantsById.get(subproduct.id) ?? null;
            if (!existingVariant) {
                await tx.productVariant.create({
                    data: getVariantCreateInput(productId, subproduct),
                });
                currentVariantsById.set(subproduct.id, {
                    id: subproduct.id,
                    productId,
                    name: subproduct.name,
                    description: subproduct.description ?? null,
                    image: normalizeUrl(subproduct.image),
                    active: subproduct.active ?? true,
                    sortOrder: subproduct.sortOrder ?? 0,
                    price: toDecimal(numberOrUndefined(subproduct.price), 0),
                    stock: numberOrUndefined(subproduct.stock) ?? 0,
                });
            }
            else if (compareVariantData(subproduct, existingVariant)) {
                await tx.productVariant.update({
                    where: { id: subproduct.id },
                    data: getVariantUpdateInput(subproduct, existingVariant),
                });
            }
        }
        for (const product of products) {
            if (excludedProductsDuringSync.has(product.id))
                continue;
            const images = [
                ...getGalleryImageRecords(product),
                ...(product.subproducts ?? [])
                    .filter((subproduct) => !excludedDuringSync.has(subproduct.id))
                    .flatMap((subproduct) => getVariantImageRecords(product.id, subproduct)),
            ];
            for (const image of images) {
                const imageKey = `${image.productId}:${image.variantId ?? "product"}:${image.url}`;
                if (currentImageKeys.has(imageKey))
                    continue;
                await tx.productImage.create({ data: image });
                currentImageKeys.add(imageKey);
            }
        }
    });
    return summary;
};
