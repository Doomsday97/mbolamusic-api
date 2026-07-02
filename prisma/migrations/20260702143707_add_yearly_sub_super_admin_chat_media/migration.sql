-- AlterEnum
ALTER TYPE "SubscriptionType" ADD VALUE 'LISTENER_YEARLY';

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "mediaType" TEXT,
ADD COLUMN     "mediaUrl" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "previousRole" "Role";
