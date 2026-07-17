-- AlterTable
ALTER TABLE `Product` ADD COLUMN `badge` VARCHAR(191) NULL,
    ADD COLUMN `highlight` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `oldPrice` DECIMAL(12, 2) NULL;
