/**
 * Thin force-rescrape QUERY layer (issue #1102, Phase 3.3).
 *
 * Read-only, METADATA-ONLY Prisma reads for the capability-gated admin
 * force-rescrape API: the sanitized content-version status/history DTOs and the
 * small helpers the runner composes for its dry-run PREVIEW. Every exposed field
 * is a controlled id, status enum, fingerprint key, count, timestamp, sanitized
 * reason/failure CATEGORY, or a derived number — NEVER the versioned `content`,
 * `title`, `sourceUrl`, `canonicalUrl`, or any user-private text (those live only
 * on the authoritative `ArticleContentVersion` row). It NEVER mutates state.
 */
import { ArticleContentVersionStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/** Metadata-only projection of a content version (NO content/title/URLs). */
const VERSION_DTO_SELECT = {
  id: true,
  status: true,
  fingerprint: true,
  fingerprintVersion: true,
  extractorVersion: true,
  requestedById: true,
  reason: true,
  failureReason: true,
  wordCount: true,
  readingMinutes: true,
  pendingForArticleId: true,
  activeForArticleId: true,
  derivedRegenerationRequestedAt: true,
  createdAt: true,
  activatedAt: true,
  supersededAt: true,
  updatedAt: true,
} satisfies Prisma.ArticleContentVersionSelect;

type VersionRow = Prisma.ArticleContentVersionGetPayload<{ select: typeof VERSION_DTO_SELECT }>;

/** A sanitized content-version DTO for the admin API (metadata only). */
export type ForceRescrapeVersionDto = {
  id: string;
  status: ArticleContentVersionStatus;
  /** True while this version is the live readable version. */
  isActive: boolean;
  /** True while this version is fetched-and-validating (holds the pending lock). */
  isPending: boolean;
  /** Versioned prose fingerprint key (`v<n>:<sha256>`) — never the prose. */
  fingerprint: string | null;
  fingerprintVersion: number | null;
  extractorVersion: number | null;
  /** Sanitized actor id who requested this version (null for a system baseline). */
  requestedById: string | null;
  /** Sanitized operator justification (or the system baseline marker). */
  reason: string;
  /** Machine failure code for a REJECTED/FAILED version (never content). */
  failureReason: string | null;
  wordCount: number | null;
  readingMinutes: number | null;
  /** Set when activation marked derived outputs for regeneration (#1103 seam). */
  derivedRegenerationRequestedAt: Date | null;
  createdAt: Date;
  activatedAt: Date | null;
  supersededAt: Date | null;
  updatedAt: Date;
};

function toVersionDto(row: VersionRow): ForceRescrapeVersionDto {
  return {
    id: row.id,
    status: row.status,
    isActive: row.activeForArticleId !== null,
    isPending: row.pendingForArticleId !== null,
    fingerprint: row.fingerprint,
    fingerprintVersion: row.fingerprintVersion,
    extractorVersion: row.extractorVersion,
    requestedById: row.requestedById,
    reason: row.reason,
    failureReason: row.failureReason,
    wordCount: row.wordCount,
    readingMinutes: row.readingMinutes,
    derivedRegenerationRequestedAt: row.derivedRegenerationRequestedAt,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
    supersededAt: row.supersededAt,
    updatedAt: row.updatedAt,
  };
}

/** Counts reader annotations/highlights anchored to an Article (annotation gate input). */
export function countArticleAnnotations(articleId: string): Promise<number> {
  return prisma.highlight.count({ where: { articleId } });
}

/** Fetches the current ACTIVE content version of an Article (metadata DTO), or null. */
export async function getActiveVersion(articleId: string): Promise<ForceRescrapeVersionDto | null> {
  const row = await prisma.articleContentVersion.findUnique({
    where: { activeForArticleId: articleId },
    select: VERSION_DTO_SELECT,
  });
  return row ? toVersionDto(row) : null;
}

/** Fetches the in-flight PENDING content version of an Article (metadata DTO), or null. */
export async function getPendingVersion(articleId: string): Promise<ForceRescrapeVersionDto | null> {
  const row = await prisma.articleContentVersion.findUnique({
    where: { pendingForArticleId: articleId },
    select: VERSION_DTO_SELECT,
  });
  return row ? toVersionDto(row) : null;
}

/** Sanitized force-rescrape status for one Article (metadata only). */
export type ForceRescrapeStatusDto = {
  articleId: string;
  /** The live readable content version (null before the first force-rescrape). */
  activeVersion: ForceRescrapeVersionDto | null;
  /** The in-flight validating version, if a force-rescrape is underway. */
  pendingVersion: ForceRescrapeVersionDto | null;
  /** Number of reader annotations that gate activation (fail-closed until #1103). */
  annotationCount: number;
  /** Recent version history (newest first, bounded) — metadata only. */
  versions: ForceRescrapeVersionDto[];
};

/**
 * Fetches ONE Article's force-rescrape status: its ACTIVE + PENDING versions, a
 * bounded newest-first history, and the reader-annotation count — all metadata
 * only. Returns null when the Article does not exist (the route maps that to a
 * 404). Reads no content and mutates nothing.
 */
export async function getForceRescrapeStatus(
  articleId: string,
  historyLimit = 20,
): Promise<ForceRescrapeStatusDto | null> {
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { id: true } });
  if (!article) return null;

  const take = Math.min(Math.max(1, historyLimit), 100);
  const [active, pending, versions, annotationCount] = await Promise.all([
    prisma.articleContentVersion.findUnique({
      where: { activeForArticleId: articleId },
      select: VERSION_DTO_SELECT,
    }),
    prisma.articleContentVersion.findUnique({
      where: { pendingForArticleId: articleId },
      select: VERSION_DTO_SELECT,
    }),
    prisma.articleContentVersion.findMany({
      where: { articleId },
      select: VERSION_DTO_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    }),
    countArticleAnnotations(articleId),
  ]);

  return {
    articleId,
    activeVersion: active ? toVersionDto(active) : null,
    pendingVersion: pending ? toVersionDto(pending) : null,
    annotationCount,
    versions: versions.map(toVersionDto),
  };
}
