CREATE TABLE "public"."ProductVariantExclusion" (
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductVariantExclusion_pkey" PRIMARY KEY ("variantId")
);

CREATE INDEX "ProductVariantExclusion_productId_idx"
    ON "public"."ProductVariantExclusion"("productId");
