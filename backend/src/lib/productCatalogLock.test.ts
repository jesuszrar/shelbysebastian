import assert from "node:assert/strict";
import test from "node:test";

import { lockProductCatalogIds } from "./productCatalogLock.js";

test("product catalog locks deduplicate IDs and acquire them in stable sorted order", async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const transaction = {
    $queryRaw: async (query: { sql: string; values: unknown[] }) => {
      queries.push(query);
      return [];
    },
  } as unknown as Parameters<typeof lockProductCatalogIds>[0];

  await lockProductCatalogIds(transaction, ["product-z", "product-a", "product-z", ""]);

  assert.deepEqual(queries.map((query) => query.values.at(-1)), ["product-a", "product-z"]);
  assert.ok(queries.every((query) => query.sql.includes("pg_advisory_xact_lock")));
});

test("product catalog lock helper does not issue SQL for an empty ID list", async () => {
  let queryCount = 0;
  const transaction = {
    $queryRaw: async () => {
      queryCount += 1;
      return [];
    },
  } as unknown as Parameters<typeof lockProductCatalogIds>[0];

  await lockProductCatalogIds(transaction, []);

  assert.equal(queryCount, 0);
});
