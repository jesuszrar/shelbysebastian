import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "@prisma/client";
import {
  deleteOmittedProductVariants,
  findStockSnapshotConflict,
  withProductCatalogBatchTransaction,
  readProductWithCatalogRelations,
  readProductsWithCatalogRelations,
  resolveAdminStock,
  removeExcludedProductVariants,
  replaceProductImagesIfChanged,
  replaceVariantImagesIfChanged,
  resolveVariantImageUrls,
  resolveProductPatchTarget,
  resolveProductVariants,
  validateProductPatch,
} from "./product-variant-persistence.js";

type TestState = {
  products: Array<Record<string, unknown>>;
  variants: Array<{ id: string; productId: string; sortOrder: number }>;
  variantExclusions: Array<{ variantId: string; productId: string }>;
  images: Array<{ id: string; productId: string; variantId: string | null; url: string; sortOrder: number; isPrimary: boolean }>;
  imageCreates: number;
  imageDeletes: number;
};

const makeTransaction = (seed: Partial<TestState> = {}) => {
  const state: TestState = {
    products: [...(seed.products ?? [])],
    variants: [...(seed.variants ?? [])],
    variantExclusions: [...(seed.variantExclusions ?? [])],
    images: [...(seed.images ?? [])],
    imageCreates: 0,
    imageDeletes: 0,
  };

  const getProduct = (id: string) => {
    const product = state.products.find((item) => item.id === id);
    if (!product) return null;
    const variants = state.variants
      .filter((variant) => variant.productId === id)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
      .map((variant) => ({
        ...variant,
        images: state.images
          .filter((image) => image.variantId === variant.id)
          .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)),
      }));
    return { ...product, variants, categories: [], images: state.images.filter((image) => image.productId === id && image.variantId === null) };
  };

  const transaction = {
    product: {
      findUnique: async ({ where }: { where: { id: string } }) => getProduct(where.id),
      findMany: async () => state.products.map((product) => getProduct(String(product.id))).filter(Boolean),
    },
    productVariant: {
      findMany: async ({ where }: { where: { productId: string; id?: { notIn: string[] } } }) => state.variants.filter((variant) =>
        variant.productId === where.productId && (!where.id?.notIn || !where.id.notIn.includes(variant.id))),
      deleteMany: async ({ where }: { where: { productId: string; id?: { notIn: string[] } } }) => {
        const before = state.variants.length;
        state.variants = state.variants.filter((variant) =>
          variant.productId !== where.productId || Boolean(where.id?.notIn.includes(variant.id)));
        return { count: before - state.variants.length };
      },
    },
    productVariantExclusion: {
      createMany: async ({ data }: { data: Array<{ variantId: string; productId: string }> }) => {
        for (const item of data) {
          if (!state.variantExclusions.some((existing) => existing.variantId === item.variantId)) {
            state.variantExclusions.push(item);
          }
        }
        return { count: data.length };
      },
    },
    productImage: {
      findMany: async ({ where }: { where: { productId?: string; variantId?: string | null } }) => state.images
        .filter((image) =>
          (where.productId === undefined || image.productId === where.productId) &&
          (where.variantId === undefined || image.variantId === where.variantId))
        .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
        .map(({ id, url }) => ({ id, url })),
      deleteMany: async ({ where }: { where: { productId?: string; variantId?: string | null } }) => {
        const before = state.images.length;
        state.images = state.images.filter((image) => !(
          (where.productId === undefined || image.productId === where.productId) &&
          (where.variantId === undefined || image.variantId === where.variantId)
        ));
        state.imageDeletes += 1;
        return { count: before - state.images.length };
      },
      create: async ({ data }: { data: Omit<TestState["images"][number], "id"> }) => {
        const image = { ...data, id: `image-${state.imageCreates + 1}` };
        state.imageCreates += 1;
        state.images.push(image);
        return image;
      },
    },
  };

  return { transaction: transaction as unknown as Prisma.TransactionClient, state };
};

test("absent, null and empty subproducts have distinct complete-list semantics", () => {
  assert.equal(resolveProductVariants({}), null);
  assert.equal(resolveProductVariants({ subproducts: null }), null);
  assert.deepEqual(resolveProductVariants({ subproducts: [] }), []);
  assert.deepEqual(resolveProductVariants({ subproducts: [{ id: "v1" }] }), [{ id: "v1" }]);
  assert.equal(resolveProductVariants({ variants: null }), null);
  assert.deepEqual(resolveProductVariants({ variants: [] }), []);
});

test("a stale save payload keeps excluded variants filtered and leaves their tombstones intact", () => {
  const { state } = makeTransaction({
    variantExclusions: [{ variantId: "deleted", productId: "p1" }],
  });
  const variants = [{ id: "kept" }, { id: "deleted" }, { id: "new" }];
  const excludedIds = new Set(state.variantExclusions.map((exclusion) => exclusion.variantId));

  assert.deepEqual(removeExcludedProductVariants(variants, excludedIds), [
    { id: "kept" },
    { id: "new" },
  ]);
  assert.deepEqual(state.variantExclusions, [{ variantId: "deleted", productId: "p1" }]);
});

test("admin stock input continues to accept a manually supplied value", () => {
  assert.equal(resolveAdminStock("17"), 17);
  assert.equal(resolveAdminStock(0), 0);
  assert.equal(resolveAdminStock(undefined), undefined);
});

test("admin stock rejects null, non-numeric, non-finite, fractional, negative and out-of-range values", () => {
  for (const value of [null, "", "not-a-number", Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1, 2_147_483_648]) {
    assert.throws(() => resolveAdminStock(value), {
      name: "RangeError",
      message: "El stock debe ser un entero finito entre 0 y 2147483647",
    });
  }
});

test("product PATCH accepts each scalar field with its schema-compatible value", () => {
  const acceptedValues: Record<string, unknown> = {
    name: "Updated",
    category: "Printers",
    price: "123.45",
    stock: 0,
    image: null,
    description: "Description",
    specs: { dimensions: [1, null, "cm"] },
    badge: null,
    highlight: true,
    oldPrice: null,
    activateWholesale: false,
    wholesaleMinQty: 2,
    wholesaleDiscountPercent: 100,
  };

  for (const [field, value] of Object.entries(acceptedValues)) {
    const result = validateProductPatch({ [field]: value }, [{ column: "id", value: "p1" }]);
    assert.ok("data" in result, `${field} should be accepted: ${"error" in result ? result.error : ""}`);
  }
  const result = validateProductPatch({ name: "Updated", stock: "0" }, [{ column: "id", value: "p1" }]);
  assert.ok("data" in result);
  if ("data" in result) {
    assert.equal(result.data.name, "Updated");
    assert.equal(result.data.stock, 0);
  }
});

test("product PATCH identifies invalid values for every scalar field", () => {
  const invalidValues: Record<string, unknown[]> = {
    name: [null, 5],
    category: [null, false],
    price: [null, "", "not-a-number", Number.NaN, Number.POSITIVE_INFINITY, 1.234, 99_999_999_999],
    stock: [null, -1, 1.5, "not-a-number", Number.POSITIVE_INFINITY, 2_147_483_648],
    image: [false, {}],
    description: [42, []],
    specs: [Number.NaN, new Date()],
    badge: [0, false],
    highlight: ["true", 1],
    oldPrice: ["", "invalid", Number.NaN, 1.001, 99_999_999_999],
    activateWholesale: ["false", 0],
    wholesaleMinQty: [null, -1, 1.5, "invalid", 2_147_483_648],
    wholesaleDiscountPercent: [null, -1, 1.5, "invalid", 101],
  };

  for (const [field, values] of Object.entries(invalidValues)) {
    for (const value of values) {
      const result = validateProductPatch({ [field]: value }, [{ column: "id", value: "p1" }]);
      assert.ok("error" in result, `${field} should reject ${String(value)}`);
      if ("error" in result) assert.equal(result.field, field);
    }
  }
});

test("product PATCH rejects empty payloads, missing or broad filters, relations and unknown properties", () => {
  const idFilter = [{ column: "id", value: "p1" }];
  const emptyPayload = validateProductPatch({}, idFilter);
  assert.ok("error" in emptyPayload);
  const noFilter = validateProductPatch({ name: "Updated" }, []);
  assert.ok("error" in noFilter);
  const broadFilter = validateProductPatch({ name: "Updated" }, [{ column: "name", value: "Updated" }]);
  assert.ok("error" in broadFilter);
  const multiFilter = validateProductPatch({ name: "Updated" }, [...idFilter, { column: "id", value: "p2" }]);
  assert.ok("error" in multiFilter);

  const rejected = validateProductPatch(
    { variants: [], categories: [], images: [], subproducts: [], id: "p2", unknown: true },
    idFilter,
  );
  assert.ok("error" in rejected);
  if ("error" in rejected) {
    assert.deepEqual(rejected.rejectedFields, ["variants", "categories", "images", "subproducts", "id", "unknown"]);
  }
});

test("product PATCH target helper distinguishes missing, unique and impossible duplicate matches", () => {
  assert.deepEqual(resolveProductPatchTarget([]), { kind: "not-found" });
  assert.deepEqual(resolveProductPatchTarget([{ id: "p1" }]), { kind: "found", product: { id: "p1" } });
  assert.deepEqual(resolveProductPatchTarget([{ id: "p1" }, { id: "p1" }]), { kind: "non-unique" });
});

test("stock snapshots accept unchanged product and variant stock and reject concurrent changes", () => {
  assert.equal(findStockSnapshotConflict("product", "p1", 8, 8, true), null);
  assert.equal(findStockSnapshotConflict("variant", "v1", 4, 4, true), null);
  assert.deepEqual(findStockSnapshotConflict("product", "p1", 8, 7, true), {
    entity: "product",
    id: "p1",
    expectedStock: 8,
    currentStock: 7,
    reason: "changed",
  });
  assert.deepEqual(findStockSnapshotConflict("variant", "v1", 4, 3, true), {
    entity: "variant",
    id: "v1",
    expectedStock: 4,
    currentStock: 3,
    reason: "changed",
  });
});

test("stock snapshots preserve omitted updates and allow new variants without fabricated snapshots", () => {
  assert.equal(findStockSnapshotConflict("product", "p1", undefined, 8, false), null);
  assert.equal(findStockSnapshotConflict("variant", "v1", undefined, 4, false), null);
  assert.equal(findStockSnapshotConflict("variant", "v-new", undefined, undefined, true), null);
  assert.deepEqual(findStockSnapshotConflict("variant", "v-deleted", 4, undefined, true), {
    entity: "variant",
    id: "v-deleted",
    expectedStock: 4,
    currentStock: null,
    reason: "missing",
  });
  assert.equal(findStockSnapshotConflict("product", "p1", undefined, 8, true)?.reason, "snapshot-required");
});

test("product batch transaction rolls back earlier rows when a later row aborts", async () => {
  const savedRows: string[] = [];
  const acquiredLocks: string[] = [];
  let transactionCalls = 0;
  const transaction = {
    $queryRaw: async (query: { values: unknown[] }) => {
      acquiredLocks.push(String(query.values.at(-1)));
      return [];
    },
  };
  const prisma = {
    $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) => {
      transactionCalls += 1;
      const before = [...savedRows];
      try {
        return await operation(transaction);
      } catch (error) {
        savedRows.splice(0, savedRows.length, ...before);
        throw error;
      }
    },
  } as unknown as Parameters<typeof withProductCatalogBatchTransaction>[0];

  await assert.rejects(
    withProductCatalogBatchTransaction(prisma, ["product-z", "product-a"], async (_transaction) => {
      assert.deepEqual(acquiredLocks, ["product-a", "product-z"]);
      const rows = [
        { id: "first-row", expectedStock: 5, currentStock: 5 },
        { id: "second-row", expectedStock: 5, currentStock: 4 },
      ];
      for (const row of rows) {
        if (findStockSnapshotConflict("product", row.id, row.expectedStock, row.currentStock, true)) {
          throw new Error("stock conflict on second row");
        }
        savedRows.push(row.id);
      }
    }),
    /stock conflict on second row/,
  );

  assert.equal(transactionCalls, 1);
  assert.deepEqual(savedRows, []);
});

test("absent or null variant images preserve persisted rows while an empty list requests removal", () => {
  assert.equal(resolveVariantImageUrls({}), null);
  assert.equal(resolveVariantImageUrls({ images: null }), null);
  assert.deepEqual(resolveVariantImageUrls({ images: [] }), []);
  assert.deepEqual(resolveVariantImageUrls({ images: [" /one.jpg ", { url: "/one.jpg" }, "/two.jpg"] }), ["/one.jpg", "/two.jpg"]);
});

test("a complete multi-variant list removes omissions and stores their tombstones", async () => {
  const { transaction, state } = makeTransaction({
    variants: [
      { id: "v1", productId: "p1", sortOrder: 0 },
      { id: "v2", productId: "p1", sortOrder: 1 },
      { id: "v3", productId: "p1", sortOrder: 2 },
      { id: "other", productId: "p2", sortOrder: 0 },
    ],
  });
  const list = resolveProductVariants({ subproducts: [{ id: "v1" }, { id: "v3" }] });

  assert.ok(list);
  await deleteOmittedProductVariants(transaction, "p1", list.map((variant) => String(variant.id)));

  assert.deepEqual(state.variants.map((variant) => variant.id), ["v1", "v3", "other"]);
  assert.deepEqual(state.variantExclusions, [{ variantId: "v2", productId: "p1" }]);
});

test("an explicit empty complete list removes all variants and records tombstones", async () => {
  const { transaction, state } = makeTransaction({
    variants: [
      { id: "v1", productId: "p1", sortOrder: 0 },
      { id: "v2", productId: "p1", sortOrder: 1 },
    ],
  });

  await deleteOmittedProductVariants(transaction, "p1", resolveProductVariants({ subproducts: [] })!.map((variant) => String(variant.id)));

  assert.deepEqual(state.variants, []);
  assert.deepEqual(state.variantExclusions, [
    { variantId: "v1", productId: "p1" },
    { variantId: "v2", productId: "p1" },
  ]);
});

test("same variant image URLs and order preserve persisted rows without writes", async () => {
  const original = [
    { id: "image-a", productId: "p1", variantId: "v1", url: "/one.jpg", sortOrder: 0, isPrimary: true },
    { id: "image-b", productId: "p1", variantId: "v1", url: "/two.jpg", sortOrder: 1, isPrimary: false },
  ];
  const { transaction, state } = makeTransaction({ images: original });

  const changed = await replaceVariantImagesIfChanged(transaction, "p1", "v1", ["/one.jpg", "/two.jpg"]);

  assert.equal(changed, false);
  assert.deepEqual(state.images, original);
  assert.equal(state.imageDeletes, 0);
  assert.equal(state.imageCreates, 0);
});

test("changed variant image URL replaces only its gallery", async () => {
  const { transaction, state } = makeTransaction({
    images: [
      { id: "image-a", productId: "p1", variantId: "v1", url: "/one.jpg", sortOrder: 0, isPrimary: true },
      { id: "image-b", productId: "p1", variantId: "v1", url: "/two.jpg", sortOrder: 1, isPrimary: false },
      { id: "foreign-image", productId: "p2", variantId: "v1", url: "/foreign.jpg", sortOrder: 0, isPrimary: true },
    ],
  });

  const changed = await replaceVariantImagesIfChanged(transaction, "p1", "v1", ["/one.jpg", "/changed.jpg"]);

  assert.equal(changed, true);
  assert.deepEqual(state.images.map(({ productId, variantId, url, sortOrder, isPrimary }) => ({ productId, variantId, url, sortOrder, isPrimary })), [
    { productId: "p2", variantId: "v1", url: "/foreign.jpg", sortOrder: 0, isPrimary: true },
    { productId: "p1", variantId: "v1", url: "/one.jpg", sortOrder: 0, isPrimary: true },
    { productId: "p1", variantId: "v1", url: "/changed.jpg", sortOrder: 1, isPrimary: false },
  ]);
});

test("changing only variant image order replaces only its gallery", async () => {
  const { transaction, state } = makeTransaction({
    images: [
      { id: "image-a", productId: "p1", variantId: "v1", url: "/one.jpg", sortOrder: 0, isPrimary: true },
      { id: "image-b", productId: "p1", variantId: "v1", url: "/two.jpg", sortOrder: 1, isPrimary: false },
    ],
  });

  const changed = await replaceVariantImagesIfChanged(transaction, "p1", "v1", ["/two.jpg", "/one.jpg"]);

  assert.equal(changed, true);
  assert.deepEqual(state.images.map(({ url, sortOrder, isPrimary }) => ({ url, sortOrder, isPrimary })), [
    { url: "/two.jpg", sortOrder: 0, isPrimary: true },
    { url: "/one.jpg", sortOrder: 1, isPrimary: false },
  ]);
  assert.equal(state.imageDeletes, 1);
  assert.equal(state.imageCreates, 2);
});

test("same product image URLs and order preserve persisted rows without writes", async () => {
  const original = [
    { id: "product-image-a", productId: "p1", variantId: null, url: "/cover.jpg", sortOrder: 0, isPrimary: true },
    { id: "product-image-b", productId: "p1", variantId: null, url: "/gallery.jpg", sortOrder: 1, isPrimary: false },
    { id: "variant-image", productId: "p1", variantId: "v1", url: "/variant.jpg", sortOrder: 0, isPrimary: true },
    { id: "other-product-image", productId: "p2", variantId: null, url: "/other.jpg", sortOrder: 0, isPrimary: true },
  ];
  const { transaction, state } = makeTransaction({ images: original });

  const changed = await replaceProductImagesIfChanged(transaction, "p1", ["/cover.jpg", "/gallery.jpg"]);

  assert.equal(changed, false);
  assert.deepEqual(state.images, original);
  assert.equal(state.imageDeletes, 0);
  assert.equal(state.imageCreates, 0);
});

test("changed product image URL replaces only that product gallery", async () => {
  const { transaction, state } = makeTransaction({
    images: [
      { id: "product-image-a", productId: "p1", variantId: null, url: "/cover.jpg", sortOrder: 0, isPrimary: true },
      { id: "product-image-b", productId: "p1", variantId: null, url: "/gallery.jpg", sortOrder: 1, isPrimary: false },
      { id: "variant-image", productId: "p1", variantId: "v1", url: "/variant.jpg", sortOrder: 0, isPrimary: true },
      { id: "other-product-image", productId: "p2", variantId: null, url: "/other.jpg", sortOrder: 0, isPrimary: true },
    ],
  });

  const changed = await replaceProductImagesIfChanged(transaction, "p1", ["/new-cover.jpg", "/gallery.jpg"]);

  assert.equal(changed, true);
  assert.deepEqual(state.images.map(({ productId, variantId, url, sortOrder, isPrimary }) => ({ productId, variantId, url, sortOrder, isPrimary })), [
    { productId: "p1", variantId: "v1", url: "/variant.jpg", sortOrder: 0, isPrimary: true },
    { productId: "p2", variantId: null, url: "/other.jpg", sortOrder: 0, isPrimary: true },
    { productId: "p1", variantId: null, url: "/new-cover.jpg", sortOrder: 0, isPrimary: true },
    { productId: "p1", variantId: null, url: "/gallery.jpg", sortOrder: 1, isPrimary: false },
  ]);
  assert.equal(state.imageDeletes, 1);
  assert.equal(state.imageCreates, 2);
});

test("changing only product image order updates sort order and primary flag", async () => {
  const { transaction, state } = makeTransaction({
    images: [
      { id: "product-image-a", productId: "p1", variantId: null, url: "/cover.jpg", sortOrder: 0, isPrimary: true },
      { id: "product-image-b", productId: "p1", variantId: null, url: "/gallery.jpg", sortOrder: 1, isPrimary: false },
    ],
  });

  const changed = await replaceProductImagesIfChanged(transaction, "p1", ["/gallery.jpg", "/cover.jpg"]);

  assert.equal(changed, true);
  assert.deepEqual(state.images.map(({ url, sortOrder, isPrimary }) => ({ url, sortOrder, isPrimary })), [
    { url: "/gallery.jpg", sortOrder: 0, isPrimary: true },
    { url: "/cover.jpg", sortOrder: 1, isPrimary: false },
  ]);
  assert.equal(state.imageDeletes, 1);
  assert.equal(state.imageCreates, 2);
});

test("POST reread and GET catalog read expose the same persisted variants and images", async () => {
  const { transaction, state } = makeTransaction({
    products: [{ id: "p1", name: "Product" }],
    variants: [{ id: "v1", productId: "p1", sortOrder: 0 }],
    images: [{ id: "image-a", productId: "p1", variantId: "v1", url: "/one.jpg", sortOrder: 0, isPrimary: true }],
  });

  const postResponseProduct = await readProductWithCatalogRelations(transaction, "p1");
  const getResponseProducts = await readProductsWithCatalogRelations(transaction);

  assert.deepEqual(postResponseProduct, getResponseProducts[0]);
  assert.deepEqual(postResponseProduct?.variants[0].images.map((image) => image.url), ["/one.jpg"]);
  assert.equal(state.variants.length, 1);
});
