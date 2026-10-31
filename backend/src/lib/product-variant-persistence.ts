import { Prisma, type PrismaClient } from "@prisma/client";
import { lockProductCatalogIds } from "./productCatalogLock.js";

export type ProductVariantInput = Record<string, unknown>;

export const withProductCatalogBatchTransaction = <T>(
  prisma: Pick<PrismaClient, "$transaction">,
  productIds: readonly string[],
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) => prisma.$transaction(async (transaction) => {
  await lockProductCatalogIds(transaction, productIds);
  return operation(transaction);
});

const productPatchFields = new Set([
  "name",
  "category",
  "price",
  "stock",
  "image",
  "description",
  "specs",
  "badge",
  "highlight",
  "oldPrice",
  "activateWholesale",
  "wholesaleMinQty",
  "wholesaleDiscountPercent",
]);

type ProductPatchFilter = { column: "id"; value: string };

type ProductPatchValidation =
  | { error: string; field?: string; rejectedFields?: string[] }
  | { data: Prisma.ProductUpdateInput; filters: ProductPatchFilter[] };

const isJsonValue = (value: unknown, ancestors = new Set<object>()): value is Prisma.InputJsonValue | null => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, ancestors))
    : Object.values(value).every((item) => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
};

const resolvePatchDecimal = (value: unknown): Prisma.Decimal => {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && value.trim() === "")) {
    throw new TypeError("debe ser un número decimal");
  }
  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(value);
  } catch {
    throw new TypeError("debe ser un número decimal finito");
  }
  if (!decimal.isFinite()) throw new TypeError("debe ser un número decimal finito");
  if (decimal.decimalPlaces() > 2) throw new TypeError("admite como máximo 2 decimales");
  if (decimal.abs().greaterThan("9999999999.99")) throw new TypeError("está fuera del rango Decimal(12,2)");
  return decimal;
};

const resolvePatchInteger = (value: unknown, field: string, max: number) => {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw new TypeError(`debe ser un entero entre 0 y ${max}`);
  }
  if (field === "stock") return resolveAdminStock(parsed);
  return parsed;
};

export const validateProductPatch = (payload: unknown, filters: unknown): ProductPatchValidation => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "El cuerpo debe ser un objeto con campos editables" };
  }

  const patch = payload as Record<string, unknown>;
  const fields = Object.keys(patch);
  const rejectedFields = fields.filter((field) => !productPatchFields.has(field));
  if (rejectedFields.length > 0) {
    return { error: "El PATCH contiene propiedades no permitidas", rejectedFields };
  }
  if (fields.length === 0) {
    return { error: "El PATCH debe incluir al menos un campo editable" };
  }
  if (!Array.isArray(filters) || filters.length !== 1) {
    return { error: "El PATCH de productos requiere exactamente un filtro por ID" };
  }
  const filter = filters[0];
  if (
    !filter ||
    typeof filter !== "object" ||
    Array.isArray(filter) ||
    Object.keys(filter).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(filter, "column") ||
    !Object.prototype.hasOwnProperty.call(filter, "value") ||
    filter.column !== "id" ||
    typeof filter.value !== "string" ||
    filter.value.trim() === ""
  ) {
    return { error: "El PATCH de productos requiere un ID de producto válido" };
  }

  const fieldError = (field: string, reason: string): ProductPatchValidation => ({
    error: `El campo ${field} ${reason}`,
    field,
  });
  for (const field of fields) {
    const value = patch[field];
    try {
      switch (field) {
        case "name":
        case "category":
          if (typeof value !== "string") return fieldError(field, "debe ser una cadena");
          break;
        case "image":
        case "description":
        case "badge":
          if (value !== null && typeof value !== "string") return fieldError(field, "debe ser una cadena o null");
          break;
        case "price": {
          if (value === null) return fieldError(field, "no admite null");
          resolvePatchDecimal(value);
          break;
        }
        case "oldPrice":
          if (value !== null) resolvePatchDecimal(value);
          break;
        case "stock":
          resolvePatchInteger(value, field, 2_147_483_647);
          break;
        case "wholesaleMinQty":
          resolvePatchInteger(value, field, 2_147_483_647);
          break;
        case "wholesaleDiscountPercent":
          resolvePatchInteger(value, field, 100);
          break;
        case "highlight":
        case "activateWholesale":
          if (typeof value !== "boolean") return fieldError(field, "debe ser booleano");
          break;
        case "specs":
          if (!isJsonValue(value)) return fieldError(field, "debe contener un valor JSON válido o null");
          break;
      }
    } catch (error) {
      return fieldError(field, error instanceof Error ? error.message : "no es válido");
    }
  }

  const data: Prisma.ProductUpdateInput = {};
  for (const field of fields) {
    const value = patch[field];
    switch (field) {
      case "name":
        if (typeof value === "string") data.name = value;
        break;
      case "category":
        if (typeof value === "string") data.category = value;
        break;
      case "price":
        data.price = resolvePatchDecimal(value);
        break;
      case "oldPrice":
        data.oldPrice = value === null ? null : resolvePatchDecimal(value);
        break;
      case "stock":
        data.stock = resolvePatchInteger(value, field, 2_147_483_647);
        break;
      case "image":
        if (value === null || typeof value === "string") data.image = value;
        break;
      case "description":
        if (value === null || typeof value === "string") data.description = value;
        break;
      case "badge":
        if (value === null || typeof value === "string") data.badge = value;
        break;
      case "specs":
        if (value === null) data.specs = Prisma.DbNull;
        else if (isJsonValue(value)) data.specs = value;
        break;
      case "highlight":
        if (typeof value === "boolean") data.highlight = value;
        break;
      case "activateWholesale":
        if (typeof value === "boolean") data.activateWholesale = value;
        break;
      case "wholesaleMinQty":
        data.wholesaleMinQty = resolvePatchInteger(value, field, 2_147_483_647);
        break;
      case "wholesaleDiscountPercent":
        data.wholesaleDiscountPercent = resolvePatchInteger(value, field, 100);
        break;
    }
  }

  return { data, filters: [{ column: "id", value: filter.value }] };
};

export const resolveProductPatchTarget = <T>(products: readonly T[]) => {
  if (products.length === 0) return { kind: "not-found" } as const;
  if (products.length > 1) return { kind: "non-unique" } as const;
  return { kind: "found", product: products[0] } as const;
};

export const resolveProductVariants = (row: Record<string, unknown>): ProductVariantInput[] | null => {
  if (Object.prototype.hasOwnProperty.call(row, "subproducts")) {
    return Array.isArray(row.subproducts) ? row.subproducts as ProductVariantInput[] : null;
  }
  if (Object.prototype.hasOwnProperty.call(row, "variants")) {
    return Array.isArray(row.variants) ? row.variants as ProductVariantInput[] : null;
  }
  return null;
};

export const removeExcludedProductVariants = (
  variants: ProductVariantInput[],
  excludedVariantIds: ReadonlySet<string>,
) => variants.filter((variant) => !excludedVariantIds.has(String(variant.id ?? "").trim()));

export const resolveAdminStock = (stock: unknown): number | undefined => {
  if (stock === undefined) return undefined;

  const value = typeof stock === "number"
    ? stock
    : typeof stock === "string" && stock.trim() !== ""
      ? Number(stock)
      : Number.NaN;

  if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new RangeError("El stock debe ser un entero finito entre 0 y 2147483647");
  }

  return value;
};

export const findStockSnapshotConflict = (
  entity: "product" | "variant",
  id: string,
  expectedStock: unknown,
  currentStock: number | undefined,
  stockWillBeUpdated: boolean,
) => {
  if (currentStock === undefined) {
    return expectedStock === undefined
      ? null
      : { entity, id, expectedStock, currentStock: null, reason: "missing" as const };
  }
  if (!stockWillBeUpdated) return null;
  if (expectedStock === undefined) {
    return { entity, id, expectedStock: null, currentStock, reason: "snapshot-required" as const };
  }

  let resolvedExpectedStock: number | undefined;
  try {
    resolvedExpectedStock = resolveAdminStock(expectedStock);
  } catch {
    return { entity, id, expectedStock, currentStock, reason: "invalid-snapshot" as const };
  }
  if (resolvedExpectedStock !== currentStock) {
    return { entity, id, expectedStock: resolvedExpectedStock, currentStock, reason: "changed" as const };
  }
  return null;
};

export const resolveVariantImageUrls = (variant: Record<string, unknown>): string[] | null => {
  if (!Array.isArray(variant.images)) return null;
  return Array.from(new Set(variant.images
    .map((image) => (typeof image === "string" ? image : String((image as Record<string, unknown>)?.url ?? "")).trim())
    .filter(Boolean)));
};

export const productCatalogRelations = {
  variants: {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: {
      images: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
  },
  categories: { include: { category: true } },
  images: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
} satisfies Prisma.ProductInclude;

export const readProductWithCatalogRelations = (
  transaction: Pick<Prisma.TransactionClient, "product">,
  productId: string,
) => transaction.product.findUnique({
  where: { id: productId },
  include: productCatalogRelations,
});

export const readProductsWithCatalogRelations = (
  transaction: Pick<Prisma.TransactionClient, "product">,
) => transaction.product.findMany({ include: productCatalogRelations });

export const replaceVariantImagesIfChanged = async (
  transaction: Prisma.TransactionClient,
  productId: string,
  variantId: string,
  imageUrls: string[],
) => {
  const where = { productId, variantId };
  const currentImages = await transaction.productImage.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, url: true },
  });
  const currentUrls = currentImages.map((image) => image.url);
  if (currentUrls.length === imageUrls.length && currentUrls.every((url, index) => url === imageUrls[index])) {
    return false;
  }

  await transaction.productImage.deleteMany({ where });
  for (const [sortOrder, url] of imageUrls.entries()) {
    await transaction.productImage.create({
      data: { productId, variantId, url, sortOrder, isPrimary: sortOrder === 0 },
    });
  }
  return true;
};

export const replaceProductImagesIfChanged = async (
  transaction: Prisma.TransactionClient,
  productId: string,
  imageUrls: string[],
) => {
  const where = { productId, variantId: null };
  const currentImages = await transaction.productImage.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, url: true },
  });
  const currentUrls = currentImages.map((image) => image.url);
  if (currentUrls.length === imageUrls.length && currentUrls.every((url, index) => url === imageUrls[index])) {
    return false;
  }

  await transaction.productImage.deleteMany({ where });
  for (const [sortOrder, url] of imageUrls.entries()) {
    await transaction.productImage.create({
      data: { productId, variantId: null, url, sortOrder, isPrimary: sortOrder === 0 },
    });
  }
  return true;
};

export const deleteOmittedProductVariants = async (
  transaction: Prisma.TransactionClient,
  productId: string,
  retainedVariantIds: string[],
) => {
  const omittedVariantsWhere = retainedVariantIds.length > 0
    ? { productId, id: { notIn: retainedVariantIds } }
    : { productId };
  const omittedVariants = await transaction.productVariant.findMany({
    where: omittedVariantsWhere,
    select: { id: true, productId: true },
  });
  if (omittedVariants.length > 0) {
    await transaction.productVariantExclusion.createMany({
      data: omittedVariants.map((variant) => ({ variantId: variant.id, productId: variant.productId })),
      skipDuplicates: true,
    });
  }
  await transaction.productVariant.deleteMany({ where: omittedVariantsWhere });
};

export type ProductCatalogRecord = Prisma.ProductGetPayload<{ include: typeof productCatalogRelations }>;
