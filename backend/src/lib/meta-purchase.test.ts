import assert from "node:assert/strict";
import test from "node:test";
import {
  createMetaPurchaseCredential,
  isMetaPurchaseApproved,
  matchesMetaPurchaseCredential,
  normalizeMetaPurchaseItems,
} from "./meta-purchase.js";

test("purchase credentials are random, hashed, and validated without storing the raw value", () => {
  const first = createMetaPurchaseCredential();
  const second = createMetaPurchaseCredential();

  assert.equal(first.token.length, 43);
  assert.notEqual(first.token, first.tokenHash);
  assert.notEqual(first.token, second.token);
  assert.equal(matchesMetaPurchaseCredential(first.token, first.tokenHash), true);
  assert.equal(matchesMetaPurchaseCredential(second.token, first.tokenHash), false);
});

test("purchase approval requires an approved order status and compatible payment status", () => {
  for (const status of ["paid", "approved", "completed", "payment_approved"]) {
    assert.equal(isMetaPurchaseApproved(status, undefined), true);
    assert.equal(isMetaPurchaseApproved(status, null), true);
    assert.equal(isMetaPurchaseApproved(status, " APPROVED "), true);
  }

  for (const status of ["payment_failed", "cancelled", "failed", "pending", "payment_pending", "unknown"]) {
    assert.equal(isMetaPurchaseApproved(status, "approved"), false);
  }
  for (const paymentStatus of ["pending", "failed", "cancelled", "rejected", "DECLINED", "unknown", ""]) {
    assert.equal(isMetaPurchaseApproved("payment_approved", paymentStatus), false);
  }
});

test("purchase items are normalized from the persisted order snapshot", () => {
  assert.deepEqual(normalizeMetaPurchaseItems([
    { productId: "product-1", variantId: "variant-1", quantity: 2, unit_price: 12500 },
    { productId: "product-2", variantId: null, quantity: 1, unit_price: 30000 },
  ]), [
    { id: "variant-1", quantity: 2, item_price: 12500 },
    { id: "product-2", quantity: 1, item_price: 30000 },
  ]);
  assert.equal(normalizeMetaPurchaseItems([{ productId: "product-1", quantity: 0, unit_price: 1 }]), null);
});
