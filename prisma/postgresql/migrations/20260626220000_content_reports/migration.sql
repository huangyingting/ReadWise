-- Migration: content_reports (PostgreSQL)
-- Adds the ContentReport table for user-submitted content reports and the
-- admin moderation queue (#738).

-- CreateEnum
CREATE TYPE "ContentReportReason" AS ENUM ('rights_copyright', 'unsafe_content', 'extraction_broken', 'wrong_level', 'inaccurate_ai', 'classroom_concern', 'other');

-- CreateEnum
CREATE TYPE "ContentReportStatus" AS ENUM ('open', 'reviewing', 'resolved', 'dismissed');

-- CreateTable
CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "reason" "ContentReportReason" NOT NULL,
    "note" TEXT,
    "status" "ContentReportStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ContentReport_articleId_createdAt_idx" ON "ContentReport"("articleId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentReport_status_createdAt_idx" ON "ContentReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ContentReport_reporterUserId_articleId_idx" ON "ContentReport"("reporterUserId", "articleId");
