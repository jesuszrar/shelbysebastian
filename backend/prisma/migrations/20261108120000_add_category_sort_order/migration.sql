ALTER TABLE "public"."Category"
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

WITH ordered_categories AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (ORDER BY "name" ASC, "id" ASC) - 1 AS position
    FROM "public"."Category"
)
UPDATE "public"."Category" AS category
SET "sortOrder" = ordered_categories.position
FROM ordered_categories
WHERE category."id" = ordered_categories."id";
