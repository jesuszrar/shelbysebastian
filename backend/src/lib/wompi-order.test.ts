import assert from "node:assert/strict";
import test from "node:test";

import {
  decideWompiOrderUpdate,
  getWompiPaymentCreationError,
  isWompiTotalBelowMinimum,
  validateWompiPaymentRequest,
  validateWompiTransaction,
  WOMPI_MINIMUM_TOTAL_COP,
  type WompiOrderSnapshot,
} from "./wompi-order.js";

const order: WompiOrderSnapshot = {
  id: "ORDER-1",
  total: "150000.00",
  status: "payment_pending",
};

test("enforces the $150,000 COP Wompi minimum at exact currency boundaries", () => {
  assert.equal(WOMPI_MINIMUM_TOTAL_COP, 150_000);
  assert.equal(isWompiTotalBelowMinimum("100000.00"), true);
  assert.equal(isWompiTotalBelowMinimum("149999.99"), true);
  assert.equal(isWompiTotalBelowMinimum("150000.00"), false);
  assert.equal(isWompiTotalBelowMinimum("175000.00"), false);
  assert.equal(isWompiTotalBelowMinimum("invalid"), false);
});

test("validates payment requests against the persisted order total, currency, and reference", () => {
  assert.equal(validateWompiPaymentRequest(order, { reference: "ORDER-1", total: 150000, currency: "COP" }), null);
  assert.equal(validateWompiPaymentRequest(order, { reference: "ORDER-1", total: 149999, currency: "COP" }), "amount_mismatch");
  assert.equal(validateWompiPaymentRequest(order, { reference: "ORDER-1", total: 150000, currency: "USD" }), "currency_mismatch");
  assert.equal(validateWompiPaymentRequest(order, { reference: "ORDER-2", total: 150000, currency: "COP" }), "reference_mismatch");
});

test("validates Wompi transaction amount, currency, and reference against the order", () => {
  const transaction = { id: "TX-1", reference: "ORDER-1", amount_in_cents: 15000000, currency: "COP" };

  assert.equal(validateWompiTransaction(order, transaction), null);
  assert.equal(validateWompiTransaction(order, { ...transaction, amount_in_cents: 14999999 }), "amount_mismatch");
  assert.equal(validateWompiTransaction(order, { ...transaction, currency: "USD" }), "currency_mismatch");
  assert.equal(validateWompiTransaction(order, { ...transaction, reference: "ORDER-2" }), "reference_mismatch");
});

test("blocks payment links for paid orders and allows pending orders and payment retries", () => {
  assert.equal(getWompiPaymentCreationError({ status: "payment_approved" }), "order_already_paid");
  assert.equal(getWompiPaymentCreationError({ status: "completed" }), "order_already_paid");
  assert.equal(getWompiPaymentCreationError({ status: "pending", paymentStatus: "approved" }), "order_already_paid");
  assert.equal(getWompiPaymentCreationError({ status: "payment_pending" }), null);
  assert.equal(getWompiPaymentCreationError({ status: "payment_failed" }), null);
  assert.equal(getWompiPaymentCreationError({ status: "cancelled" }), "order_not_payable");
});

test("makes repeated payment events idempotent and prevents downgrading an approved order", () => {
  assert.deepEqual(
    decideWompiOrderUpdate({ status: "payment_pending" }, "TX-1", "payment_approved"),
    { kind: "apply" },
  );
  assert.deepEqual(
    decideWompiOrderUpdate({ status: "payment_pending", wompiTransactionId: "TX-1" }, "TX-1", "payment_pending"),
    { kind: "duplicate", status: "payment_pending" },
  );
  assert.deepEqual(
    decideWompiOrderUpdate({ status: "payment_approved", paymentStatus: "approved", wompiTransactionId: "TX-1" }, "TX-1", "payment_approved"),
    { kind: "duplicate", status: "payment_approved" },
  );
  assert.deepEqual(
    decideWompiOrderUpdate({ status: "payment_approved", paymentStatus: "approved", wompiTransactionId: "TX-1" }, "TX-1", "payment_pending"),
    { kind: "duplicate", status: "payment_approved" },
  );
  assert.deepEqual(
    decideWompiOrderUpdate({ status: "payment_approved", paymentStatus: "approved", wompiTransactionId: "TX-1" }, "TX-2", "payment_approved"),
    { kind: "conflict", reason: "order_already_approved" },
  );
  assert.deepEqual(
    decideWompiOrderUpdate({ status: "payment_failed", wompiTransactionId: "TX-1" }, "TX-1", "payment_pending"),
    { kind: "duplicate", status: "payment_failed" },
  );
});
