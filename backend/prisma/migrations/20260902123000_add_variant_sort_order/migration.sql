ALTER TABLE `ProductVariant`
  ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0;

CREATE INDEX `ProductVariant_productId_sortOrder_idx` ON `ProductVariant`(`productId`, `sortOrder`);