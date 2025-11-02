-- AlterTable
ALTER TABLE "Code" ADD COLUMN "workshopProductId" TEXT;
ALTER TABLE "Code" ADD COLUMN "workshopProductTitle" TEXT;

-- AlterTable
ALTER TABLE "Referral" ADD COLUMN "workshopProductId" TEXT;
ALTER TABLE "Referral" ADD COLUMN "workshopProductTitle" TEXT;

-- AlterTable
ALTER TABLE "Reward" ADD COLUMN "workshopProductId" TEXT;
ALTER TABLE "Reward" ADD COLUMN "workshopProductTitle" TEXT;
