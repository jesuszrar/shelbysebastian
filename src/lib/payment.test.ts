import { describe, it, expect } from "vitest";
import { getMercadoPagoErrorMessage } from "./payment";

describe("getMercadoPagoErrorMessage", () => {
  it("returns a friendly message for missing configuration", () => {
    expect(getMercadoPagoErrorMessage(new Error("MERCADOPAGO_ACCESS_TOKEN no está configurado"))).toContain("Mercado Pago no está configurado");
  });

  it("returns a generic fallback for unexpected errors", () => {
    expect(getMercadoPagoErrorMessage(new Error("Network error"))).toContain("No pudimos iniciar el pago");
  });
});
