import crypto from "node:crypto";
import { Prisma, type PrismaClient, type WompiPaymentAttempt, type WompiWebhookJob, type Order } from "@prisma/client";
import { getWompiPaymentCreationError, validateWompiPaymentRequest } from "./wompi-order.js";

const activeAttemptStatuses = ["PREPARED", "SENDING", "LINK_CREATED", "UNCERTAIN", "REVIEW"];
const terminalTransactionStatuses = new Set(["DECLINED", "VOIDED", "ERROR", "FAILED"]);
const supportedTransactionStatuses = new Set(["PENDING", "APPROVED", ...terminalTransactionStatuses]);

export type WompiAttemptReservation =
  | { kind: "send"; attempt: WompiPaymentAttempt; order: Order }
  | { kind: "existing"; attempt: WompiPaymentAttempt; order: Order }
  | { kind: "blocked"; reason: string; attempt: WompiPaymentAttempt }
  | { kind: "not_found" }
  | { kind: "not_payable"; reason: string }
  | { kind: "invalid_request"; reason: string };

const lockOrder = async (tx: Prisma.TransactionClient, orderId: string) => {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
  `;
};

const toAmountInCents = (value: unknown): number | null => {
  const normalized = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
};

export const reserveWompiPaymentAttempt = async (
  prisma: PrismaClient,
  orderId: string,
  request: { reference?: unknown; total?: unknown; currency?: unknown },
): Promise<WompiAttemptReservation> => prisma.$transaction(async (tx) => {
  await lockOrder(tx, orderId);
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) return { kind: "not_found" };

  const requestError = validateWompiPaymentRequest(order, request);
  if (requestError) return { kind: "invalid_request", reason: requestError };

  const creationError = getWompiPaymentCreationError(order);
  const activeAttempt = await tx.wompiPaymentAttempt.findFirst({
    where: { orderId, status: { in: activeAttemptStatuses } },
    orderBy: { createdAt: "desc" },
  });
  if (creationError) {
    if (activeAttempt && activeAttempt.status !== "REVIEW") {
      await tx.wompiPaymentAttempt.update({
        where: { id: activeAttempt.id },
        data: { status: "REVIEW", resolutionNote: "order_no_longer_payable" },
      });
    }
    return { kind: "not_payable", reason: creationError };
  }
  if (activeAttempt) {
    if (activeAttempt.status === "PREPARED") return { kind: "send", attempt: activeAttempt, order };
    if (activeAttempt.status === "SENDING") {
      const staleAfterMs = 2 * 60 * 1000;
      const requestAge = activeAttempt.requestStartedAt
        ? Date.now() - activeAttempt.requestStartedAt.getTime()
        : staleAfterMs;
      if (requestAge >= staleAfterMs) {
        await tx.wompiPaymentAttempt.updateMany({
          where: { id: activeAttempt.id, status: "SENDING" },
          data: { status: "UNCERTAIN", resolutionNote: "sending_attempt_stale_without_provider_confirmation" },
        });
        return { kind: "blocked", reason: "payment_result_uncertain", attempt: activeAttempt };
      }
      return { kind: "blocked", reason: "payment_request_in_progress", attempt: activeAttempt };
    }
    if (activeAttempt.status === "LINK_CREATED") return { kind: "existing", attempt: activeAttempt, order };
    return { kind: "blocked", reason: activeAttempt.status === "UNCERTAIN" ? "payment_result_uncertain" : "payment_requires_review", attempt: activeAttempt };
  }

  const amountInCents = toAmountInCents(order.total);
  if (!amountInCents) return { kind: "not_payable", reason: "order_amount_invalid" };

  const attempt = await tx.wompiPaymentAttempt.create({
    data: {
      orderId,
      reference: `SHELBY-${crypto.randomUUID()}`,
      amountInCents: BigInt(amountInCents),
      currency: "COP",
      snapshot: {
        orderId,
        amountInCents,
        currency: "COP",
        orderCreatedAt: order.createdAt.toISOString(),
        items: order.items as Prisma.InputJsonValue,
      },
      status: "PREPARED",
    },
  });
  return { kind: "send", attempt, order };
});

export const markWompiAttemptSending = async (
  prisma: PrismaClient,
  attemptId: string,
): Promise<WompiPaymentAttempt | null> => prisma.$transaction(async (tx) => {
  const existing = await tx.wompiPaymentAttempt.findUnique({ where: { id: attemptId } });
  if (!existing) return null;
  await lockOrder(tx, existing.orderId);
  const updated = await tx.wompiPaymentAttempt.updateMany({
    where: { id: attemptId, status: "PREPARED" },
    data: { status: "SENDING", requestStartedAt: new Date() },
  });
  return updated.count === 1
    ? tx.wompiPaymentAttempt.findUnique({ where: { id: attemptId } })
    : null;
});

export const recordWompiAttemptLink = async (
  prisma: PrismaClient,
  attemptId: string,
  data: { paymentLinkId: string; paymentUrl: string; expiresAt: Date | null },
) => {
  const updated = await prisma.wompiPaymentAttempt.updateMany({
    where: { id: attemptId, status: "SENDING" },
    data: { ...data, status: "LINK_CREATED" },
  });
  if (updated.count === 1) return;

  const current = await prisma.wompiPaymentAttempt.findUnique({ where: { id: attemptId } });
  if (current?.status === "CLOSED" || current?.status === "REJECTED" || current?.status === "REVIEW") return;
  throw new Error("Wompi link was created but the attempt could not be persisted");
};

export const markWompiAttemptUncertain = async (prisma: PrismaClient, attemptId: string, reason: string) => {
  await prisma.wompiPaymentAttempt.updateMany({
    where: { id: attemptId, status: "SENDING" },
    data: { status: "UNCERTAIN", resolutionNote: reason },
  });
};

export const persistWompiWebhookReceipt = async (
  prisma: PrismaClient,
  rawBody: string,
  payload: Prisma.InputJsonValue,
) => {
  const bodyHash = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.wompiWebhookReceipt.findUnique({ where: { bodyHash } });
    const receipt = await tx.wompiWebhookReceipt.upsert({
      where: { bodyHash },
      create: { bodyHash, payload },
      update: {},
    });
    const job = await tx.wompiWebhookJob.upsert({
      where: { receiptId: receipt.id },
      create: { receiptId: receipt.id, status: "PENDING" },
      update: {},
    });
    return { receiptId: receipt.id, jobId: job.id, duplicate: Boolean(existing) };
  });
};

const readEventTransaction = (payload: Prisma.JsonValue): Record<string, unknown> | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const event = payload as Record<string, unknown>;
  const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : null;
  const transaction = data?.transaction ?? event.transaction ?? data;
  return transaction && typeof transaction === "object" && !Array.isArray(transaction)
    ? transaction as Record<string, unknown>
    : null;
};

const setReview = async (
  tx: Prisma.TransactionClient,
  job: WompiWebhookJob,
  reason: string,
) => {
  await tx.wompiWebhookReceipt.update({
    where: { id: job.receiptId },
    data: { reviewReason: reason },
  });
  await tx.wompiWebhookJob.update({
    where: { id: job.id },
    data: { status: "REVIEW", lockedAt: null, lastError: reason },
  });
};

const isApprovedOrder = (order: { status: string; paymentStatus: string | null }) =>
  ["payment_approved", "paid", "approved", "completed", "shipped", "delivered"].includes(order.status.toLowerCase()) ||
  order.paymentStatus?.toLowerCase() === "approved";

const processWompiWebhookJob = async (prisma: PrismaClient, job: WompiWebhookJob & { receipt: { id: string; payload: Prisma.JsonValue } }) => {
  const transaction = readEventTransaction(job.receipt.payload);
  const providerTransactionId = String(transaction?.id ?? "").trim();
  const reference = String(transaction?.reference ?? "").trim();
  const status = String(transaction?.status ?? "").trim().toUpperCase();
  const rawAmount = transaction?.amount_in_cents;
  const amountInCents = typeof rawAmount === "number" && Number.isSafeInteger(rawAmount) && rawAmount > 0
    ? rawAmount
    : null;
  const currency = typeof transaction?.currency === "string" ? transaction.currency.trim().toUpperCase() : null;

  await prisma.$transaction(async (tx) => {
    if (!providerTransactionId || !reference || !status || !transaction) {
      await setReview(tx, job, "authenticated_event_missing_transaction_identity");
      return;
    }

    const initialAttempt = await tx.wompiPaymentAttempt.findUnique({ where: { reference } });
    const orderId = initialAttempt?.orderId ?? reference;
    const existingOrder = await tx.order.findUnique({ where: { id: orderId } });
    if (existingOrder) await lockOrder(tx, orderId);

    const attempt = initialAttempt
      ? await tx.wompiPaymentAttempt.findUnique({ where: { id: initialAttempt.id } })
      : null;
    const order = existingOrder
      ? await tx.order.findUnique({ where: { id: existingOrder.id } })
      : null;
    const previousTransaction = await tx.wompiTransaction.findUnique({
      where: { providerTransactionId },
    });

    const identityConflict = previousTransaction && (
      previousTransaction.reference !== reference ||
      previousTransaction.orderId !== (order?.id ?? null) ||
      Number(previousTransaction.amountInCents) !== amountInCents ||
      previousTransaction.currency !== currency
    );
    if (identityConflict) {
      await setReview(tx, job, "provider_transaction_id_conflicts_with_persisted_identity");
      return;
    }

    const financialMismatch = !attempt
      ? "no_immutable_attempt_snapshot"
      : !amountInCents
        ? "transaction_amount_missing_or_invalid"
        : currency !== attempt.currency
          ? "transaction_currency_mismatch"
          : BigInt(amountInCents) !== attempt.amountInCents
            ? "transaction_amount_mismatch"
            : !supportedTransactionStatuses.has(status)
              ? "unsupported_transaction_status"
              : null;

    const reviewReason = financialMismatch ?? (!order ? "order_not_found" : null);
    if (!previousTransaction) {
      await tx.wompiTransaction.create({
        data: {
          providerTransactionId,
          attemptId: attempt?.id ?? null,
          orderId: order?.id ?? null,
          reference,
          amountInCents: amountInCents === null ? null : BigInt(amountInCents),
          currency,
          status: reviewReason ? "REVIEW" : status,
          reviewReason,
          payload: job.receipt.payload as Prisma.InputJsonValue,
        },
      });
    } else if (!reviewReason && previousTransaction.status !== "APPROVED") {
      await tx.wompiTransaction.update({
        where: { providerTransactionId },
        data: {
          status,
          payload: job.receipt.payload as Prisma.InputJsonValue,
        },
      });
    }

    if (reviewReason) {
      if (attempt) {
        await tx.wompiPaymentAttempt.update({
          where: { id: attempt.id },
          data: { status: "REVIEW", resolutionNote: reviewReason },
        });
      }
      await setReview(tx, job, reviewReason);
      return;
    }

    const currentTransaction = await tx.wompiTransaction.findUniqueOrThrow({
      where: { providerTransactionId },
    });
    if (status === "APPROVED" && order) {
      if (isApprovedOrder(order) && order.wompiTransactionId !== providerTransactionId) {
        await tx.wompiTransaction.update({
          where: { providerTransactionId },
          data: { reviewReason: "multiple_approved_transactions_for_order" },
        });
        await tx.wompiPaymentAttempt.update({
          where: { id: attempt!.id },
          data: { status: "REVIEW", resolutionNote: "multiple_approved_transactions_for_order" },
        });
        await setReview(tx, job, "multiple_approved_transactions_for_order");
        return;
      }

      if (!isApprovedOrder(order)) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "payment_approved",
            paymentStatus: "approved",
            wompiTransactionId: providerTransactionId,
          },
        });
      }
      await tx.wompiPaymentAttempt.update({
        where: { id: attempt!.id },
        data: { status: "CLOSED" },
      });
      await tx.wompiPaymentAttempt.updateMany({
        where: {
          orderId: order.id,
          id: { not: attempt!.id },
          status: { in: activeAttemptStatuses },
        },
        data: { status: "REVIEW", resolutionNote: "another_attempt_approved_for_order" },
      });
    } else if (status !== "APPROVED" && order && !isApprovedOrder(order)) {
      const latestAttempt = await tx.wompiPaymentAttempt.findFirst({
        where: { orderId: order.id },
        orderBy: { createdAt: "desc" },
      });
      if (latestAttempt?.id === attempt!.id && status !== "PENDING") {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "payment_failed",
            paymentStatus: "failed",
            wompiTransactionId: providerTransactionId,
          },
        });
      } else if (latestAttempt?.id === attempt!.id && !order.wompiTransactionId) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "payment_pending",
            paymentStatus: "pending",
            wompiTransactionId: providerTransactionId,
          },
        });
      }
      if (terminalTransactionStatuses.has(status)) {
        await tx.wompiPaymentAttempt.update({
          where: { id: attempt!.id },
          data: { status: "REJECTED" },
        });
      }
    }

    if (currentTransaction.status === "APPROVED" && status !== "APPROVED") {
      await tx.wompiTransaction.update({
        where: { providerTransactionId },
        data: { status: "APPROVED" },
      });
    }
    await tx.wompiWebhookJob.update({
      where: { id: job.id },
      data: { status: "DONE", lockedAt: null, completedAt: new Date(), lastError: null },
    });
  });
};

const claimWompiWebhookJobs = async (prisma: PrismaClient, limit: number) => prisma.$transaction(async (tx) => {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "WompiWebhookJob"
    WHERE (
      "status" IN ('PENDING', 'RETRY')
      AND "nextAttemptAt" <= NOW()
    ) OR (
      "status" = 'PROCESSING'
      AND ("lockedAt" IS NULL OR "lockedAt" < NOW() - INTERVAL '5 minutes')
    )
    ORDER BY "nextAttemptAt", "createdAt"
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED
  `;
  const ids = rows.map((row) => row.id);
  if (!ids.length) return [];
  await tx.wompiWebhookJob.updateMany({
    where: { id: { in: ids } },
    data: { status: "PROCESSING", lockedAt: new Date(), attempts: { increment: 1 } },
  });
  return tx.wompiWebhookJob.findMany({
    where: { id: { in: ids } },
    include: { receipt: true },
  });
});

export const processPendingWompiWebhookJobs = async (prisma: PrismaClient, limit = 10) => {
  await prisma.wompiPaymentAttempt.updateMany({
    where: {
      status: "SENDING",
      requestStartedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) },
    },
    data: {
      status: "UNCERTAIN",
      resolutionNote: "sending_attempt_stale_without_provider_confirmation",
    },
  });
  const jobs = await claimWompiWebhookJobs(prisma, limit);
  for (const job of jobs) {
    try {
      await processWompiWebhookJob(prisma, job);
    } catch (error) {
      const attempts = job.attempts;
      const retryDelayMs = Math.min(60 * 60 * 1000, 1000 * 2 ** Math.min(attempts, 12));
      try {
        await prisma.$transaction(async (tx) => {
          if (attempts >= 12) {
            await tx.wompiWebhookReceipt.update({
              where: { id: job.receiptId },
              data: { reviewReason: "worker_retry_limit_exceeded" },
            });
            await tx.wompiWebhookJob.updateMany({
              where: { id: job.id, status: "PROCESSING" },
              data: { status: "REVIEW", lockedAt: null, lastError: "worker_retry_limit_exceeded" },
            });
          } else {
            const errorCode = error && typeof error === "object" && "code" in error
              ? String((error as { code?: unknown }).code ?? "unknown")
              : error instanceof Error ? error.name : "unknown";
            await tx.wompiWebhookJob.updateMany({
              where: { id: job.id, status: "PROCESSING" },
              data: {
                status: "RETRY",
                lockedAt: null,
                nextAttemptAt: new Date(Date.now() + retryDelayMs),
                lastError: `reconciliation_retry:${errorCode}`.slice(0, 1000),
              },
            });
          }
        });
      } catch (retryError) {
        console.error("[wompi worker] could not schedule retry", {
          jobId: job.id,
          error: retryError instanceof Error ? retryError.name : "unknown",
        });
      }
      console.error("[wompi worker] reconciliation attempt failed", {
        jobId: job.id,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  return jobs.length;
};

export const startWompiWebhookWorker = (prisma: PrismaClient) => {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const run = async () => {
    if (stopped) return;
    try {
      await processPendingWompiWebhookJobs(prisma);
    } catch (error) {
      console.error("[wompi worker] job scan failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    if (!stopped) {
      timer = setTimeout(() => void run(), 3000);
      timer.unref();
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
};
