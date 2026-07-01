-- CreateTable
CREATE TABLE "Ad" (
    "id"          TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "description" TEXT,
    "linkUrl"     TEXT,
    "imageUrl"    TEXT,
    "slot"        TEXT NOT NULL,
    "bgColor"     TEXT NOT NULL DEFAULT '#1A1200',
    "accentColor" TEXT NOT NULL DEFAULT '#F59E0B',
    "icon"        TEXT NOT NULL DEFAULT 'star',
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "priority"    INTEGER NOT NULL DEFAULT 0,
    "clicks"      INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ad_slot_isActive_idx" ON "Ad"("slot", "isActive");
