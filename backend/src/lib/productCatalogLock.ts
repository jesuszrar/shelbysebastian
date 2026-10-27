import { Prisma } from "@prisma/client";

const PRODUCT_CATALOG_LOCK_NAMESPACE = 1397247042;
export type ProductCatalogTransaction = Prisma.TransactionClient;

export const lockProductCatalogIds = async (
  transaction: ProductCatalogTransaction,
  productIds: readonly string[],
) => {
  const orderedIds = Array.from(new Set(productIds.filter(Boolean))).sort();
  for (const productId of orderedIds) {
    await transaction.$queryRaw(Prisma.sql`
      WITH acquired AS (
        SELECT pg_advisory_xact_lock(CAST(${PRODUCT_CATALOG_LOCK_NAMESPACE} AS INTEGER), hashtext(${productId}))
      )
      SELECT 1 AS "locked" FROM acquired
    `);
  }
};
