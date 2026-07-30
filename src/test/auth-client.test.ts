import { describe, it, expect } from "vitest";
import { buildRequestHeaders } from "@/integrations/api/client";

describe("buildRequestHeaders", () => {
  it("adds bearer and x-access-token headers when an access token exists", () => {
    const headers = buildRequestHeaders({}, "abc123");

    expect(headers.get("Authorization")).toBe("Bearer abc123");
    expect(headers.get("X-Access-Token")).toBe("abc123");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("does not add authorization headers when no token exists", () => {
    const headers = buildRequestHeaders({}, undefined);

    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-Access-Token")).toBeNull();
  });
});
