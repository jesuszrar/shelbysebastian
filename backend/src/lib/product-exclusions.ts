import { Prisma } from "@prisma/client";
import { lockProductCatalogIds, type ProductCatalogTransaction } from "./productCatalogLock.js";

export type LegacyVariantImport = {
  productId: string;
  variantId: string;
  name: string;
  description: string | null;
  image: string | null;
  price: number;
  stock: number;
  active?: boolean;
  sortOrder: number;
};

export const deleteProductsWithExclusions = async (
  transaction: ProductCatalogTransaction,
  productIds: readonly string[],
) => {
  const ids = Array.from(new Set(productIds.filter(Boolean))).sort();
  if (ids.length === 0) return 0;

  await lockProductCatalogIds(transaction, ids);
  await transaction.productExclusion.createMany({
    data: ids.map((productId) => ({ productId })),
    skipDuplicates: true,
  });
  const products = await transaction.product.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const existingProductIds = products.map((product) => product.id);
  if (existingProductIds.length === 0) return 0;

  const variants = await transaction.productVariant.findMany({
    where: { productId: { in: existingProductIds } },
    select: { id: true, productId: true },
  });
  if (variants.length > 0) {
    await transaction.productVariantExclusion.createMany({
      data: variants.map((variant) => ({ variantId: variant.id, productId: variant.productId })),
      skipDuplicates: true,
    });
  }

  const deleted = await transaction.product.deleteMany({ where: { id: { in: existingProductIds } } });
  return deleted.count;
};

export const createLegacyVariantUnlessExcluded = async (
  transaction: ProductCatalogTransaction,
  item: LegacyVariantImport,
) => {
  await lockProductCatalogIds(transaction, [item.productId]);
  if (await transaction.productExclusion.findUnique({ where: { productId: item.productId } })) return "excluded-product" as const;
  if (!(await transaction.product.findUnique({ where: { id: item.productId }, select: { id: true } }))) return "missing-product" as const;
  if (await transaction.productVariantExclusion.findUnique({ where: { variantId: item.variantId } })) return "excluded-variant" as const;
  if (await transaction.productVariant.findUnique({ where: { id: item.variantId }, select: { id: true } })) return "existing" as const;

  const variant = await transaction.productVariant.create({
    data: {
      id: item.variantId,
      productId: item.productId,
      name: item.name,
      description: item.description,
      price: new Prisma.Decimal(item.price),
      stock: item.stock,
      image: item.image,
      active: item.active !== false,
      sortOrder: item.sortOrder,
    },
  });
  if (item.image) {
    await transaction.productImage.create({ data: { productId: item.productId, variantId: variant.id, url: item.image, sortOrder: 0, isPrimary: true } });
  }
  return "created" as const;
};
