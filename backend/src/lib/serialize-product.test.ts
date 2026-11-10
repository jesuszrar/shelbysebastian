import assert from "node:assert/strict";
import test from "node:test";

import { serializeProduct } from "./serialize-product.js";

test("serializes separate galleries and preserves shared-URL records and product fields", () => {
  const sharedUrl = "/products/shared.jpg";
  const result = serializeProduct({
    id: "p1",
    name: "Product",
    price: 250,
    stock: 7,
    description: "Product description",
    categories: [{ category: { id: "c1", name: "Category" } }],
    images: [
      { id: "parent-image", variantId: null, url: sharedUrl },
      { id: "variant-image", variantId: "v1", url: sharedUrl },
    ],
    variants: [
      {
        id: "v1",
        name: "Variant 1",
        images: [
          { id: "variant-image", variantId: "v1", url: sharedUrl },
          { id: "other-variant-image", variantId: "v2", url: "/other.jpg" },
        ],
      },
      { id: "v2", name: "Variant 2", images: [{ id: "other-variant-image", variantId: "v2", url: "/other.jpg" }] },
    ],
  });

  assert.deepEqual(result, {
    id: "p1",
    name: "Product",
    price: 250,
    stock: 7,
    description: "Product description",
    categories: [{ id: "c1", name: "Category" }],
    images: [{ id: "parent-image", variantId: null, url: sharedUrl }],
    variants: [
      {
        id: "v1",
        name: "Variant 1",
        images: [{ id: "variant-image", variantId: "v1", url: sharedUrl }],
      },
      {
        id: "v2",
        name: "Variant 2",
        images: [{ id: "other-variant-image", variantId: "v2", url: "/other.jpg" }],
      },
    ],
  });
});
