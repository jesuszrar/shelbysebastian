CREATE TABLE "public"."NiimbotPageImage" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "alt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NiimbotPageImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NiimbotPageImage_key_key" ON "public"."NiimbotPageImage"("key");
