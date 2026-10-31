import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { PrismaClient } from "@prisma/client";
import { createApp } from "./server.js";

const testJwtSecret = "isolated-security-test-secret";
const password = "customer-password";
const passwordHash = bcrypt.hashSync(password, 4);

type TestUser = {
  id: string;
  name: string;
  email: string;
  cedula: string;
  isAdmin: boolean;
  password: string;
};

type TestOrder = {
  id: string;
  userId: string;
  status: string;
  total: number;
};

type TestCedulaEmail = {
  cedula: string;
  email: string;
  userId: string | null;
};

const initialUsers = (): TestUser[] => [
  { id: "customer-1", name: "Customer One", email: "customer@example.test", cedula: "111222333", isAdmin: false, password: passwordHash },
  { id: "customer-2", name: "Customer Two", email: "other@example.test", cedula: "444555666", isAdmin: false, password: passwordHash },
  { id: "admin-1", name: "Store Admin", email: "admin@example.test", cedula: "777888999", isAdmin: true, password: passwordHash },
];

type TestState = {
  users: TestUser[];
  orders: TestOrder[];
  cedulaEmails: TestCedulaEmail[];
  refreshTokens: Array<{ userId: string; tokenHash: string; expiresAt: Date }>;
  writes: string[];
  failRefreshTokenCreation?: boolean;
};

const createState = (): TestState => ({
  users: initialUsers(),
  orders: [
    { id: "order-customer-1", userId: "customer-1", status: "paid", total: 100 },
    { id: "order-customer-2", userId: "customer-2", status: "pending", total: 200 },
  ],
  refreshTokens: [],
  cedulaEmails: [
    { cedula: "111222333", email: "customer@example.test", userId: "customer-1" },
    { cedula: "444555666", email: "other@example.test", userId: "customer-2" },
    { cedula: "777888999", email: "admin@example.test", userId: "admin-1" },
  ],
  writes: [],
});

const createFakePrisma = (state: TestState) => ({
  user: {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
      state.users.find((user) =>
        (where.id !== undefined && user.id === where.id) ||
        (where.email !== undefined && user.email === where.email),
      ) ?? null,
    findFirst: async ({ where }: { where: { cedula?: string } }) =>
      state.users.find((user) => where.cedula !== undefined && user.cedula === where.cedula) ?? null,
    findMany: async () => [...state.users],
    create: async ({ data }: { data: Omit<TestUser, "id"> }) => {
      const user = { id: `user-${state.users.length + 1}`, ...data };
      state.users.push(user);
      state.writes.push(`user.create:${user.id}`);
      return user;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<TestUser> }) => {
      const user = state.users.find((candidate) => candidate.id === where.id);
      if (!user) throw new Error("test user not found");
      Object.assign(user, data);
      state.writes.push(`user.update:${where.id}`);
      return user;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const index = state.users.findIndex((user) => user.id === where.id);
      if (index < 0) throw new Error("test user not found");
      const [deleted] = state.users.splice(index, 1);
      state.writes.push(`user.delete:${where.id}`);
      return deleted;
    },
  },
  order: {
    findMany: async ({ where }: { where?: { userId?: string } } = {}) =>
      state.orders.filter((order) => !where?.userId || order.userId === where.userId),
    findUnique: async ({ where }: { where: { id: string }; select?: { id?: boolean; status?: boolean } }) => {
      const order = state.orders.find((candidate) => candidate.id === where.id);
      if (!order) return null;
      return { id: order.id, status: order.status };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const index = state.orders.findIndex((order) => order.id === where.id);
      if (index < 0) throw new Error("test order not found");
      const [deleted] = state.orders.splice(index, 1);
      state.writes.push(`order.delete:${where.id}`);
      return deleted;
    },
  },
  cedulaEmail: {
    findUnique: async ({ where }: { where: { cedula: string } }) =>
      state.cedulaEmails.find((entry) => entry.cedula === where.cedula) ?? null,
    findMany: async () => [...state.cedulaEmails],
    upsert: async ({ where, create }: { where: { cedula: string }; create: TestCedulaEmail; update: Partial<TestCedulaEmail> }) => {
      const existing = state.cedulaEmails.find((entry) => entry.cedula === where.cedula);
      if (existing) return existing;
      state.cedulaEmails.push(create);
      state.writes.push(`cedulaEmail.upsert:${create.cedula}`);
      return create;
    },
    delete: async ({ where }: { where: { cedula: string } }) => {
      const index = state.cedulaEmails.findIndex((entry) => entry.cedula === where.cedula);
      if (index < 0) throw new Error("test cédula association not found");
      const [deleted] = state.cedulaEmails.splice(index, 1);
      state.writes.push(`cedulaEmail.delete:${where.cedula}`);
      return deleted;
    },
  },
  refreshToken: {
    create: async ({ data }: { data: { userId: string; tokenHash: string; expiresAt: Date } }) => {
      if (state.failRefreshTokenCreation) throw new Error("simulated refresh-token persistence failure");
      state.refreshTokens.push(data);
      state.writes.push(`refreshToken.create:${data.userId}`);
      return { id: `refresh-${state.refreshTokens.length}`, ...data };
    },
  },
});

const makeToken = (user: TestUser, isAdminClaim = user.isAdmin) =>
  jwt.sign({
    sub: user.id,
    email: user.email,
    name: user.name,
    cedula: user.cedula,
    isAdmin: isAdminClaim,
  }, testJwtSecret);

const withHttpApp = async (
  run: (context: {
    request: (path: string, options?: RequestInit) => Promise<Response>;
    state: TestState;
    tokenFor: (userId: string, isAdminClaim?: boolean) => string;
  }) => Promise<void>,
) => {
  const state = createState();
  const fakePrisma = createFakePrisma(state);
  const prisma = {
    ...fakePrisma,
    $transaction: async <T>(callback: (transaction: typeof fakePrisma) => Promise<T>) => {
      const snapshot = structuredClone(state);
      try {
        return await callback(fakePrisma);
      } catch (error) {
        state.users.splice(0, state.users.length, ...snapshot.users);
        state.cedulaEmails.splice(0, state.cedulaEmails.length, ...snapshot.cedulaEmails);
        state.refreshTokens.splice(0, state.refreshTokens.length, ...snapshot.refreshTokens);
        state.writes.splice(0, state.writes.length, ...snapshot.writes);
        throw error;
      }
    },
  };
  const app = createApp({
    prisma: prisma as unknown as PrismaClient,
    jwtSecret: testJwtSecret,
    createRefreshToken: async (userId, expiresAt, transaction) => {
      if (transaction) {
        await transaction.refreshToken.create({
          data: { userId, tokenHash: "isolated-test-refresh-token-hash", expiresAt },
        });
      }
      return "isolated-test-refresh-token";
    },
  });
  const server: Server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test HTTP server did not bind to a TCP port");

  const request = (path: string, options: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, options);
  const tokenFor = (userId: string, isAdminClaim?: boolean) => {
    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) throw new Error(`Missing test user: ${userId}`);
    return makeToken(user, isAdminClaim ?? user.isAdmin);
  };

  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
  };
  console.log = () => undefined;
  console.info = () => undefined;
  console.warn = () => undefined;
  try {
    await run({ request, state, tokenFor });
  } finally {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
};

const jsonRequest = (method: string, body?: unknown, token?: string): RequestInit => ({
  method,
  headers: {
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const filterQuery = (column: string, value: string) =>
  `?filters=${encodeURIComponent(JSON.stringify([{ column, value }]))}`;

test("registration commits the user, cédula mapping and refresh token together", async () => {
  await withHttpApp(async ({ request, state }) => {
    const response = await request("/api/auth/register", jsonRequest("POST", {
      email: "new@example.test",
      password: "a-secure-test-password",
      data: { name: "New Customer", cedula: "123-456-789" },
    }));

    assert.equal(response.status, 200);
    const body = await response.json() as { session: { access_token: string }; user: { id: string; email: string } };
    assert.ok(body.session.access_token);
    assert.equal(body.user.email, "new@example.test");
    assert.equal(state.users.length, 4);
    assert.equal(state.cedulaEmails.at(-1)?.cedula, "123456789");
    assert.equal(state.refreshTokens.length, 1);
    assert.equal(state.refreshTokens[0].userId, body.user.id);
  });
});

test("registration rolls back its user and cédula mapping when refresh-token persistence fails", async () => {
  await withHttpApp(async ({ request, state }) => {
    state.failRefreshTokenCreation = true;
    const response = await request("/api/auth/register", jsonRequest("POST", {
      email: "failed@example.test",
      password: "a-secure-test-password",
      data: { name: "Failed Customer", cedula: "987-654-321" },
    }));

    assert.equal(response.status, 500);
    assert.equal(state.users.some((user) => user.email === "failed@example.test"), false);
    assert.equal(state.cedulaEmails.some((entry) => entry.cedula === "987654321"), false);
    assert.equal(state.refreshTokens.length, 0);
    assert.deepEqual(state.writes, []);
  });
});

test("health endpoint identifies the PostgreSQL backend", async () => {
  await withHttpApp(async ({ request }) => {
    const response = await request("/health");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: "shelby-postgresql-backend" });
  });
});

test("anonymous requests cannot access profiles, all orders, profile writes, RPC, or private deletes", async () => {
  await withHttpApp(async ({ request, state }) => {
    const checks: Array<[string, RequestInit, number]> = [
      ["/api/data/profiles", {}, 401],
      ["/api/data/orders", {}, 401],
      ["/api/profile/sync", jsonRequest("POST", { user_id: "customer-1", user_name: "Changed" }), 401],
      ["/api/rpc/sync_profile", jsonRequest("POST", { user_id: "customer-1", user_name: "Changed" }), 401],
      ["/api/auth/me", jsonRequest("PATCH", { is_admin: true }), 401],
      ["/api/data/orders", jsonRequest("DELETE", undefined), 401],
      ["/api/data/profiles", jsonRequest("DELETE", undefined), 401],
      ["/api/data/cedula_emails", jsonRequest("DELETE", undefined), 401],
    ];

    for (const [path, options, expectedStatus] of checks) {
      const response = await request(path, options);
      assert.equal(response.status, expectedStatus, path);
    }
    assert.equal((await request("/api/users/email-by-cedula?cedula=111222333")).status, 404);
    const statusLookup = await request(`/api/data/orders${filterQuery("id", "order-customer-1")}`);
    assert.equal(statusLookup.status, 200);
    assert.deepEqual(await statusLookup.json(), [{ id: "order-customer-1", status: "paid" }]);
    assert.deepEqual(state.writes, []);
  });
});

test("customers are limited to their orders and own-name synchronization", async () => {
  await withHttpApp(async ({ request, state, tokenFor }) => {
    const customerToken = tokenFor("customer-1");
    const authHeaders = { Authorization: `Bearer ${customerToken}` };

    const ordersResponse = await request("/api/data/orders", { headers: authHeaders });
    assert.equal(ordersResponse.status, 200);
    assert.deepEqual((await ordersResponse.json() as TestOrder[]).map((order) => order.id), ["order-customer-1"]);

    const privateProfiles = await request("/api/data/profiles", { headers: authHeaders });
    assert.equal(privateProfiles.status, 403);

    const roleAttempt = await request("/api/auth/me", jsonRequest("PATCH", {
      is_admin: true,
      data: { isAdmin: true },
    }, customerToken));
    assert.equal(roleAttempt.status, 403);
    const alternateRoleAttempt = await request("/api/auth/me", jsonRequest("PATCH", {
      data: { role: "admin", admin: true },
    }, customerToken));
    assert.equal(alternateRoleAttempt.status, 200);
    assert.equal(state.users[0].isAdmin, false);

    const syncResponse = await request("/api/profile/sync", jsonRequest("POST", {
      user_id: "customer-1",
      user_name: "Updated Customer",
      user_email: "attacker@example.test",
      user_cedula: "999999999",
      user_is_admin: true,
    }, customerToken));
    assert.equal(syncResponse.status, 200);
    assert.deepEqual(
      { name: state.users[0].name, email: state.users[0].email, cedula: state.users[0].cedula, isAdmin: state.users[0].isAdmin },
      { name: "Updated Customer", email: "customer@example.test", cedula: "111222333", isAdmin: false },
    );

    const otherProfile = await request("/api/rpc/sync_profile", jsonRequest("POST", {
      user_id: "customer-2",
      user_name: "Hijacked",
    }, customerToken));
    assert.equal(otherProfile.status, 403);

    const ownCedulaEmail = await request("/api/rpc/get_email_by_cedula", jsonRequest("POST", {
      lookup_cedula: "111-222-333",
    }, customerToken));
    assert.equal(ownCedulaEmail.status, 200);
    assert.equal(await ownCedulaEmail.json(), "customer@example.test");
    const otherCedulaEmail = await request("/api/rpc/get_email_by_cedula", jsonRequest("POST", {
      lookup_cedula: "444555666",
    }, customerToken));
    assert.equal(otherCedulaEmail.status, 403);

    const writesBeforeDeletes = [...state.writes];
    const deleteTargets: Array<[string, string, string]> = [
      ["orders", "id", "order-customer-1"],
      ["profiles", "id", "customer-1"],
      ["cedula_emails", "cedula", "111222333"],
    ];
    for (const [table, column, value] of deleteTargets) {
      const response = await request(`/api/data/${table}${filterQuery(column, value)}`, jsonRequest("DELETE", undefined, customerToken));
      assert.equal(response.status, 403, table);
    }
    assert.deepEqual(state.writes, writesBeforeDeletes);
  });
});

test("authorization follows the persisted admin role and permits scoped admin management", async () => {
  await withHttpApp(async ({ request, state, tokenFor }) => {
    const persistedAdminToken = tokenFor("admin-1", false);
    const profiles = await request("/api/data/profiles", {
      headers: { Authorization: `Bearer ${persistedAdminToken}` },
    });
    assert.equal(profiles.status, 200);
    assert.equal((await profiles.json() as TestUser[]).length, 3);
    const adminOrders = await request("/api/data/orders", {
      headers: { Authorization: `Bearer ${persistedAdminToken}` },
    });
    assert.equal(adminOrders.status, 200);
    assert.equal((await adminOrders.json() as TestOrder[]).length, 2);

    const unprivilegedTokenWithAdminClaim = tokenFor("customer-1", true);
    const deniedProfiles = await request("/api/data/profiles", {
      headers: { Authorization: `Bearer ${unprivilegedTokenWithAdminClaim}` },
    });
    assert.equal(deniedProfiles.status, 403);
    const deniedDelete = await request(`/api/data/orders${filterQuery("id", "order-customer-1")}`, jsonRequest("DELETE", undefined, unprivilegedTokenWithAdminClaim));
    assert.equal(deniedDelete.status, 403);

    const adminCedulaEmail = await request("/api/rpc/get_email_by_cedula", jsonRequest("POST", {
      lookup_cedula: "111222333",
    }, persistedAdminToken));
    assert.equal(adminCedulaEmail.status, 200);
    assert.equal(await adminCedulaEmail.json(), "customer@example.test");

    for (const table of ["orders", "profiles", "cedula_emails"]) {
      const broadDelete = await request(`/api/data/${table}`, jsonRequest("DELETE", undefined, persistedAdminToken));
      assert.equal(broadDelete.status, 400, table);
    }

    const profileSync = await request("/api/rpc/sync_profile", jsonRequest("POST", {
      user_id: "customer-2",
      user_name: "Admin Updated",
      user_email: "ignored@example.test",
      user_cedula: "123",
      user_is_admin: false,
    }, persistedAdminToken));
    assert.equal(profileSync.status, 200);
    assert.equal(state.users.find((user) => user.id === "customer-2")?.name, "Admin Updated");
    assert.equal(state.users.find((user) => user.id === "customer-2")?.email, "other@example.test");
    assert.equal(state.users.find((user) => user.id === "customer-2")?.isAdmin, false);

    const orderDelete = await request(`/api/data/orders${filterQuery("id", "order-customer-1")}`, jsonRequest("DELETE", undefined, persistedAdminToken));
    const profileDelete = await request(`/api/data/profiles${filterQuery("id", "customer-2")}`, jsonRequest("DELETE", undefined, persistedAdminToken));
    const cedulaDelete = await request(`/api/data/cedula_emails${filterQuery("cedula", "444555666")}`, jsonRequest("DELETE", undefined, persistedAdminToken));
    assert.equal(orderDelete.status, 200);
    assert.equal(profileDelete.status, 200);
    assert.equal(cedulaDelete.status, 200);
    assert.deepEqual(state.writes.filter((write) => write.includes(".delete:")), [
      "order.delete:order-customer-1",
      "user.delete:customer-2",
      "cedulaEmail.delete:444555666",
    ]);
  });
});

test("login accepts existing customer cédulas without exposing public email lookup", async () => {
  await withHttpApp(async ({ request, state }) => {
    state.cedulaEmails[0].userId = null;
    const login = await request("/api/auth/login", jsonRequest("POST", {
      cedula: "111-222-333",
      password,
    }));
    assert.equal(login.status, 200);
    const loginBody = await login.json() as { session: { access_token: string }; user: { id: string } };
    assert.equal(loginBody.user.id, "customer-1");
    assert.ok(loginBody.session.access_token);

    state.cedulaEmails.splice(1, 1);
    const profileCedulaLogin = await request("/api/auth/login", jsonRequest("POST", {
      cedula: "444555666",
      password,
    }));
    assert.equal(profileCedulaLogin.status, 200);
    assert.equal((await profileCedulaLogin.json() as { user: { id: string } }).user.id, "customer-2");

    const oldClientLogin = await request("/api/auth/login", jsonRequest("POST", {
      email: "customer@example.test",
      password,
    }));
    assert.equal(oldClientLogin.status, 200);

    const incorrectPassword = await request("/api/auth/login", jsonRequest("POST", {
      cedula: "111222333",
      password: "wrong-password",
    }));
    const unknownCedula = await request("/api/auth/login", jsonRequest("POST", {
      cedula: "000000000",
      password,
    }));
    assert.equal(incorrectPassword.status, 401);
    assert.equal(unknownCedula.status, 401);
    assert.deepEqual(await incorrectPassword.json(), await unknownCedula.json());

    const publicLookup = await request("/api/users/email-by-cedula?cedula=111222333");
    assert.equal(publicLookup.status, 404);
    assert.equal((await publicLookup.text()).includes("customer@example.test"), false);
  });
});

test("login rejects a cédula mapping that points to a different user's persisted cédula", async () => {
  await withHttpApp(async ({ request, state }) => {
    state.cedulaEmails[0].userId = "customer-2";

    const response = await request("/api/auth/login", jsonRequest("POST", {
      cedula: "111222333",
      password,
    }));

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Cédula o contraseña incorrectas" });
    assert.equal(state.writes.length, 0);
  });
});
