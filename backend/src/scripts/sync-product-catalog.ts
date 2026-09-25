import { Prisma, type PrismaClient } from "@prisma/client";
import { products as staticProducts } from "./product-catalog-data.js";

const numberOrUndefined = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const toDecimal = (value: number | undefined, fallback = 0) => new Prisma.Decimal(String(value ?? fallback));
const toNullableDecimal = (value: number | undefined) => (value === undefined ? null : new Prisma.Decimal(String(value)));
const normalizeUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const dedupeUrls = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = normalizeUrl(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
};

const normalizeSpecs = (specs: unknown): Prisma.InputJsonValue | null => {
  if (!Array.isArray(specs)) return null;
  const normalized = specs
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : null;
};

const buildProductSummary = (product: (typeof staticProducts)[number]) => ({
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

const buildVariantSummary = (productId: string, subproduct: NonNullable<(typeof staticProducts)[number]["subproducts"]>[number]) => ({
  id: subproduct.id,
  productId,
  name: subproduct.name,
  image: subproduct.image,
  price: subproduct.price,
  stock: subproduct.stock,
  active: subproduct.active,
  sortOrder: subproduct.sortOrder,
});

const getProductCreateInput = (product: (typeof staticProducts)[number]) => {
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
  } satisfies Prisma.ProductCreateInput;
};

const getProductUpdateInput = (product: (typeof staticProducts)[number]) => {
  const productData: Prisma.ProductUpdateInput = {
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

const getVariantCreateInput = (productId: string, subproduct: NonNullable<(typeof staticProducts)[number]["subproducts"]>[number]) => {
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
  } satisfies Prisma.ProductVariantCreateInput;
};

const getVariantUpdateInput = (
  subproduct: NonNullable<(typeof staticProducts)[number]["subproducts"]>[number],
  existingVariant: { price: Prisma.Decimal | string | number; stock: number } | null,
) => {
  const variantData: Prisma.ProductVariantUpdateInput = {
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

const getGalleryImageRecords = (product: (typeof staticProducts)[number]) => {
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

const getVariantImageRecords = (productId: string, subproduct: NonNullable<(typeof staticProducts)[number]["subproducts"]>[number]) => {
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

const readExpectedState = async (prisma: PrismaClient) => {
  const [existingProducts, existingVariants, existingProductImages] = await Promise.all([
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
  ]);

  return {
    existingProducts: new Map(existingProducts.map((product) => [product.id, product])),
    existingVariants: new Map(existingVariants.map((variant) => [variant.id, variant])),
    existingProductImages: new Map(existingProductImages.map((image) => [`${image.productId}:${image.variantId ?? "product"}:${image.url}`, image])),
  };
};

const compareProductData = (product: (typeof staticProducts)[number], existingProduct: { name: string; category: string; price: Prisma.Decimal | number | string; stock: number; image: string | null; description: string | null; specs: Prisma.JsonValue | null; badge: string | null; oldPrice: Prisma.Decimal | number | string | null; highlight: boolean } | null) => {
  if (!existingProduct) return true;

  const sourcePrice = Number(product.price);
  const existingPrice = Number(existingProduct.price ?? 0);
  const sourceOldPrice = product.oldPrice === undefined ? null : Number(product.oldPrice);
  const existingOldPrice = existingProduct.oldPrice === null ? null : Number(existingProduct.oldPrice ?? 0);
  const sourceSpecs = normalizeSpecs(product.specs);

  return (
    existingProduct.name !== product.name ||
    existingProduct.category !== product.category ||
    existingPrice !== sourcePrice ||
    (existingProduct.image ?? null) !== (normalizeUrl(product.image) ?? null) ||
    (existingProduct.description ?? null) !== (product.description ?? null) ||
    JSON.stringify(existingProduct.specs ?? null) !== JSON.stringify(sourceSpecs ?? null) ||
    (existingProduct.badge ?? null) !== (product.badge ?? null) ||
    existingOldPrice !== sourceOldPrice ||
    Boolean(existingProduct.highlight) !== Boolean(product.highlight)
  );
};

const compareVariantData = (
  subproduct: NonNullable<(typeof staticProducts)[number]["subproducts"]>[number],
  existingVariant: { name: string; description: string | null; image: string | null; active: boolean; sortOrder: number; price: Prisma.Decimal | number | string; stock: number } | null,
) => {
  if (!existingVariant) return true;

  const sourcePrice = numberOrUndefined(subproduct.price);
  const existingPrice = Number(existingVariant.price ?? 0);

  return (
    existingVariant.name !== subproduct.name ||
    (existingVariant.description ?? null) !== (subproduct.description ?? null) ||
    (existingVariant.image ?? null) !== (normalizeUrl(subproduct.image) ?? null) ||
    existingVariant.active !== (subproduct.active ?? true) ||
    existingVariant.sortOrder !== (subproduct.sortOrder ?? 0) ||
    (sourcePrice !== undefined && existingPrice !== sourcePrice)
  );
};

export const syncProductCatalog = async (prisma: PrismaClient) => {
  const { existingProducts, existingVariants, existingProductImages } = await readExpectedState(prisma);

  const plannedProducts = {
    create: [] as Array<{ type: "create"; product: (typeof staticProducts)[number]; summary: ReturnType<typeof buildProductSummary> }>,
    update: [] as Array<{ type: "update"; product: (typeof staticProducts)[number]; summary: ReturnType<typeof buildProductSummary> }>,
    skip: [] as Array<{ type: "skip"; product: (typeof staticProducts)[number]; summary: ReturnType<typeof buildProductSummary> }>,
  };

  const plannedVariants = {
    create: [] as Array<{ type: "create"; productId: string; subproduct: NonNullable<(typeof staticProducts)[number]["subproducts"]>[number]; summary: ReturnType<typeof buildVariantSummary> }>,
    update: [] as Array<{ type: "update"; productId: string; subproduct: NonNullable<(typeof staticProducts)[number]["subproducts"]>[number]; summary: ReturnType<typeof buildVariantSummary> }>,
    skip: [] as Array<{ type: "skip"; productId: string; subproduct: NonNullable<(typeof staticProducts)[number]["subproducts"]>[number]; summary: ReturnType<typeof buildVariantSummary> }>,
  };

  const plannedImages = {
    create: [] as Array<{ productId: string; variantId: string | null; url: string; sortOrder: number; isPrimary: boolean }>,
    skip: [] as Array<{ productId: string; variantId: string | null; url: string; sortOrder: number; isPrimary: boolean }>,
  };

  for (const product of staticProducts) {
    const existingProduct = existingProducts.get(product.id) ?? null;

    if (!existingProduct) {
      plannedProducts.create.push({ type: "create", product, summary: buildProductSummary(product) });
    } else if (compareProductData(product, existingProduct)) {
      plannedProducts.update.push({ type: "update", product, summary: buildProductSummary(product) });
    } else {
      plannedProducts.skip.push({ type: "skip", product, summary: buildProductSummary(product) });
    }

    for (const subproduct of product.subproducts ?? []) {
      const existingVariant = existingVariants.get(subproduct.id) ?? null;

      if (!existingVariant) {
        plannedVariants.create.push({ type: "create", productId: product.id, subproduct, summary: buildVariantSummary(product.id, subproduct) });
      } else if (compareVariantData(subproduct, existingVariant)) {
        plannedVariants.update.push({ type: "update", productId: product.id, subproduct, summary: buildVariantSummary(product.id, subproduct) });
      } else {
        plannedVariants.skip.push({ type: "skip", productId: product.id, subproduct, summary: buildVariantSummary(product.id, subproduct) });
      }

      for (const image of getVariantImageRecords(product.id, subproduct)) {
        const key = `${image.productId}:${image.variantId ?? "product"}:${image.url}`;
        if (existingProductImages.has(key)) {
          plannedImages.skip.push(image);
        } else {
          plannedImages.create.push(image);
        }
      }
    }

    for (const image of getGalleryImageRecords(product)) {
      const key = `${image.productId}:${image.variantId ?? "product"}:${image.url}`;
      if (existingProductImages.has(key)) {
        plannedImages.skip.push(image);
      } else {
        plannedImages.create.push(image);
      }
    }
  }

  const summary = {
    dryRun: false,
    sourceProducts: staticProducts.length,
    products: {
      create: plannedProducts.create.length,
      update: plannedProducts.update.length,
      skip: plannedProducts.skip.length,
    },
    variants: {
      create: plannedVariants.create.length,
      update: plannedVariants.update.length,
      skip: plannedVariants.skip.length,
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
    for (const item of plannedProducts.create) {
      await tx.product.create({
        data: getProductCreateInput(item.product),
      });
    }

    for (const item of plannedProducts.update) {
      await tx.product.update({
        where: { id: item.product.id },
        data: getProductUpdateInput(item.product),
      });
    }

    for (const item of plannedVariants.create) {
      await tx.productVariant.create({
        data: getVariantCreateInput(item.productId, item.subproduct),
      });
    }

    for (const item of plannedVariants.update) {
      const existing = existingVariants.get(item.subproduct.id) ?? null;
      await tx.productVariant.update({
        where: { id: item.subproduct.id },
        data: getVariantUpdateInput(item.subproduct, existing),
      });
    }

    for (const image of plannedImages.create) {
      await tx.productImage.create({ data: image });
    }
  });

  return summary;
};
