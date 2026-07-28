import { describe, expect, it } from "vitest";
import { resolvePreferredPaymentMethod } from "./mercadopago.js";

describe("resolvePreferredPaymentMethod", () => {
  it("returns the Mercado Pago method ID for Nequi", () => {
    const methods = [{ id: "nequi", name: "Nequi" }, { id: "master", name: "Mastercard" }];

    expect(resolvePreferredPaymentMethod(methods, "nequi")).toBe("nequi");
  });

  it("returns the Mercado Pago method ID for Daviplata", () => {
    const methods = [{ id: "daviplata", name: "Daviplata" }];

    expect(resolvePreferredPaymentMethod(methods, "daviplata")).toBe("daviplata");
  });

  it("returns undefined when the preferred method is not available", () => {
    const methods = [{ id: "master", name: "Mastercard" }];

    expect(resolvePreferredPaymentMethod(methods, "nequi")).toBeUndefined();
  });
});
