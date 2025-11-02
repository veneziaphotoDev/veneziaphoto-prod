-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Code" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "shopifyDiscountId" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "maxUsage" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME,
    "originOrderId" TEXT,
    "originOrderGid" TEXT,
    "workshopProductId" TEXT,
    "workshopProductTitle" TEXT,
    "workshopQuantity" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Code_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Referrer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Code" ("active", "code", "createdAt", "expiresAt", "id", "maxUsage", "originOrderGid", "originOrderId", "referrerId", "shopifyDiscountId", "updatedAt", "usageCount", "workshopProductId", "workshopProductTitle") SELECT "active", "code", "createdAt", "expiresAt", "id", "maxUsage", "originOrderGid", "originOrderId", "referrerId", "shopifyDiscountId", "updatedAt", "usageCount", "workshopProductId", "workshopProductTitle" FROM "Code";
DROP TABLE "Code";
ALTER TABLE "new_Code" RENAME TO "Code";
CREATE UNIQUE INDEX "Code_code_key" ON "Code"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
