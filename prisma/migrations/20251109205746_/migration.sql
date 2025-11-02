/*
  Warnings:

  - A unique constraint covering the columns `[orderId]` on the table `Referral` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Referral_orderId_key" ON "public"."Referral"("orderId");
