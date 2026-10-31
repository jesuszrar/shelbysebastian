CREATE TABLE "public"."Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ProductCategory" (
    "productId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("productId", "categoryId")
);

CREATE UNIQUE INDEX "Category_slug_key" ON "public"."Category"("slug");
CREATE INDEX "ProductCategory_categoryId_idx" ON "public"."ProductCategory"("categoryId");

ALTER TABLE "public"."ProductCategory"
    ADD CONSTRAINT "ProductCategory_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ProductCategory"
    ADD CONSTRAINT "ProductCategory_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "public"."Category" ("id", "name", "slug", "createdAt", "updatedAt")
VALUES ('category-niimbot', 'NIIMBOT', 'niimbot', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

WITH category_names AS (
    SELECT DISTINCT BTRIM("category") AS "name"
    FROM "public"."Product"
    WHERE BTRIM("category") <> ''
      AND LOWER(BTRIM("category")) <> 'niimbot'
), slug_bases AS (
    SELECT
        "name",
        COALESCE(
            NULLIF(
                TRIM(BOTH '-' FROM REGEXP_REPLACE(
                    TRANSLATE(LOWER("name"), 'áéíóúüñ', 'aeiouun'),
                    '[^a-z0-9]+',
                    '-',
                    'g'
                )),
                ''
            ),
            'category'
        ) AS "baseSlug"
    FROM category_names
), slug_counts AS (
    SELECT
        "name",
        "baseSlug",
        COUNT(*) OVER (PARTITION BY "baseSlug") AS "slugCount"
    FROM slug_bases
)
INSERT INTO "public"."Category" ("id", "name", "slug", "createdAt", "updatedAt")
SELECT
    'legacy-' || MD5("name"),
    "name",
    CASE
        WHEN "slugCount" > 1 OR "baseSlug" = 'niimbot'
            THEN "baseSlug" || '-' || MD5("name")
        ELSE "baseSlug"
    END,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM slug_counts;

INSERT INTO "public"."ProductCategory" ("productId", "categoryId")
SELECT product."id", 'legacy-' || MD5(BTRIM(product."category"))
FROM "public"."Product" AS product
WHERE BTRIM(product."category") <> ''
  AND LOWER(BTRIM(product."category")) <> 'niimbot'
ON CONFLICT ("productId", "categoryId") DO NOTHING;

INSERT INTO "public"."ProductCategory" ("productId", "categoryId")
SELECT product."id", 'category-niimbot'
FROM "public"."Product" AS product
WHERE product."id" IN ('niimbot-b1', 'niimbot-d110', 'd11h')
   OR LOWER(BTRIM(product."category")) = 'niimbot'
ON CONFLICT ("productId", "categoryId") DO NOTHING;
