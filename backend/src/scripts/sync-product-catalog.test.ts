import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";
import type { ProductCatalogItem } from "./product-catalog-data.js";
import { syncProductCatalog } from "./sync-product-catalog.js";

type SyncState = {
  products: Array<Record<string, any>>;
  variants: Array<Record<string, any>>;
  images: Array<Record<string, any>>;
  productExclusions: Array<{ productId: string }>;
  variantExclusions: Array<{ variantId: string; productId: string }>;
  operations: string[];
  variantWrites: Array<{ operation: "create" | "update"; variantId: string }>;
  imageWrites: Array<{ operation: "create" | "update" | "delete" | "deleteMany"; productId?: string; variantId?: string | null }>;
};

const makeProduct = (id: string, subproducts: ProductCatalogItem["subproducts"] = []): ProductCatalogItem => ({
  id,
  name: `Product ${id}`,
  category: "Adhesivas",
  image: `/products/${id}.jpg`,
  price: 100,
  description: "Static catalog product",
  specs: [],
  subproducts,
});

const makeSyncClient = (
  seed: Partial<SyncState> = {},
  options: {
    tombstoneOnLock?: string;
    variantOwnerOnLock?: { variantId: string; productId: string };
    variantExclusionOnLock?: { variantId: string; productId: string };
    failVariantCreate?: boolean;
  } = {},
) => {
  const state: SyncState = {
    products: [...(seed.products ?? [])],
    variants: [...(seed.variants ?? [])],
    images: [...(seed.images ?? [])],
    productExclusions: [...(seed.productExclusions ?? [])],
    variantExclusions: [...(seed.variantExclusions ?? [])],
    operations: [],
    variantWrites: [],
    imageWrites: [],
  };
  const client: any = {};
  const snapshot = () => structuredClone({
    products: state.products,
    variants: state.variants,
    images: state.images,
    productExclusions: state.productExclusions,
    variantExclusions: state.variantExclusions,
  });
  const restore = (saved: ReturnType<typeof snapshot>) => {
    state.products = saved.products;
    state.variants = saved.variants;
    state.images = saved.images;
    state.productExclusions = saved.productExclusions;
    state.variantExclusions = saved.variantExclusions;
  };

  client.$queryRaw = async () => {
    state.operations.push("lock");
    if (options.tombstoneOnLock && !state.productExclusions.some((row) => row.productId === options.tombstoneOnLock)) {
      state.productExclusions.push({ productId: options.tombstoneOnLock });
    }
    if (options.variantOwnerOnLock) {
      const variant = state.variants.find((item) => item.id === options.variantOwnerOnLock?.variantId);
      if (variant) variant.productId = options.variantOwnerOnLock.productId;
    }
    if (options.variantExclusionOnLock && !state.variantExclusions.some((item) => item.variantId === options.variantExclusionOnLock?.variantId)) {
      state.variantExclusions.push(options.variantExclusionOnLock);
    }
    return [];
  };
  client.product = {
    findMany: async ({ where }: any = {}) => !where?.id?.in ? [...state.products] : state.products.filter((row) => where.id.in.includes(row.id)),
    create: async ({ data }: any) => {
      state.operations.push("product.create");
      const row = { ...data };
      state.products.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      state.operations.push("product.update");
      const row = state.products.find((item) => item.id === where.id);
      if (!row) throw new Error(`missing product ${where.id}`);
      Object.assign(row, data);
      return row;
    },
  };
  client.productVariant = {
    findMany: async () => [...state.variants],
    create: async ({ data }: any) => {
      state.operations.push("productVariant.create");
      state.variantWrites.push({ operation: "create", variantId: data.id });
      if (options.failVariantCreate) throw new Error("simulated variant insert failure");
      const row = { id: data.id, productId: data.product.connect.id, ...data };
      state.variants.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      state.operations.push("productVariant.update");
      state.variantWrites.push({ operation: "update", variantId: where.id });
      const row = state.variants.find((item) => item.id === where.id);
      if (!row) throw new Error(`missing variant ${where.id}`);
      Object.assign(row, data);
      return row;
    },
  };
  client.productImage = {
    findMany: async () => [...state.images],
    create: async ({ data }: any) => {
      state.operations.push("productImage.create");
      state.imageWrites.push({ operation: "create", productId: data.productId, variantId: data.variantId });
      state.images.push(data);
      return data;
    },
    update: async ({ where, data }: any) => {
      state.operations.push("productImage.update");
      const image = state.images.find((item) => item.id === where.id);
      if (!image) throw new Error(`missing image ${where.id}`);
      state.imageWrites.push({ operation: "update", productId: image.productId, variantId: image.variantId });
      Object.assign(image, data);
      return image;
    },
    delete: async ({ where }: any) => {
      state.operations.push("productImage.delete");
      const index = state.images.findIndex((item) => item.id === where.id);
      if (index < 0) throw new Error(`missing image ${where.id}`);
      state.imageWrites.push({ operation: "delete", productId: state.images[index].productId, variantId: state.images[index].variantId });
      return state.images.splice(index, 1)[0];
    },
    deleteMany: async ({ where }: any) => {
      state.operations.push("productImage.deleteMany");
      state.imageWrites.push({ operation: "deleteMany", productId: where.productId, variantId: where.variantId });
      const before = state.images.length;
      state.images = state.images.filter((item) => !where.variantId || item.variantId !== where.variantId);
      return { count: before - state.images.length };
    },
  };
  client.productVariantExclusion = {
    findMany: async ({ where }: any = {}) => !where?.variantId?.in
      ? [...state.variantExclusions]
      : state.variantExclusions.filter((row) => where.variantId.in.includes(row.variantId)),
  };
  client.productExclusion = {
    findMany: async ({ where }: any = {}) => !where?.productId?.in
      ? [...state.productExclusions]
      : state.productExclusions.filter((row) => where.productId.in.includes(row.productId)),
  };
  client.$transaction = async (callback: (transaction: unknown) => Promise<unknown>) => {
    const saved = snapshot();
    try {
      return await callback(client);
    } catch (error) {
      restore(saved);
      throw error;
    }
  };

  return { client: client as PrismaClient, state };
};

const variant = (id: string) => ({
  id,
  name: `Variant ${id}`,
  image: `/variants/${id}.jpg`,
  description: "Static variant",
  price: 10,
  stock: 4,
});

test("imports a static product and its non-excluded variant on first sync", async () => {
  const { client, state } = makeSyncClient();

  await syncProductCatalog(client, [makeProduct("new-static", [variant("new-variant")])]);

  assert.deepEqual(state.products.map((product) => product.id), ["new-static"]);
  assert.deepEqual(state.variants.map((item) => item.id), ["new-variant"]);
});

test("does not recreate a product with a persistent product tombstone", async () => {
  const { client, state } = makeSyncClient({ productExclusions: [{ productId: "deleted-static" }] });

  await syncProductCatalog(client, [makeProduct("deleted-static", [variant("deleted-variant")])]);

  assert.deepEqual(state.products, []);
  assert.deepEqual(state.variants, []);
  assert.deepEqual(state.images, []);
  assert.equal(state.operations.includes("product.create"), false);
});

test("does not recreate an excluded variant under a non-excluded product", async () => {
  const { client, state } = makeSyncClient({
    products: [{ id: "existing-static", name: "Product existing-static", category: "Adhesivas", price: 100, stock: 0, image: "/products/existing-static.jpg", description: "Static catalog product", specs: null, badge: null, oldPrice: null, highlight: false }],
    variantExclusions: [{ variantId: "deleted-variant", productId: "existing-static" }],
  });

  await syncProductCatalog(client, [makeProduct("existing-static", [variant("deleted-variant")])]);

  assert.deepEqual(state.variants, []);
  assert.equal(state.images.some((image) => image.variantId === "deleted-variant"), false);
});

test("rechecks variant exclusions after locking and skips only the excluded variant and its images", async () => {
  const excludedParent = makeProduct("excluded-parent", [variant("excluded-variant")]);
  const unaffectedProduct = makeProduct("unaffected-parent", [variant("unaffected-variant")]);
  const existingParent = {
    id: excludedParent.id,
    name: excludedParent.name,
    category: excludedParent.category,
    price: excludedParent.price,
    stock: 8,
    image: excludedParent.image,
    description: "Old product description",
    specs: [],
    badge: null,
    oldPrice: null,
    highlight: false,
  };
  const existingVariant = {
    id: "excluded-variant",
    productId: excludedParent.id,
    name: "Old variant name",
    description: "Old variant description",
    image: "/variants/old-excluded-variant.jpg",
    active: true,
    sortOrder: 0,
    price: 9,
    stock: 5,
  };
  const existingImages = [
    {
      id: "excluded-parent-image",
      productId: excludedParent.id,
      variantId: null,
      url: excludedParent.image,
      sortOrder: 0,
      isPrimary: true,
    },
    {
      id: "excluded-variant-image",
      productId: excludedParent.id,
      variantId: existingVariant.id,
      url: existingVariant.image,
      sortOrder: 0,
      isPrimary: true,
    },
  ];
  const { client, state } = makeSyncClient({
    products: [existingParent],
    variants: [existingVariant],
    images: existingImages,
  }, {
    variantExclusionOnLock: { variantId: existingVariant.id, productId: excludedParent.id },
  });
  const existingVariantBeforeSync = structuredClone(existingVariant);
  const excludedVariantImagesBeforeSync = structuredClone(state.images.filter((image) => image.variantId === existingVariant.id));

  await syncProductCatalog(client, [excludedParent, unaffectedProduct]);

  assert.deepEqual(state.variantExclusions, [{ variantId: existingVariant.id, productId: excludedParent.id }]);
  assert.deepEqual(state.variants.find((item) => item.id === existingVariant.id), existingVariantBeforeSync);
  assert.deepEqual(state.images.filter((image) => image.variantId === existingVariant.id), excludedVariantImagesBeforeSync);
  assert.equal(state.variantWrites.some((write) => write.variantId === existingVariant.id), false);
  assert.equal(state.imageWrites.some((write) => write.variantId === existingVariant.id), false);
  assert.equal(state.products.find((item) => item.id === excludedParent.id)?.description, excludedParent.description);
  assert.ok(state.products.some((item) => item.id === unaffectedProduct.id));
  assert.ok(state.variants.some((item) => item.id === "unaffected-variant"));
  assert.ok(state.variantWrites.some((write) => write.operation === "create" && write.variantId === "unaffected-variant"));
  assert.ok(state.imageWrites.some((write) => write.operation === "create" && write.productId === unaffectedProduct.id));
  assert.ok(state.imageWrites.some((write) => write.operation === "create" && write.variantId === "unaffected-variant"));
});

test("continues syncing non-excluded products and variants", async () => {
  const { client, state } = makeSyncClient();

  await syncProductCatalog(client, [makeProduct("allowed-static", [variant("allowed-variant")])]);

  assert.deepEqual(state.products.map((product) => product.id), ["allowed-static"]);
  assert.deepEqual(state.variants.map((item) => item.id), ["allowed-variant"]);
});

test("automatic updates preserve existing product and variant stock", async () => {
  const sourceVariant = { ...variant("stock-variant"), name: "Updated variant" };
  const sourceProduct: ProductCatalogItem = {
    ...makeProduct("stock-product", [sourceVariant]),
    stock: 2,
    description: "Updated product description",
  };
  const { client, state } = makeSyncClient({
    products: [{
      id: "stock-product",
      name: sourceProduct.name,
      category: sourceProduct.category,
      price: sourceProduct.price,
      stock: 41,
      image: sourceProduct.image,
      description: "Previous product description",
      specs: [],
      badge: null,
      oldPrice: null,
      highlight: false,
    }],
    variants: [{
      id: sourceVariant.id,
      productId: sourceProduct.id,
      name: "Previous variant",
      description: sourceVariant.description ?? null,
      image: sourceVariant.image,
      active: true,
      sortOrder: 0,
      price: sourceVariant.price,
      stock: 73,
    }],
  });

  await syncProductCatalog(client, [sourceProduct]);

  assert.equal(state.products[0].stock, 41);
  assert.equal(state.variants[0].stock, 73);
  assert.ok(state.operations.includes("product.update"));
  assert.ok(state.operations.includes("productVariant.update"));
});

test("rejects a static variant owned by another product before writing or changing its images", async () => {
  const owner = {
    id: "original-owner",
    name: "Original owner",
    category: "Adhesivas",
    price: 100,
    stock: 8,
    image: "/products/original-owner.jpg",
    description: "Original product",
    specs: null,
    badge: null,
    oldPrice: null,
    highlight: false,
  };
  const requester = {
    id: "requesting-product",
    name: "Requesting product",
    category: "Adhesivas",
    price: 100,
    stock: 3,
    image: "/products/requesting-product.jpg",
    description: "Unchanged requester",
    specs: null,
    badge: null,
    oldPrice: null,
    highlight: false,
  };
  const ownedVariant = {
    id: "owned-variant",
    productId: owner.id,
    name: "Original variant",
    description: "Original variant description",
    image: "/variants/original.jpg",
    active: true,
    sortOrder: 0,
    price: 10,
    stock: 4,
  };
  const originalImages = [
    { id: "variant-image", productId: owner.id, variantId: ownedVariant.id, url: "/variants/original.jpg", sortOrder: 0, isPrimary: true },
  ];
  const { client, state } = makeSyncClient({
    products: [owner, requester],
    variants: [ownedVariant],
    images: originalImages,
  });
  const productsBeforeSync = structuredClone(state.products);
  const variantsBeforeSync = structuredClone(state.variants);
  const imagesBeforeSync = structuredClone(state.images);

  await assert.rejects(
    syncProductCatalog(client, [makeProduct(requester.id, [variant(ownedVariant.id)])]),
    /La variante owned-variant pertenece al producto original-owner, pero el catálogo estático la asigna al producto requesting-product/,
  );

  assert.deepEqual(state.products, productsBeforeSync);
  assert.deepEqual(state.variants, variantsBeforeSync);
  assert.deepEqual(state.images, imagesBeforeSync);
  assert.deepEqual(state.operations, []);
});

test("rechecks variant ownership after locking before writing products, variants or images", async () => {
  const owner = {
    id: "requesting-product",
    name: "Original owner",
    category: "Adhesivas",
    price: 100,
    stock: 8,
    image: "/products/requesting-product.jpg",
    description: "Original product",
    specs: null,
    badge: null,
    oldPrice: null,
    highlight: false,
  };
  const otherOwnerId = "concurrent-owner";
  const ownedVariant = {
    id: "racing-variant",
    productId: owner.id,
    name: "Original variant",
    description: "Original variant description",
    image: "/variants/original.jpg",
    active: true,
    sortOrder: 0,
    price: 10,
    stock: 4,
  };
  const originalImages = [
    { id: "racing-image", productId: owner.id, variantId: ownedVariant.id, url: "/variants/original.jpg", sortOrder: 0, isPrimary: true },
  ];
  const { client, state } = makeSyncClient({
    products: [owner],
    variants: [ownedVariant],
    images: originalImages,
  }, {
    variantOwnerOnLock: { variantId: ownedVariant.id, productId: otherOwnerId },
  });
  const productsBeforeSync = structuredClone(state.products);
  const variantsBeforeSync = structuredClone(state.variants);
  const imagesBeforeSync = structuredClone(state.images);

  await assert.rejects(
    syncProductCatalog(client, [makeProduct(owner.id, [variant(ownedVariant.id)])]),
    /La variante racing-variant pertenece al producto concurrent-owner, pero el catálogo estático la asigna al producto requesting-product/,
  );

  assert.deepEqual(state.products, productsBeforeSync);
  assert.deepEqual(state.variants, variantsBeforeSync);
  assert.deepEqual(state.images, imagesBeforeSync);
  assert.deepEqual(state.operations, ["lock"]);
});

test("rechecks product tombstones after locking and before creating a stale planned product", async () => {
  const { client, state } = makeSyncClient({}, { tombstoneOnLock: "raced-static" });

  await syncProductCatalog(client, [makeProduct("raced-static", [variant("raced-variant")])]);

  assert.deepEqual(state.productExclusions, [{ productId: "raced-static" }]);
  assert.deepEqual(state.products, []);
  assert.deepEqual(state.variants, []);
  assert.deepEqual(state.operations, ["lock"]);
});

test("transaction rollback leaves no partial product when a later variant insert fails", async () => {
  const { client, state } = makeSyncClient({}, { failVariantCreate: true });

  await assert.rejects(syncProductCatalog(client, [makeProduct("rollback-static", [variant("rollback-variant")])]), /simulated variant insert failure/);

  assert.deepEqual(state.products, []);
  assert.deepEqual(state.variants, []);
  assert.deepEqual(state.images, []);
});
