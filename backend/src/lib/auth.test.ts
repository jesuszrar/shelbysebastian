import test from "node:test";
import assert from "node:assert/strict";
import { isAdminUserRecord } from "./auth.js";

test("does not grant admin access from a cedula when the database flag is false", () => {
  assert.equal(isAdminUserRecord({ isAdmin: false }), false);
});

test("grants admin access only when the persisted database flag is true", () => {
  assert.equal(isAdminUserRecord({ isAdmin: true }), true);
});
