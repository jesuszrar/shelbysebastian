import { describe, expect, it } from "vitest";
import { isAdminUser } from "./authUtils";

describe("isAdminUser", () => {
  it("recognizes an admin by cedula", () => {
    expect(isAdminUser({ cedula: "1108758522" } as any, null, "1108758522")).toBe(true);
  });

  it("recognizes an admin by session metadata", () => {
    expect(
      isAdminUser(
        null,
        { user: { user_metadata: { is_admin: true } } } as any,
        null,
      ),
    ).toBe(true);
  });

  it("falls back to the stored active cedula", () => {
    expect(isAdminUser(null, null, "1108758522")).toBe(true);
  });
});
