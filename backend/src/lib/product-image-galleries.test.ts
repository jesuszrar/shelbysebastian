import assert from "node:assert/strict";
import test from "node:test";

import { normalizeProductImageUrls, separateProductImageGalleries } from "./product-image-galleries.js";

test("normalizes duplicate URLs and preserves the first appearance order", () => {
  assert.deepEqual(normalizeProductImageUrls([
    " /images/./one.jpg ",
    "/images/one.jpg",
    "/images/two.jpg",
    "/images/one.jpg",
    "https://cdn.example.com/a/../one.jpg",
    "https://cdn.example.com/one.jpg",
    "https://cdn.example.com/one.jpg?size=large",
  ]), [
    "/images/./one.jpg",
    "/images/two.jpg",
    "https://cdn.example.com/a/../one.jpg",
    "https://cdn.example.com/one.jpg?size=large",
  ]);
});

test("drops empty and invalid image inputs", () => {
  assert.deepEqual(normalizeProductImageUrls([
    "",
    "   ",
    null,
    42,
    {},
    { url: "  " },
    { url: "/valid.jpg" },
  ]), ["/valid.jpg"]);
});

test("serializes parent and variant galleries by relation rather than URL", () => {
  const sharedUrl = "/products/shared.jpg";
  const parentImage = { id: "parent-image", productId: "p1", variantId: null, url: sharedUrl };
  const variantImage = { id: "variant-image", productId: "p1", variantId: "v1", url: sharedUrl };
  const otherVariantImage = { id: "other-variant-image", productId: "p1", variantId: "v2", url: "/v2.jpg" };

  const result = separateProductImageGalleries(
    [
      { id: "v1", images: [variantImage, otherVariantImage] },
      { id: "v2", images: [otherVariantImage, variantImage] },
    ],
    [parentImage, variantImage, otherVariantImage],
  );

  assert.deepEqual(result.images, [parentImage]);
  assert.deepEqual((result.variants[0] as { images: unknown[] }).images, [variantImage]);
  assert.deepEqual((result.variants[1] as { images: unknown[] }).images, [otherVariantImage]);
  assert.equal((result.images[0]).url, (result.variants[0] as { images: Array<{ url: string }> }).images[0].url);
});

test("does not invent image galleries when variant relations are absent", () => {
  const result = separateProductImageGalleries(
    [{ id: "v1", images: null }, { id: "v2" }],
    [{ id: "parent", variantId: null, url: "/parent.jpg" }],
  );

  assert.deepEqual(result.variants, [{ id: "v1", images: null }, { id: "v2" }]);
  assert.deepEqual(result.images, [{ id: "parent", variantId: null, url: "/parent.jpg" }]);
});
