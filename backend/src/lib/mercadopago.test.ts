import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePreferredPaymentMethod } from "./mercadopago.js";

describe("resolvePreferredPaymentMethod", () => {
  it("returns the Mercado Pago method ID for Nequi", () => {
    const methods = [{ id: "nequi", name: "Nequi" }, { id: "master", name: "Mastercard" }];

    assert.equal(resolvePreferredPaymentMethod(methods, "nequi"), "nequi");
  });

  it("returns the Mercado Pago method ID for Daviplata", () => {
    const methods = [{ id: "daviplata", name: "Daviplata" }];

    assert.equal(resolvePreferredPaymentMethod(methods, "daviplata"), "daviplata");
  });

  it("returns undefined when the preferred method is not available", () => {
    const methods = [{ id: "master", name: "Mastercard" }];

    assert.equal(resolvePreferredPaymentMethod(methods, "nequi"), undefined);
  });
});
