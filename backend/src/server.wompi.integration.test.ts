import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createApp } from "./server.js";
import { getWompiMerchantSignature } from "./lib/wompi.js";
import { processPendingWompiWebhookJobs } from "./lib/wompi-persistence.js";

type Row = Record<string, unknown>;

class FakePrisma {
  orders = new Map<string, Row>();
  attempts = new Map<string, Row>();
  receipts = new Map<string, Row>();
  jobs = new Map<string, Row>();
  transactions = new Map<string, Row>();
  resolutions = new Map<string, Row>();
  id = 0;

  user = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === "admin-1" ? { id: "admin-1", isAdmin: true } : null,
  };

  order = {
    findUnique: async ({ where }: { where: { id: string } }) => this.orders.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const current = this.orders.get(where.id);
      if (!current) throw new Error("order missing");
      Object.assign(current, data);
      return current;
    },
  };

  wompiPaymentAttempt = {
    findFirst: async ({ where }: { where: Row }) => [...this.attempts.values()]
      .filter((attempt) => attempt.orderId === where.orderId)
      .filter((attempt) => ((where.status as Row).in as string[]).includes(String(attempt.status)))
      .sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime())[0] ?? null,
    findUnique: async ({ where }: { where: Row }) => {
      const attempt = [...this.attempts.values()].find((candidate) =>
        (where.id && candidate.id === where.id) || (where.reference && candidate.reference === where.reference),
      );
      return attempt ? structuredClone(attempt) : null;
    },
    create: async ({ data }: { data: Row }) => {
      const now = new Date();
      const attempt = { id: `attempt-${++this.id}`, createdAt: now, updatedAt: now, ...data };
      this.attempts.set(String(attempt.id), attempt);
      return attempt;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const attempt of this.attempts.values()) {
        const idMatches = !where.id ||
          (typeof where.id === "string" ? attempt.id === where.id : attempt.id !== (where.id as Row).not);
        const statusMatches = !where.status ||
          (typeof where.status === "string" ? attempt.status === where.status : ((where.status as Row).in as string[]).includes(String(attempt.status)));
        if (idMatches && statusMatches && (!where.orderId || attempt.orderId === where.orderId)) {
          Object.assign(attempt, data, { updatedAt: new Date() });
          count += 1;
        }
      }
      return { count };
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const attempt = this.attempts.get(where.id);
      if (!attempt) throw new Error("attempt missing");
      Object.assign(attempt, data, { updatedAt: new Date() });
      return attempt;
    },
  };

  wompiWebhookReceipt = {
    findUnique: async ({ where }: { where: Row }) => [...this.receipts.values()].find((receipt) =>
      receipt.bodyHash === where.bodyHash || receipt.id === where.id,
    ) ?? null,
    upsert: async ({ where, create }: { where: { bodyHash: string }; create: Row }) => {
      let receipt = [...this.receipts.values()].find((candidate) => candidate.bodyHash === where.bodyHash);
      if (!receipt) {
        receipt = { id: `receipt-${++this.id}`, receivedAt: new Date(), ...create };
        this.receipts.set(String(receipt.id), receipt);
      }
      return receipt;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const receipt = this.receipts.get(where.id);
      if (!receipt) throw new Error("receipt missing");
      Object.assign(receipt, data);
      return receipt;
    },
  };

  wompiWebhookJob = {
    upsert: async ({ where, create }: { where: { receiptId: string }; create: Row }) => {
      let job = [...this.jobs.values()].find((candidate) => candidate.receiptId === where.receiptId);
      if (!job) {
        job = {
          id: `job-${++this.id}`,
          attempts: 0,
          status: "PENDING",
          nextAttemptAt: new Date(0),
          ...create,
        };
        this.jobs.set(String(job.id), job);
      }
      return job;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const job = this.jobs.get(where.id);
      if (!job) throw new Error("job missing");
      Object.assign(job, data);
      return job;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const job of this.jobs.values()) {
        if (job.id !== where.id || (where.status && job.status !== where.status)) continue;
        const next = { ...data };
        if (next.attempts && typeof next.attempts === "object") {
          next.attempts = Number(job.attempts) + Number((next.attempts as Row).increment);
        }
        Object.assign(job, next);
        count += 1;
      }
      return { count };
    },
    findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in
      .map((id) => this.jobs.get(id))
      .filter((job): job is Row => Boolean(job))
      .map((job) => ({
        ...job,
        receipt: [...this.receipts.values()].find((receipt) => receipt.id === job.receiptId),
      })),
  };

  wompiTransaction = {
    findUnique: async ({ where }: { where: { providerTransactionId: string } }) =>
      this.transactions.get(where.providerTransactionId) ?? null,
    findUniqueOrThrow: async ({ where }: { where: { providerTransactionId: string } }) => {
      const transaction = this.transactions.get(where.providerTransactionId);
      if (!transaction) throw new Error("transaction missing");
      return transaction;
    },
    create: async ({ data }: { data: Row }) => {
      if (this.transactions.has(String(data.providerTransactionId))) throw new Error("duplicate transaction id");
      const row = { id: `transaction-${++this.id}`, ...data };
      this.transactions.set(String(row.providerTransactionId), row);
      return row;
    },
    update: async ({ where, data }: { where: { providerTransactionId: string }; data: Row }) => {
      const transaction = this.transactions.get(where.providerTransactionId);
      if (!transaction) throw new Error("transaction missing");
      Object.assign(transaction, data);
      return transaction;
    },
  };

  wompiPaymentAttemptResolution = {
    create: async ({ data }: { data: Row }) => {
      const row = { id: `resolution-${++this.id}`, createdAt: new Date(), ...data };
      this.resolutions.set(String(row.id), row);
      return row;
    },
  };

  async $transaction<T>(callback: (tx: FakePrisma) => Promise<T>): Promise<T> {
    return callback(this);
  }

  async $queryRaw(strings: TemplateStringsArray): Promise<Array<{ id: string }>> {
    const query = strings.join("");
    if (query.includes('FROM "Order"')) return [{ id: "order-1" }];
    return [...this.jobs.values()]
      .filter((job) => ["PENDING", "RETRY"].includes(String(job.status)))
      .map((job) => ({ id: String(job.id) }));
  }
}

const withEnvironment = async (callback: () => Promise<void>) => {
  const keys = ["JWT_SECRET", "NODE_ENV", "WOMPI_ENVIRONMENT", "WOMPI_PUBLIC_KEY", "WOMPI_PRIVATE_KEY", "WOMPI_INTEGRITY_KEY", "WOMPI_EVENTS_KEY"] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    JWT_SECRET: "integration-test-jwt",
    NODE_ENV: "test",
    WOMPI_ENVIRONMENT: "sandbox",
    WOMPI_PUBLIC_KEY: "test-public-key",
    WOMPI_PRIVATE_KEY: "test-private-key",
    WOMPI_INTEGRITY_KEY: "test-integrity-key",
    WOMPI_EVENTS_KEY: "test-events-key",
  });
  try {
    await callback();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const withApp = async (prisma: FakePrisma, callback: (baseUrl: string) => Promise<void>) => {
  const server = createServer(createApp({ prisma: prisma as unknown as PrismaClient, jwtSecret: "integration-test-jwt" }));
  server.listen(0);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

const makeOrder = () => ({
  id: "order-1",
  total: "150000.00",
  status: "payment_pending",
  paymentStatus: "pending",
  wompiTransactionId: null,
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  items: [{ productId: "printer", title: "Printer", quantity: 1, unit_price: 150000 }],
  customerEmail: "buyer@example.test",
  customerName: "Buyer",
  customerPhone: "3001234567",
});

const makeSignedEvent = (reference: string, id: string, status: string, timestamp: number) => {
  const event = {
    event: "transaction.updated",
    data: {
      transaction: {
        id,
        reference,
        amount_in_cents: 15000000,
        currency: "COP",
        status,
      },
    },
    signature: {
      properties: ["transaction.id", "transaction.reference", "transaction.amount_in_cents", "transaction.currency", "transaction.status"],
      checksum: "",
    },
    timestamp,
  };
  event.signature.checksum = getWompiMerchantSignature(event, "test-events-key")!;
  return event;
};

const postWebhook = (baseUrl: string, event: ReturnType<typeof makeSignedEvent>) =>
  fetch(`${baseUrl}/api/payments/wompi/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-event-checksum": event.signature.checksum },
    body: JSON.stringify(event),
  });

test("payment link attempts are durable, reused, and never POSTed again after an uncertain result", async () => {
  await withEnvironment(async () => {
    const prisma = new FakePrisma();
    prisma.orders.set("order-1", makeOrder());
    const originalFetch = globalThis.fetch;
    let postCount = 0;
    let failPost = false;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:")) return originalFetch(input, init);
      if (url.includes("/merchants/")) {
        return new Response(JSON.stringify({ data: { payment_methods: [{ name: "CARD" }] } }));
      }
      if (url.endsWith("/payment_links") && init?.method === "POST") {
        postCount += 1;
        if (failPost) throw new Error("simulated network interruption");
        return new Response(JSON.stringify({
          data: {
            id: "link-1",
            active: true,
            expires_at: "2099-01-01T00:00:00.000Z",
            reference: "SHELBY-00000000-0000-4000-8000-000000000000",
            amount_in_cents: 15000000,
            currency: "COP",
          },
        }));
      }
      if (url.endsWith("/payment_links/link-1")) {
        const attempt = [...prisma.attempts.values()][0];
        return new Response(JSON.stringify({
          data: {
            id: "link-1",
            active: true,
            expires_at: "2099-01-01T00:00:00.000Z",
            reference: attempt.reference,
            amount_in_cents: 15000000,
            currency: "COP",
          },
        }));
      }
      throw new Error("Unexpected provider request");
    };

    try {
      await withApp(prisma, async (baseUrl) => {
        const requestBody = JSON.stringify({ reference: "order-1", total: 150000, currency: "COP", paymentMethod: "CARD" });
        const firstResponse = await fetch(`${baseUrl}/api/payments/create-wompi-payment`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
        });
        assert.equal(firstResponse.status, 200);
        assert.equal(postCount, 1);
        const first = await firstResponse.json() as { paymentLinkId: string; attemptId: string };
        assert.equal(first.paymentLinkId, "link-1");

        const reusedResponse = await fetch(`${baseUrl}/api/payments/create-wompi-payment`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
        });
        assert.equal(reusedResponse.status, 200);
        assert.equal((await reusedResponse.json() as { reused: boolean }).reused, true);
        assert.equal(postCount, 1);
        assert.equal(prisma.attempts.get(first.attemptId)?.status, "LINK_CREATED");
      });

      const uncertainPrisma = new FakePrisma();
      uncertainPrisma.orders.set("order-1", makeOrder());
      postCount = 0;
      failPost = true;
      await withApp(uncertainPrisma, async (baseUrl) => {
        const requestBody = JSON.stringify({ reference: "order-1", total: 150000, currency: "COP", paymentMethod: "CARD" });
        const firstResponse = await fetch(`${baseUrl}/api/payments/create-wompi-payment`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
        });
        assert.equal(firstResponse.status, 500);
        const attempt = [...uncertainPrisma.attempts.values()][0];
        assert.equal(attempt.status, "UNCERTAIN");

        const retryResponse = await fetch(`${baseUrl}/api/payments/create-wompi-payment`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
        });
        assert.equal(retryResponse.status, 409);
        assert.equal(postCount, 1);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("concurrent payment requests claim one POST and the second request does not mark the live send uncertain", async () => {
  await withEnvironment(async () => {
    const prisma = new FakePrisma();
    prisma.orders.set("order-1", makeOrder());
    const originalFetch = globalThis.fetch;
    let postCount = 0;
    let started!: () => void;
    let release!: () => void;
    const postStarted = new Promise<void>((resolve) => { started = resolve; });
    const heldPost = new Promise<void>((resolve) => { release = resolve; });
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:")) return originalFetch(input, init);
      if (url.includes("/merchants/")) return new Response(JSON.stringify({ data: { payment_methods: [{ name: "CARD" }] } }));
      if (url.endsWith("/payment_links") && init?.method === "POST") {
        postCount += 1;
        started();
        await heldPost;
        return new Response(JSON.stringify({
          data: { id: "concurrent-link", active: true, expires_at: "2099-01-01T00:00:00.000Z" },
        }));
      }
      throw new Error("Unexpected provider request");
    };

    try {
      await withApp(prisma, async (baseUrl) => {
        const requestBody = JSON.stringify({ reference: "order-1", total: 150000, currency: "COP" });
        const firstResponsePromise = fetch(`${baseUrl}/api/payments/create-wompi-payment`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
        });
        await postStarted;
        const duplicateResponse = await fetch(`${baseUrl}/api/payments/create-wompi-payment`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
        });
        assert.equal(duplicateResponse.status, 409);
        assert.equal([...prisma.attempts.values()][0].status, "SENDING");
        release();
        const firstResponse = await firstResponsePromise;
        assert.equal(firstResponse.status, 200);
        assert.equal([...prisma.attempts.values()][0].status, "LINK_CREATED");
        assert.equal(postCount, 1);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("authenticated webhook receipts recover missing jobs and reconcile approval once", async () => {
  await withEnvironment(async () => {
    const prisma = new FakePrisma();
    prisma.orders.set("order-1", makeOrder());
    const attempt = {
      id: "attempt-1",
      orderId: "order-1",
      reference: "SHELBY-ATTEMPT-1",
      amountInCents: 15000000n,
      currency: "COP",
      snapshot: { orderId: "order-1", amountInCents: 15000000, currency: "COP" },
      status: "LINK_CREATED",
      paymentLinkId: "link-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.attempts.set(attempt.id, attempt);
    const event = {
      event: "transaction.updated",
      data: {
        transaction: {
          id: "tx-1",
          reference: attempt.reference,
          amount_in_cents: 15000000,
          currency: "COP",
          status: "APPROVED",
        },
      },
      signature: {
        properties: ["transaction.id", "transaction.reference", "transaction.amount_in_cents", "transaction.currency", "transaction.status"],
        checksum: "",
      },
      timestamp: 1793300000,
    };
    event.signature.checksum = getWompiMerchantSignature(event, "test-events-key")!;
    const body = JSON.stringify(event);

    await withApp(prisma, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/payments/wompi/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-event-checksum": event.signature.checksum },
        body,
      });
      assert.equal(response.status, 200);
      assert.equal(prisma.orders.get("order-1")?.status, "payment_pending");
      assert.equal(prisma.receipts.size, 1);
      assert.equal(prisma.jobs.size, 1);

      const receipt = [...prisma.receipts.values()][0];
      prisma.jobs.delete([...prisma.jobs.keys()][0]);
      const recovered = await fetch(`${baseUrl}/api/payments/wompi/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-event-checksum": event.signature.checksum },
        body,
      });
      assert.equal(recovered.status, 200);
      assert.equal((await recovered.json() as { duplicate: boolean }).duplicate, true);
      assert.equal(prisma.jobs.size, 1);

      assert.equal(await processPendingWompiWebhookJobs(prisma as unknown as PrismaClient), 1);
      assert.equal(prisma.orders.get("order-1")?.status, "payment_approved");
      assert.equal(prisma.transactions.get("tx-1")?.status, "APPROVED");
      assert.equal(prisma.attempts.get(attempt.id)?.status, "CLOSED");
      assert.equal(prisma.jobs.get([...prisma.jobs.keys()][0])?.status, "DONE");
      assert.equal(receipt.id, [...prisma.receipts.values()][0].id);
      assert.equal(await processPendingWompiWebhookJobs(prisma as unknown as PrismaClient), 0);
    });
  });
});

test("late approvals are retained and a second approved transaction is reviewed without overwriting the first", async () => {
    await withEnvironment(async () => {
      const prisma = new FakePrisma();
      prisma.orders.set("order-1", makeOrder());
      const oldAttempt = {
        id: "old-attempt",
        orderId: "order-1",
        reference: "SHELBY-OLD",
        amountInCents: 15000000n,
        currency: "COP",
        snapshot: { orderId: "order-1", amountInCents: 15000000, currency: "COP" },
        status: "REJECTED",
        paymentLinkId: "old-link",
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
        updatedAt: new Date(),
      };
      const currentAttempt = {
        ...oldAttempt,
        id: "current-attempt",
        reference: "SHELBY-CURRENT",
        status: "LINK_CREATED",
        paymentLinkId: "current-link",
        createdAt: new Date("2026-10-20T00:00:00.000Z"),
      };
      prisma.attempts.set(oldAttempt.id, oldAttempt);
      prisma.attempts.set(currentAttempt.id, currentAttempt);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.startsWith("http://127.0.0.1:")) return originalFetch(input, init);
        if (url.endsWith("/transactions/tx-old")) {
          return new Response(JSON.stringify({ data: { id: "tx-old", reference: oldAttempt.reference, amount_in_cents: 15000000, currency: "COP", status: "APPROVED" } }));
        }
        throw new Error("Unexpected provider request");
      };

      try {
        await withApp(prisma, async (baseUrl) => {
          const lateApproval = makeSignedEvent(oldAttempt.reference, "tx-old", "APPROVED", 1793300001);
          assert.equal((await postWebhook(baseUrl, lateApproval)).status, 200);
          assert.equal(await processPendingWompiWebhookJobs(prisma as unknown as PrismaClient), 1);
          assert.equal(prisma.orders.get("order-1")?.wompiTransactionId, "tx-old");
          assert.equal(prisma.attempts.get(oldAttempt.id)?.status, "CLOSED");
          assert.equal(prisma.attempts.get(currentAttempt.id)?.status, "REVIEW");

          const secondApproval = makeSignedEvent(currentAttempt.reference, "tx-current", "APPROVED", 1793300002);
          assert.equal((await postWebhook(baseUrl, secondApproval)).status, 200);
          assert.equal(await processPendingWompiWebhookJobs(prisma as unknown as PrismaClient), 1);
          assert.equal(prisma.orders.get("order-1")?.wompiTransactionId, "tx-old");
          assert.equal(prisma.transactions.get("tx-current")?.reviewReason, "multiple_approved_transactions_for_order");
          assert.equal(prisma.jobs.get([...prisma.jobs.keys()][1])?.status, "REVIEW");

          const beforeLookup = { ...prisma.orders.get("order-1") };
          const lookupResponse = await fetch(`${baseUrl}/api/payments/transaction-status?transactionId=tx-old`);
          assert.equal(lookupResponse.status, 200);
          assert.deepEqual(prisma.orders.get("order-1"), beforeLookup);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

test("manual uncertain-attempt resolution requires evidence and records the administrator decision", async () => {
    await withEnvironment(async () => {
      const prisma = new FakePrisma();
      prisma.orders.set("order-1", makeOrder());
      prisma.attempts.set("uncertain-attempt", {
        id: "uncertain-attempt",
        orderId: "order-1",
        reference: "SHELBY-UNCERTAIN",
        amountInCents: 15000000n,
        currency: "COP",
        snapshot: { orderId: "order-1", amountInCents: 15000000, currency: "COP" },
        status: "UNCERTAIN",
        paymentLinkId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const token = jwt.sign({
        sub: "admin-1",
        email: "admin@example.test",
        name: "Test Admin",
        cedula: "10000000",
        isAdmin: true,
      }, "integration-test-jwt");
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        if (String(input).startsWith("http://127.0.0.1:")) return originalFetch(input, init);
        throw new Error("Unexpected provider request");
      };

      try {
        await withApp(prisma, async (baseUrl) => {
          const url = `${baseUrl}/api/admin/payments/wompi-attempts/uncertain-attempt/resolve`;
          const invalid = await fetch(url, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ action: "no_transaction_confirmed", note: "done", evidenceReference: "" }),
          });
          assert.equal(invalid.status, 400);
          assert.equal(prisma.attempts.get("uncertain-attempt")?.status, "UNCERTAIN");

          const response = await fetch(url, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({
              action: "no_transaction_confirmed",
              note: "Provider account reviewed; no transaction exists.",
              evidenceReference: "case-2026-1042",
            }),
          });
          assert.equal(response.status, 200);
          assert.equal(prisma.attempts.get("uncertain-attempt")?.status, "CLOSED");
          const resolution = [...prisma.resolutions.values()][0];
          assert.equal(resolution.performedByUserId, "admin-1");
          assert.equal(resolution.previousStatus, "UNCERTAIN");
          assert.equal(resolution.nextStatus, "CLOSED");
          assert.equal(resolution.evidenceReference, "case-2026-1042");
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
