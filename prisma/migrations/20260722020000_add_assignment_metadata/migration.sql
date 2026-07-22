-- Optional assignment metadata (GAP-7, #1251): display title override + point weighting.
ALTER TABLE "Assignment" ADD COLUMN "title" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "points" INTEGER;
