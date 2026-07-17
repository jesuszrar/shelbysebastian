-- Alter Order table to store coupon and discount details
ALTER TABLE `Order`
  ADD COLUMN `discountAmount` DECIMAL(12, 2) NULL,
  ADD COLUMN `couponCode` VARCHAR(191) NULL;

-- Create Coupon table for discount codes
CREATE TABLE `Coupon` (
  `code` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `value` DECIMAL(12, 2) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `minimumSubtotal` DECIMAL(12, 2) NULL,
  `expiresAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`code`)
);

ALTER TABLE `Order` ADD INDEX `Order_couponCode_index` (`couponCode`);
