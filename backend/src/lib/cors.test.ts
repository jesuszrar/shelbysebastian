import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAllowedCorsOrigin } from "./cors.js";

describe("isAllowedCorsOrigin", () => {
  it("allows the production checkout domain", () => {
    assert.equal(isAllowedCorsOrigin("https://shelbyimportacionessas.com", ["https://shelbyimportacionessas.com"]), true);
  });

  it("allows localhost during development", () => {
    assert.equal(isAllowedCorsOrigin("http://localhost:5173", []), true);
  });

  it("rejects unrelated origins", () => {
    assert.equal(isAllowedCorsOrigin("https://malicious.example", []), false);
  });
});
