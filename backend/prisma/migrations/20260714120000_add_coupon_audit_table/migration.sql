-- Create CouponAudit table to log coupon changes and support audit history
CREATE TABLE `CouponAudit` (
  `id` VARCHAR(191) NOT NULL,
  `couponCode` VARCHAR(191) NOT NULL,
  `action` VARCHAR(191) NOT NULL,
  `performedByUserId` VARCHAR(191) NULL,
  `performedByEmail` VARCHAR(191) NULL,
  `details` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);

ALTER TABLE `CouponAudit` ADD INDEX `CouponAudit_couponCode_index` (`couponCode`);
