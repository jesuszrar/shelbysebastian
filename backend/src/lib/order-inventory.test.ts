import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "@prisma/client";
import { decrementOrderInventory } from "./order-inventory.js";

const makeTransaction = (variantUpdateCounts: number[] = [], productUpdateCounts: number[] = []) => {
  const events: Array<{ kind: string; args?: Record<string, unknown> }> = [];
  let variantUpdateIndex = 0;
  let productUpdateIndex = 0;
  const transaction = {
    $queryRaw: async (query: { values: unknown[] }) => {
      events.push({ kind: "lock", args: { productId: query.values.at(-1) } });
      return [];
    },
    product: {
      updateMany: async (args: Record<string, unknown>) => {
        events.push({ kind: "product-update", args });
        const count = productUpdateCounts[productUpdateIndex] ?? 1;
        productUpdateIndex += 1;
        return { count };
      },
    },
    productVariant: {
      updateMany: async (args: Record<string, unknown>) => {
        events.push({ kind: "variant-update", args });
        const count = variantUpdateCounts[variantUpdateIndex] ?? 1;
        variantUpdateIndex += 1;
        return { count };
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { transaction, events };
};

test("order stock decrement locks all distinct parent products before atomic product and variant updates", async () => {
  const { transaction, events } = makeTransaction();

  await decrementOrderInventory(transaction, [
    { productId: "product-z", variantId: "variant-z", quantity: 2 },
    { productId: "product-a", variantId: null, quantity: 1 },
    { productId: "product-z", variantId: null, quantity: 3 },
  ]);

  assert.deepEqual(events.slice(0, 2), [
    { kind: "lock", args: { productId: "product-a" } },
    { kind: "lock", args: { productId: "product-z" } },
  ]);
  assert.deepEqual(events.slice(2).map((event) => event.kind), [
    "variant-update",
    "product-update",
    "product-update",
  ]);
  assert.deepEqual(events[2].args, {
    where: {
      id: "variant-z",
      productId: "product-z",
      stock: { gte: 2 },
      active: true,
    },
    data: { stock: { decrement: 2 } },
  });
  assert.deepEqual(events[3].args, {
    where: { id: "product-a", stock: { gte: 1 } },
    data: { stock: { decrement: 1 } },
  });
});

test("failed conditional variant decrement aborts remaining order inventory operations", async () => {
  const { transaction, events } = makeTransaction([0]);

  await assert.rejects(
    decrementOrderInventory(transaction, [
      { productId: "product-a", variantId: null, quantity: 1 },
      { productId: "product-b", variantId: "variant-b", quantity: 1 },
      { productId: "product-c", variantId: null, quantity: 1 },
    ]),
    /Stock insuficiente para la variante/,
  );

  assert.deepEqual(events.map((event) => event.kind), [
    "lock",
    "lock",
    "lock",
    "product-update",
    "variant-update",
  ]);
});

test("failed conditional product decrement aborts remaining order inventory operations", async () => {
  const { transaction, events } = makeTransaction([], [0]);

  await assert.rejects(
    decrementOrderInventory(transaction, [
      { productId: "product-a", variantId: null, quantity: 1 },
      { productId: "product-b", variantId: null, quantity: 1 },
    ]),
    /Stock insuficiente para el producto/,
  );

  assert.deepEqual(events.map((event) => event.kind), [
    "lock",
    "lock",
    "product-update",
  ]);
});
