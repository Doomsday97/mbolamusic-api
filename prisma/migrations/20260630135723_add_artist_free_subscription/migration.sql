-- AlterEnum
ALTER TYPE "SubscriptionType" ADD VALUE 'ARTIST_FREE';

-- AlterTable
ALTER TABLE "AdminMonthlyEarning" ALTER COLUMN "distributedAmount" DROP DEFAULT,
ALTER COLUMN "reserveAmount" DROP DEFAULT;
