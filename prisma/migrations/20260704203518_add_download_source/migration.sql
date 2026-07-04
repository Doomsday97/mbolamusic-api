-- AlterTable
ALTER TABLE "Download" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'PURCHASED';

-- CreateIndex
CREATE INDEX "Download_userId_source_createdAt_idx" ON "Download"("userId", "source", "createdAt");
