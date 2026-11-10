import assert from "node:assert/strict";
import test from "node:test";
import { moveCategoryInOrder } from "./category-order.js";

test("normaliza posiciones duplicadas al mover una categoria hacia arriba", () => {
  const result = moveCategoryInOrder(
    [
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 0 },
      { id: "c", sortOrder: 1 },
    ],
    "c",
    "up",
  );

  assert.equal(result.moved, true);
  assert.deepEqual(
    result.rows.map(({ id, sortOrder }) => ({ id, sortOrder })),
    [
      { id: "a", sortOrder: 0 },
      { id: "c", sortOrder: 1 },
      { id: "b", sortOrder: 2 },
    ],
  );
});

test("mueve una categoria hacia abajo y conserva el orden de las demas", () => {
  const result = moveCategoryInOrder(
    [
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 1 },
      { id: "c", sortOrder: 2 },
    ],
    "a",
    "down",
  );

  assert.equal(result.moved, true);
  assert.deepEqual(result.rows.map((row) => row.id), ["b", "a", "c"]);
  assert.deepEqual(result.rows.map((row) => row.sortOrder), [0, 1, 2]);
});

test("no permite mover la primera categoria hacia arriba", () => {
  const result = moveCategoryInOrder(
    [
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 1 },
    ],
    "a",
    "up",
  );

  assert.equal(result.moved, false);
  assert.equal(result.boundary, true);
  assert.deepEqual(result.rows.map((row) => row.id), ["a", "b"]);
});

test("no permite mover la ultima categoria hacia abajo", () => {
  const result = moveCategoryInOrder(
    [
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 1 },
    ],
    "b",
    "down",
  );

  assert.equal(result.moved, false);
  assert.equal(result.boundary, true);
});

test("identifica una categoria inexistente", () => {
  const result = moveCategoryInOrder(
    [{ id: "a", sortOrder: 0 }],
    "missing",
    "up",
  );

  assert.equal(result.notFound, true);
  assert.equal(result.moved, false);
});

test("desempata posiciones repetidas por id de forma determinista", () => {
  const result = moveCategoryInOrder(
    [
      { id: "c", sortOrder: 0 },
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 0 },
    ],
    "b",
    "up",
  );

  assert.deepEqual(result.rows.map((row) => row.id), ["b", "a", "c"]);
  assert.deepEqual(result.rows.map((row) => row.sortOrder), [0, 1, 2]);
});
test("conserva los campos adicionales de cada categoria al reordenar", () => {
  const result = moveCategoryInOrder(
    [
      { id: "a", sortOrder: 0, name: "Combos", active: true },
      { id: "b", sortOrder: 1, name: "Scanner", active: false },
    ],
    "b",
    "up",
  );

  assert.deepEqual(result.rows, [
    { id: "b", sortOrder: 0, name: "Scanner", active: false },
    { id: "a", sortOrder: 1, name: "Combos", active: true },
  ]);
});
