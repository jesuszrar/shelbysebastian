CREATE TABLE "public"."ProductExclusion" (
    "productId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductExclusion_pkey" PRIMARY KEY ("productId")
);
