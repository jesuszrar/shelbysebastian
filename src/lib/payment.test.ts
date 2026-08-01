import { describe, it, expect } from "vitest";
import { getPaymentRedirectUrl, getWompiErrorMessage } from "./payment";

describe("getWompiErrorMessage", () => {
  it("returns a friendly message for missing configuration", () => {
    expect(getWompiErrorMessage(new Error("WOMPI_PRIVATE_KEY no está configurado"))).toContain("Wompi no está configurado");
  });

  it("returns a generic fallback for unexpected errors", () => {
    expect(getWompiErrorMessage(new Error("Network error"))).toContain("No pudimos iniciar el pago");
  });
});

describe("getPaymentRedirectUrl", () => {
  it("returns the Nequi URL for Nequi payments", () => {
    expect(getPaymentRedirectUrl("nequi")).toBe("https://www.nequi.com.co/");
  });

  it("returns the Daviplata URL for Daviplata payments", () => {
    expect(getPaymentRedirectUrl("daviplata")).toBe("https://www.daviplata.com/");
  });

  it("returns null for unsupported methods", () => {
    expect(getPaymentRedirectUrl("mercadopago")).toBeNull();
    expect(getPaymentRedirectUrl("transferencia")).toBeNull();
  });
});
