ALTER TABLE "public"."Product"
  ADD COLUMN "activateWholesale" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "wholesaleMinQty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "wholesaleDiscountPercent" INTEGER NOT NULL DEFAULT 0;