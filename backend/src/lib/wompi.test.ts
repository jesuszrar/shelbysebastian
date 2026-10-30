import assert from "node:assert/strict";
import test from "node:test";

import {
  getWompiMerchantSignature,
  getWompiPaymentConfigError,
  extractWebhookSignature,
  isWompiPaymentSimulationEnabled,
  isWompiPublicEnvironment,
  mapWompiStatusToOrderStatus,
  normalizeWompiPaymentMethod,
  verifyWompiEventSignature,
} from "./wompi.js";

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

test("prefers a provided checksum header and falls back only when it is empty or absent", () => {
  const previousKey = process.env.WOMPI_EVENTS_KEY;
  process.env.WOMPI_EVENTS_KEY = "events-secret";

  const event = {
    data: {
      transaction: {
        id: "TX-1",
        status: "APPROVED",
        amount_in_cents: 15000000,
      },
    },
    signature: {
      properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
      checksum: "",
    },
    timestamp: 1530291411,
  };
  const checksum = getWompiMerchantSignature(event, "events-secret");
  assert.ok(checksum);
  event.signature.checksum = checksum;

  try {
    assert.equal(verifyWompiEventSignature(event, checksum), true);
    assert.equal(verifyWompiEventSignature(event, "invalid-header"), false);
    assert.equal(verifyWompiEventSignature(event, undefined), true);
    assert.equal(verifyWompiEventSignature(event, ""), true);
    assert.equal(verifyWompiEventSignature(event, "bad-signature"), false);
    assert.equal(verifyWompiEventSignature({ ...event, timestamp: 1530291412 }, checksum), false);

    const withoutBodyChecksum = {
      ...event,
      signature: { ...event.signature, checksum: "" },
    };
    assert.equal(verifyWompiEventSignature(withoutBodyChecksum, undefined), false);
    assert.equal(verifyWompiEventSignature(event, "not-a-checksum"), false);

    const incorrectBodyChecksum = {
      ...event,
      signature: { ...event.signature, checksum: "0".repeat(64) },
    };
    assert.equal(verifyWompiEventSignature(incorrectBodyChecksum, undefined), false);
  } finally {
    if (previousKey === undefined) delete process.env.WOMPI_EVENTS_KEY;
    else process.env.WOMPI_EVENTS_KEY = previousKey;
  }
});

test("records the discrepancy in the published Wompi event checksum example", () => {
  const event = {
    data: {
      transaction: {
        id: "1234-1610641025-49201",
        status: "APPROVED",
        amount_in_cents: 4490000,
      },
    },
    signature: {
      properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
      checksum: "3476DDA50F64CD7CBD160689640506FEBEA93239BC524FC0469B2C68A3CC8BD0",
    },
    timestamp: 1530291411,
  };
  const eventsKey = "prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z";
  const publishedChecksum = "3476dda50f64cd7cbd160689640506febea93239bc524fc0469b2c68a3cc8bd0";
  const calculatedChecksum = "5a18ec5e8fdb7df463e9f94774cba8f583ba21bd04a09ceff2ea68a4bc0aefbe";

  assert.equal(event.signature.checksum.toLowerCase(), publishedChecksum);
  assert.equal(getWompiMerchantSignature(event, eventsKey), calculatedChecksum);
  assert.notEqual(calculatedChecksum, publishedChecksum);
  const previousKey = process.env.WOMPI_EVENTS_KEY;
  process.env.WOMPI_EVENTS_KEY = eventsKey;
  try {
    assert.equal(verifyWompiEventSignature(event, undefined), false);
    const eventWithCalculatedChecksum = {
      ...event,
      signature: { ...event.signature, checksum: calculatedChecksum },
    };
    assert.equal(verifyWompiEventSignature(eventWithCalculatedChecksum, undefined), true);
  } finally {
    if (previousKey === undefined) delete process.env.WOMPI_EVENTS_KEY;
    else process.env.WOMPI_EVENTS_KEY = previousKey;
  }
});

test("accepts only exact SHA-256 checksum strings", () => {
  const checksum = "a".repeat(64);
  assert.equal(extractWebhookSignature(checksum), checksum);
  assert.equal(extractWebhookSignature(`sha256=${checksum}`), null);
  assert.equal(extractWebhookSignature(`${checksum}0`), null);
  assert.equal(extractWebhookSignature("a".repeat(63)), null);
  assert.equal(extractWebhookSignature("not-a-checksum"), null);
});

test("rejects incomplete Wompi configuration except for explicit development simulation", () => {
  const emptyConfig = { publicKey: "", privateKey: "", eventsKey: "" };

  assert.equal(
    getWompiPaymentConfigError(
      { publicKey: "public", privateKey: "private", eventsKey: "events" },
      "production",
      undefined,
    ),
    null,
  );
  assert.equal(
    getWompiPaymentConfigError(emptyConfig, "production", "true"),
    "Wompi payment configuration is incomplete",
  );
  assert.equal(getWompiPaymentConfigError(emptyConfig, "development", "true", false), null);
  assert.equal(isWompiPublicEnvironment("development", "TRUE"), true);
  assert.equal(isWompiPaymentSimulationEnabled("development", "true", true), false);
  assert.equal(
    getWompiPaymentConfigError(emptyConfig, "development", "true", true),
    "Wompi payment configuration is incomplete",
  );
  assert.equal(
    getWompiPaymentConfigError({ ...emptyConfig, publicKey: "configured" }, "development", "true"),
    "Wompi payment configuration is incomplete",
  );
  assert.equal(
    getWompiPaymentConfigError(emptyConfig, "development", undefined),
    "Wompi payment configuration is incomplete",
  );
});