import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveUploadsDirectory } from "./uploads-directory.js";

test("uses a shared uploads directory outside Hostinger deployment versions", () => {
  const domainRoot = path.join(path.parse(process.cwd()).root, "home", "account", "domains", "api.shelbyimportacionessas.com");
  const entryPoint = path.join(domainRoot, "hbuilds", "versions", "release-123", "nodejs", "dist", "server.js");

  assert.equal(resolveUploadsDirectory(entryPoint), path.join(domainRoot, "uploads"));
});

test("preserves the existing relative uploads directory outside Hostinger versions", () => {
  const entryPoint = path.join(path.parse(process.cwd()).root, "workspace", "backend", "dist", "server.js");

  assert.equal(resolveUploadsDirectory(entryPoint), path.join(path.parse(process.cwd()).root, "workspace", "uploads"));
});
