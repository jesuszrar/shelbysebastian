import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { mapWompiStatusToOrderStatus, normalizeWompiPaymentMethod, verifyWompiEventSignature } from "./wompi.js";

test("normalizes wompi payment methods", () => {
  assert.equal(normalizeWompiPaymentMethod("Nequi"), "NEQUI");
  assert.equal(normalizeWompiPaymentMethod("Daviplata"), "DAVIPLATA");
  assert.equal(normalizeWompiPaymentMethod("Tarjeta"), "CARD");
  assert.equal(normalizeWompiPaymentMethod("PSE"), "PSE");
});

test("maps wompi statuses to internal order statuses", () => {
  assert.equal(mapWompiStatusToOrderStatus("APPROVED"), "payment_approved");
  assert.equal(mapWompiStatusToOrderStatus("PENDING"), "payment_pending");
  assert.equal(mapWompiStatusToOrderStatus("DECLINED"), "payment_failed");
});

test("verifies wompi webhook signatures using the events key", () => {
  const previousKey = process.env.WOMPI_EVENTS_KEY;
  process.env.WOMPI_EVENTS_KEY = "events-secret";

  const rawBody = JSON.stringify({ event: "transaction.updated", data: { transaction: { reference: "ORDER-1" } } });
  const signature = crypto.createHmac("sha256", "events-secret").update(rawBody).digest("hex");

  assert.equal(verifyWompiEventSignature(rawBody, signature), true);
  assert.equal(verifyWompiEventSignature(rawBody, "bad-signature"), false);

  process.env.WOMPI_EVENTS_KEY = previousKey;
});