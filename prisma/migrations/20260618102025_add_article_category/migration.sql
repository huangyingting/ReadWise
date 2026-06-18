-- AlterTable
ALTER TABLE "Article" ADD COLUMN "category" TEXT;

-- CreateIndex
CREATE INDEX "Article_category_idx" ON "Article"("category");
