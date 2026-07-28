import { describe, it, expect } from "vitest";
import { resolveApiBaseUrl } from "@/integrations/api/client";

describe("resolveApiBaseUrl", () => {
  it("prefers the active Render backend when no env override exists", () => {
    expect(resolveApiBaseUrl()).toBe("https://shelbysebastian-1.onrender.com");
  });
});
