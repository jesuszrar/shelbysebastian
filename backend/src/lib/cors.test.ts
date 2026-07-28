import { describe, expect, it } from "vitest";
import { isAllowedCorsOrigin } from "./cors.js";

describe("isAllowedCorsOrigin", () => {
  it("allows the production checkout domain", () => {
    expect(isAllowedCorsOrigin("https://shelbyimportacionessas.com", ["https://shelbyimportacionessas.com"])).toBe(true);
  });

  it("allows localhost during development", () => {
    expect(isAllowedCorsOrigin("http://localhost:5173", [])).toBe(true);
  });

  it("rejects unrelated origins", () => {
    expect(isAllowedCorsOrigin("https://malicious.example", [])).toBe(false);
  });
});
