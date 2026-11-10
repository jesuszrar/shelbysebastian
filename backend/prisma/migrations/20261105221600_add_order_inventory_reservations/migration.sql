ALTER TABLE "Order"
ADD COLUMN "inventoryReviewReason" TEXT;

CREATE TABLE "OrderInventoryReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderInventoryReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderInventoryReservation_orderId_lineIndex_key"
    ON "OrderInventoryReservation"("orderId", "lineIndex");
CREATE INDEX "OrderInventoryReservation_orderId_status_idx"
    ON "OrderInventoryReservation"("orderId", "status");
