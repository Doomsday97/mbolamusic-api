-- AlterTable
ALTER TABLE "CopyrightClaim" ADD COLUMN     "reporterId" TEXT;

-- AddForeignKey
ALTER TABLE "CopyrightClaim" ADD CONSTRAINT "CopyrightClaim_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
