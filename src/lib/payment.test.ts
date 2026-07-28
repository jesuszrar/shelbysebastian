import { describe, it, expect } from "vitest";
import { getMercadoPagoErrorMessage, getPaymentRedirectUrl } from "./payment";

describe("getMercadoPagoErrorMessage", () => {
  it("returns a friendly message for missing configuration", () => {
    expect(getMercadoPagoErrorMessage(new Error("MERCADOPAGO_ACCESS_TOKEN no está configurado"))).toContain("Mercado Pago no está configurado");
  });

  it("returns a generic fallback for unexpected errors", () => {
    expect(getMercadoPagoErrorMessage(new Error("Network error"))).toContain("No pudimos iniciar el pago");
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
