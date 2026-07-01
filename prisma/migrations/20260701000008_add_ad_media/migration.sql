-- Add mediaUrl and mediaType columns to Ad table for image/video uploads
ALTER TABLE "Ad" ADD COLUMN "mediaUrl" TEXT;
ALTER TABLE "Ad" ADD COLUMN "mediaType" TEXT;
