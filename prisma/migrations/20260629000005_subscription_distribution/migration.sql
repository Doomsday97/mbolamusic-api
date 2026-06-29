-- Add artistId to Play (nullable; backfilled from Track)
ALTER TABLE "Play" ADD COLUMN IF NOT EXISTS "artistId" TEXT;
UPDATE "Play" p SET "artistId" = t."artistId" FROM "Track" t WHERE p."trackId" = t."id" AND p."artistId" IS NULL;
ALTER TABLE "Play" ADD CONSTRAINT "Play_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "ArtistProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Play_artistId_idx" ON "Play"("artistId");

-- MonthlyDistribution
CREATE TABLE IF NOT EXISTS "MonthlyDistribution" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "month"        TEXT NOT NULL,
  "totalPlays"   INTEGER NOT NULL,
  "artistPool"   INTEGER NOT NULL DEFAULT 1400,
  "adminShare"   INTEGER NOT NULL DEFAULT 600,
  "processedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonthlyDistribution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MonthlyDistribution_userId_month_key" ON "MonthlyDistribution"("userId", "month");
CREATE INDEX IF NOT EXISTS "MonthlyDistribution_month_idx" ON "MonthlyDistribution"("month");
ALTER TABLE "MonthlyDistribution"
  ADD CONSTRAINT "MonthlyDistribution_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ArtistMonthlyEarning
CREATE TABLE IF NOT EXISTS "ArtistMonthlyEarning" (
  "id"             TEXT NOT NULL,
  "distributionId" TEXT NOT NULL,
  "artistId"       TEXT NOT NULL,
  "month"          TEXT NOT NULL,
  "playsCount"     INTEGER NOT NULL,
  "amount"         INTEGER NOT NULL,
  "isPaid"         BOOLEAN NOT NULL DEFAULT false,
  "paidAt"         TIMESTAMP(3),
  CONSTRAINT "ArtistMonthlyEarning_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ArtistMonthlyEarning_distributionId_artistId_key" ON "ArtistMonthlyEarning"("distributionId", "artistId");
CREATE INDEX IF NOT EXISTS "ArtistMonthlyEarning_artistId_month_idx" ON "ArtistMonthlyEarning"("artistId", "month");
CREATE INDEX IF NOT EXISTS "ArtistMonthlyEarning_month_idx" ON "ArtistMonthlyEarning"("month");
ALTER TABLE "ArtistMonthlyEarning"
  ADD CONSTRAINT "ArtistMonthlyEarning_distributionId_fkey"
  FOREIGN KEY ("distributionId") REFERENCES "MonthlyDistribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistMonthlyEarning"
  ADD CONSTRAINT "ArtistMonthlyEarning_artistId_fkey"
  FOREIGN KEY ("artistId") REFERENCES "ArtistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
