import { describe, it, expect } from "vitest";
import { resolveApiBaseUrl } from "@/integrations/api/client";

describe("resolveApiBaseUrl", () => {
  it("returns a base URL string", () => {
    const url = resolveApiBaseUrl();
    expect(typeof url).toBe("string");
    expect(url.length).toBeGreaterThan(0);
  });
});
