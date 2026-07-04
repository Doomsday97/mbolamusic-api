-- CreateTable
CREATE TABLE "CopyrightClaim" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "claimantName" TEXT NOT NULL,
    "claimantEmail" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "contactedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CopyrightClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CopyrightClaim_trackId_idx" ON "CopyrightClaim"("trackId");

-- CreateIndex
CREATE INDEX "CopyrightClaim_status_idx" ON "CopyrightClaim"("status");

-- AddForeignKey
ALTER TABLE "CopyrightClaim" ADD CONSTRAINT "CopyrightClaim_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
