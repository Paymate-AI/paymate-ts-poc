-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "service" TEXT NOT NULL DEFAULT 'Retail';

-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 0;
