ALTER TABLE "Order"
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'COP';

CREATE TABLE "MetaPurchaseClaim" (
    "orderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetaPurchaseClaim_pkey" PRIMARY KEY ("orderId"),
    CONSTRAINT "MetaPurchaseClaim_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MetaPurchaseClaim_tokenHash_key" ON "MetaPurchaseClaim"("tokenHash");
