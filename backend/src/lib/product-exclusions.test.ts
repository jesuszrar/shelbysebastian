import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";
import { createLegacyVariantUnlessExcluded, deleteProductsWithExclusions } from "./product-exclusions.js";

const makeClient = (seed: {
  products?: Array<{ id: string }>;
  variants?: Array<{ id: string; productId: string }>;
  productExclusions?: Array<{ productId: string }>;
  variantExclusions?: Array<{ variantId: string; productId: string }>;
} = {}, failProductDelete = false) => {
  const state = {
    products: [...(seed.products ?? [])],
    variants: [...(seed.variants ?? [])],
    productExclusions: [...(seed.productExclusions ?? [])],
    variantExclusions: [...(seed.variantExclusions ?? [])],
    createdVariants: [] as Array<Record<string, unknown>>,
    operations: [] as string[],
  };
  const client: any = {};

  client.$queryRaw = async () => {
    state.operations.push("lock");
    return [];
  };
  client.product = {
    findMany: async ({ where }: any = {}) => state.products.filter((product) => !where?.id?.in || where.id.in.includes(product.id)),
    findUnique: async ({ where }: any) => state.products.find((product) => product.id === where.id) ?? null,
    deleteMany: async ({ where }: any) => {
      state.operations.push("product.deleteMany");
      if (failProductDelete) throw new Error("simulated delete failure");
      const ids = new Set(where.id.in as string[]);
      const before = state.products.length;
      state.products = state.products.filter((product) => !ids.has(product.id));
      state.variants = state.variants.filter((variant) => !ids.has(variant.productId));
      return { count: before - state.products.length };
    },
  };
  client.productVariant = {
    findMany: async ({ where }: any) => state.variants.filter((variant) => where.productId.in.includes(variant.productId)),
    findUnique: async ({ where }: any) => state.variants.find((variant) => variant.id === where.id) ?? null,
    create: async ({ data }: any) => {
      state.createdVariants.push(data);
      state.variants.push({ id: data.id, productId: data.productId });
      return data;
    },
  };
  client.productImage = { create: async () => ({}) };
  client.productExclusion = {
    findUnique: async ({ where }: any) => state.productExclusions.find((item) => item.productId === where.productId) ?? null,
    createMany: async ({ data }: any) => {
      state.operations.push("productExclusion.createMany");
      for (const item of data) {
        if (!state.productExclusions.some((existing) => existing.productId === item.productId)) state.productExclusions.push(item);
      }
      return { count: data.length };
    },
  };
  client.productVariantExclusion = {
    findUnique: async ({ where }: any) => state.variantExclusions.find((item) => item.variantId === where.variantId) ?? null,
    createMany: async ({ data }: any) => {
      state.operations.push("productVariantExclusion.createMany");
      for (const item of data) {
        if (!state.variantExclusions.some((existing) => existing.variantId === item.variantId)) state.variantExclusions.push(item);
      }
      return { count: data.length };
    },
  };
  client.$transaction = async (callback: (transaction: unknown) => Promise<unknown>) => {
    const snapshot = structuredClone(state);
    try {
      return await callback(client);
    } catch (error) {
      state.products = snapshot.products;
      state.variants = snapshot.variants;
      state.productExclusions = snapshot.productExclusions;
      state.variantExclusions = snapshot.variantExclusions;
      state.createdVariants = snapshot.createdVariants;
      state.operations = snapshot.operations;
      throw error;
    }
  };

  return { client: client as PrismaClient, state };
};

test("product deletion records product and variant exclusions before deleting", async () => {
  const { client, state } = makeClient({
    products: [{ id: "p-static" }],
    variants: [{ id: "v-static", productId: "p-static" }],
  });

  const deleted = await client.$transaction((transaction) => deleteProductsWithExclusions(transaction, ["p-static"]));

  assert.equal(deleted, 1);
  assert.deepEqual(state.productExclusions, [{ productId: "p-static" }]);
  assert.deepEqual(state.variantExclusions, [{ variantId: "v-static", productId: "p-static" }]);
  assert.equal(state.products.length, 0);
  assert.ok(state.operations.indexOf("productExclusion.createMany") < state.operations.indexOf("product.deleteMany"));
});

test("an explicit deletion ID is tombstoned even before its first import creates a row", async () => {
  const { client, state } = makeClient();

  const deleted = await client.$transaction((transaction) => deleteProductsWithExclusions(transaction, ["not-imported-yet"]));

  assert.equal(deleted, 0);
  assert.deepEqual(state.productExclusions, [{ productId: "not-imported-yet" }]);
  assert.deepEqual(state.operations, ["lock", "productExclusion.createMany"]);
});

test("failed product deletion rolls back tombstones and product state", async () => {
  const { client, state } = makeClient({
    products: [{ id: "p-static" }],
    variants: [{ id: "v-static", productId: "p-static" }],
  }, true);

  await assert.rejects(
    client.$transaction((transaction) => deleteProductsWithExclusions(transaction, ["p-static"])),
    /simulated delete failure/,
  );
  assert.deepEqual(state.products, [{ id: "p-static" }]);
  assert.deepEqual(state.productExclusions, []);
  assert.deepEqual(state.variantExclusions, []);
});

test("legacy normalizer does not recreate a product-excluded variant or create its parent", async () => {
  const { client, state } = makeClient({ productExclusions: [{ productId: "p-deleted" }] });

  const result = await client.$transaction((transaction) => createLegacyVariantUnlessExcluded(transaction, {
    productId: "p-deleted",
    variantId: "v-static",
    name: "Legacy",
    description: null,
    image: null,
    price: 10,
    stock: 2,
    sortOrder: 0,
  }));

  assert.equal(result, "excluded-product");
  assert.deepEqual(state.products, []);
  assert.deepEqual(state.createdVariants, []);
});

test("legacy normalizer skips a variant tombstone", async () => {
  const { client, state } = makeClient({
    products: [{ id: "p-static" }],
    variantExclusions: [{ variantId: "v-deleted", productId: "p-static" }],
  });

  const result = await client.$transaction((transaction) => createLegacyVariantUnlessExcluded(transaction, {
    productId: "p-static",
    variantId: "v-deleted",
    name: "Legacy",
    description: null,
    image: null,
    price: 10,
    stock: 2,
    sortOrder: 0,
  }));

  assert.equal(result, "excluded-variant");
  assert.deepEqual(state.createdVariants, []);
});

test("legacy normalizer still imports a new variant for an existing non-excluded product", async () => {
  const { client, state } = makeClient({ products: [{ id: "p-static" }] });

  const result = await client.$transaction((transaction) => createLegacyVariantUnlessExcluded(transaction, {
    productId: "p-static",
    variantId: "v-new",
    name: "New variant",
    description: null,
    image: null,
    price: 10,
    stock: 2,
    sortOrder: 0,
  }));

  assert.equal(result, "created");
  assert.deepEqual(state.createdVariants.map((variant) => variant.id), ["v-new"]);
});
