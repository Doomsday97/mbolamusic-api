-- MonthlyConfig: configurable parameters per month
CREATE TABLE IF NOT EXISTS "MonthlyConfig" (
  "id"                TEXT NOT NULL,
  "month"             TEXT NOT NULL,
  "subscriptionValue" INTEGER NOT NULL DEFAULT 2000,
  "adminPct"          INTEGER NOT NULL DEFAULT 30,
  "artistPct"         INTEGER NOT NULL DEFAULT 70,
  "minPlaysThreshold" INTEGER NOT NULL DEFAULT 1000,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonthlyConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MonthlyConfig_month_key" ON "MonthlyConfig"("month");

-- AdminMonthlyEarning: aggregate admin earnings per month
CREATE TABLE IF NOT EXISTS "AdminMonthlyEarning" (
  "id"                TEXT NOT NULL,
  "month"             TEXT NOT NULL,
  "totalSubscribers"  INTEGER NOT NULL,
  "totalFund"         INTEGER NOT NULL,
  "adminAmount"       INTEGER NOT NULL,
  "artistPool"        INTEGER NOT NULL,
  "distributedAmount" INTEGER NOT NULL DEFAULT 0,
  "reserveAmount"     INTEGER NOT NULL DEFAULT 0,
  "processedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminMonthlyEarning_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdminMonthlyEarning_month_key" ON "AdminMonthlyEarning"("month");

-- Add reserveAmount to MonthlyDistribution
ALTER TABLE "MonthlyDistribution" ADD COLUMN IF NOT EXISTS "reserveAmount" INTEGER NOT NULL DEFAULT 0;
