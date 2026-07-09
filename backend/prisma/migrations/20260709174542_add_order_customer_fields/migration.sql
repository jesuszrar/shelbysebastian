-- AlterTable
ALTER TABLE `Order` ADD COLUMN `customerAddress` VARCHAR(191) NULL,
    ADD COLUMN `customerCity` VARCHAR(191) NULL,
    ADD COLUMN `customerEmail` VARCHAR(191) NULL,
    ADD COLUMN `customerName` VARCHAR(191) NULL,
    ADD COLUMN `customerPhone` VARCHAR(191) NULL,
    ADD COLUMN `invoiceSentAt` DATETIME(3) NULL,
    ADD COLUMN `notes` TEXT NULL,
    ADD COLUMN `paymentMethod` VARCHAR(191) NULL,
    ADD COLUMN `shipping` INTEGER NOT NULL DEFAULT 0;
