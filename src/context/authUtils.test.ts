import { describe, expect, it } from "vitest";
import { isAdminUser } from "./authUtils";

describe("isAdminUser", () => {
  it("does not recognize an admin by cedula", () => {
    expect(isAdminUser({}, null)).toBe(false);
  });

  it("recognizes an admin by session metadata", () => {
    expect(
      isAdminUser(
        null,
        { user: { user_metadata: { is_admin: true } } },
      ),
    ).toBe(true);
  });

  it("uses the persisted user role when present", () => {
    expect(isAdminUser({ isAdmin: true }, null)).toBe(true);
  });
});
