/*
  Warnings:

  - You are about to drop the column `referredId` on the `Referral` table. All the data in the column will be lost.
  - You are about to drop the column `rewardGiven` on the `Referral` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Referral" DROP CONSTRAINT "Referral_referredId_fkey";

-- DropIndex
DROP INDEX "Referral_referredId_key";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "discountCreditId" TEXT;

-- AlterTable
ALTER TABLE "Referral" DROP COLUMN "referredId",
DROP COLUMN "rewardGiven";

-- CreateTable
CREATE TABLE "ReferralSignup" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "counted" BOOLEAN NOT NULL DEFAULT false,
    "countedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralSignup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralDiscountCredit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "ReferralDiscountCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralSignup_referredUserId_key" ON "ReferralSignup"("referredUserId");

-- CreateIndex
CREATE INDEX "ReferralSignup_referrerId_counted_idx" ON "ReferralSignup"("referrerId", "counted");

-- CreateIndex
CREATE INDEX "ReferralDiscountCredit_userId_usedAt_idx" ON "ReferralDiscountCredit"("userId", "usedAt");

-- AddForeignKey
ALTER TABLE "ReferralSignup" ADD CONSTRAINT "ReferralSignup_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralSignup" ADD CONSTRAINT "ReferralSignup_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralDiscountCredit" ADD CONSTRAINT "ReferralDiscountCredit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
