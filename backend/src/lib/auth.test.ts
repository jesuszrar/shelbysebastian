import test from "node:test";
import assert from "node:assert/strict";
import { isAdminUserRecord } from "./auth.js";

test("treats the configured admin cedula as admin even when the DB flag is false", () => {
  assert.equal(isAdminUserRecord({ cedula: "1108758522", isAdmin: false }), true);
});

test("does not grant admin access for other cedulas", () => {
  assert.equal(isAdminUserRecord({ cedula: "1234567890", isAdmin: false }), false);
});
