-- Borrado suave de canciones: se marcan con deletedAt en vez de borrarse al
-- instante, permitiendo restaurarlas dentro de las 48h siguientes.
ALTER TABLE "Track" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "Track_deletedAt_idx" ON "Track"("deletedAt");
