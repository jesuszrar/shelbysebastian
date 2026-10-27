import test from "node:test";
import assert from "node:assert/strict";
import { canLookupCedulaEmail, canManagePrivateData, canSyncProfile, hasAdminRoleMutation, resolveDataReadAccess } from "./access-control.js";

const customer = { id: "customer-1", isAdmin: false };
const administrator = { id: "admin-1", isAdmin: true };

test("allows anonymous public catalog reads but denies private table reads", () => {
  assert.equal(resolveDataReadAccess("products", null), "public");
  assert.equal(resolveDataReadAccess("categories", null), "public");
  assert.equal(resolveDataReadAccess("profiles", null), "denied");
  assert.equal(resolveDataReadAccess("orders", null), "denied");
});

test("restricts authenticated customers to their own orders and profile sync", () => {
  assert.equal(resolveDataReadAccess("orders", customer), "owner-orders");
  assert.equal(resolveDataReadAccess("profiles", customer), "denied");
  assert.equal(resolveDataReadAccess("cedula_emails", customer), "denied");
  assert.equal(canSyncProfile(customer, customer.id), true);
  assert.equal(canSyncProfile(customer, "another-user"), false);
  assert.equal(canLookupCedulaEmail(customer, "111", "111"), true);
  assert.equal(canLookupCedulaEmail(customer, "111", "222"), false);
  assert.equal(canManagePrivateData(customer), false);
});

test("preserves administrator access and limited guest order status lookup", () => {
  assert.equal(resolveDataReadAccess("orders", administrator), "admin");
  assert.equal(resolveDataReadAccess("profiles", administrator), "admin");
  assert.equal(resolveDataReadAccess("coupons", administrator), "admin");
  assert.equal(resolveDataReadAccess("cedula_emails", administrator), "admin");
  assert.equal(resolveDataReadAccess("orders", null, true), "public-order-status");
  assert.equal(canSyncProfile(administrator, "another-user"), true);
  assert.equal(canLookupCedulaEmail(administrator, "111", "222"), true);
  assert.equal(canManagePrivateData(administrator), true);
});

test("does not allow guests to enumerate order records", () => {
  assert.equal(resolveDataReadAccess("orders", null, false), "denied");
});

test("identifies self-service attempts to change the administrator role", () => {
  assert.equal(hasAdminRoleMutation({ is_admin: true }), true);
  assert.equal(hasAdminRoleMutation({ isAdmin: false }), true);
  assert.equal(hasAdminRoleMutation({ name: "Cliente" }), false);
});
