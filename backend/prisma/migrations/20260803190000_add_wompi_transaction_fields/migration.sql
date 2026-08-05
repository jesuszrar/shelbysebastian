-- Add Wompi transaction fields to Order
ALTER TABLE `Order`
  ADD COLUMN `wompiTransactionId` VARCHAR(191) NULL UNIQUE,
  ADD COLUMN `paymentStatus` VARCHAR(191) NULL;
