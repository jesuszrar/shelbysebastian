-- Migration: add shipping fields to Order
-- Adds nullable shipping_* columns to be compatible with existing rows
ALTER TABLE `Order`
  ADD COLUMN `shipping_name` VARCHAR(191) NULL,
  ADD COLUMN `shipping_email` VARCHAR(191) NULL,
  ADD COLUMN `shipping_phone` VARCHAR(191) NULL,
  ADD COLUMN `shipping_department` VARCHAR(191) NULL,
  ADD COLUMN `shipping_city` VARCHAR(191) NULL,
  ADD COLUMN `shipping_address` VARCHAR(191) NULL,
  ADD COLUMN `shipping_reference` VARCHAR(191) NULL;
