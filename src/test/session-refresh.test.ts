import { describe, expect, it } from "vitest";
import { isTokenExpired, shouldAttemptSessionRefresh } from "@/integrations/api/client";

describe("session refresh guard", () => {
  it("treats expired access tokens as refreshable instead of immediately invalidating the session", () => {
    const now = Date.now() / 1000;
    const expiredToken = `header.${btoa(JSON.stringify({ exp: Math.floor(now) - 120 })).replace(/=+$/, "")}.signature`;

    expect(isTokenExpired(expiredToken)).toBe(true);
    expect(shouldAttemptSessionRefresh(expiredToken)).toBe(true);
  });

  it("flags tokens expiring soon as refresh candidates", () => {
    const now = Date.now() / 1000;
    const soonExpiring = `header.${btoa(JSON.stringify({ exp: Math.floor(now) + 60 })).replace(/=+$/, "")}.signature`;

    expect(isTokenExpired(soonExpiring)).toBe(false);
    expect(shouldAttemptSessionRefresh(soonExpiring)).toBe(true);
  });
});
