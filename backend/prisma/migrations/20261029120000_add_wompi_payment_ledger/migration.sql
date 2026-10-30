CREATE TABLE "WompiPaymentAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amountInCents" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "paymentLinkId" TEXT,
    "paymentUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "requestStartedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WompiPaymentAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WompiPaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WompiPaymentAttempt_reference_key" ON "WompiPaymentAttempt"("reference");
CREATE UNIQUE INDEX "WompiPaymentAttempt_paymentLinkId_key" ON "WompiPaymentAttempt"("paymentLinkId");
CREATE INDEX "WompiPaymentAttempt_orderId_createdAt_idx" ON "WompiPaymentAttempt"("orderId", "createdAt");
CREATE INDEX "WompiPaymentAttempt_status_updatedAt_idx" ON "WompiPaymentAttempt"("status", "updatedAt");
CREATE UNIQUE INDEX "WompiPaymentAttempt_one_open_per_order_key"
    ON "WompiPaymentAttempt"("orderId")
    WHERE "status" IN ('PREPARED', 'SENDING', 'LINK_CREATED', 'UNCERTAIN', 'REVIEW');

CREATE TABLE "WompiPaymentAttemptResolution" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "performedByUserId" TEXT,
    "previousStatus" TEXT NOT NULL,
    "nextStatus" TEXT NOT NULL,
    "evidenceReference" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WompiPaymentAttemptResolution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WompiPaymentAttemptResolution_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "WompiPaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WompiPaymentAttemptResolution_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "WompiPaymentAttemptResolution_attemptId_createdAt_idx" ON "WompiPaymentAttemptResolution"("attemptId", "createdAt");
CREATE INDEX "WompiPaymentAttemptResolution_performedByUserId_createdAt_idx" ON "WompiPaymentAttemptResolution"("performedByUserId", "createdAt");

CREATE TABLE "WompiTransaction" (
    "id" TEXT NOT NULL,
    "providerTransactionId" TEXT NOT NULL,
    "attemptId" TEXT,
    "orderId" TEXT,
    "reference" TEXT NOT NULL,
    "amountInCents" BIGINT,
    "currency" TEXT,
    "status" TEXT NOT NULL,
    "reviewReason" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WompiTransaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WompiTransaction_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "WompiPaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WompiTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WompiTransaction_providerTransactionId_key" ON "WompiTransaction"("providerTransactionId");
CREATE INDEX "WompiTransaction_orderId_createdAt_idx" ON "WompiTransaction"("orderId", "createdAt");
CREATE INDEX "WompiTransaction_attemptId_createdAt_idx" ON "WompiTransaction"("attemptId", "createdAt");
CREATE INDEX "WompiTransaction_reference_idx" ON "WompiTransaction"("reference");

CREATE TABLE "WompiWebhookReceipt" (
    "id" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewReason" TEXT,
    CONSTRAINT "WompiWebhookReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WompiWebhookReceipt_bodyHash_key" ON "WompiWebhookReceipt"("bodyHash");

CREATE TABLE "WompiWebhookJob" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WompiWebhookJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WompiWebhookJob_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "WompiWebhookReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WompiWebhookJob_receiptId_key" ON "WompiWebhookJob"("receiptId");
CREATE INDEX "WompiWebhookJob_status_nextAttemptAt_idx" ON "WompiWebhookJob"("status", "nextAttemptAt");
