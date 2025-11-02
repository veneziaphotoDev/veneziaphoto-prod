-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "discountPercentage" REAL NOT NULL DEFAULT 0.1,
    "cashbackAmount" REAL NOT NULL DEFAULT 20,
    "codeValidityDays" INTEGER NOT NULL DEFAULT 30,
    "appliesOncePerCustomer" BOOLEAN NOT NULL DEFAULT true,
    "maxUsagePerCode" INTEGER NOT NULL DEFAULT 0,
    "maxRefundPercentage" REAL NOT NULL DEFAULT 1.0,
    "customerSegmentIds" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSetting" ("appliesOncePerCustomer", "cashbackAmount", "codeValidityDays", "createdAt", "customerSegmentIds", "discountPercentage", "id", "maxUsagePerCode", "updatedAt") SELECT "appliesOncePerCustomer", "cashbackAmount", "codeValidityDays", "createdAt", "customerSegmentIds", "discountPercentage", "id", "maxUsagePerCode", "updatedAt" FROM "AppSetting";
DROP TABLE "AppSetting";
ALTER TABLE "new_AppSetting" RENAME TO "AppSetting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
