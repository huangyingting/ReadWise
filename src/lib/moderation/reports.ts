/**
 * Content reporting — user-submitted reports & admin moderation queue (#738).
 *
 * Users report articles using a structured reason category. Reports are stored
 * without raw article text, selected text, or PII — only the article ID and
 * safe category metadata. Admins can list open reports and update their status.
 */
import { prisma } from "@/lib/prisma";
import { ContentReportReason, ContentReportStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

export { ContentReportReason, ContentReportStatus };

/** All valid report reasons in display order. */
export const REPORT_REASONS = [
  ContentReportReason.RIGHTS_COPYRIGHT,
  ContentReportReason.UNSAFE_CONTENT,
  ContentReportReason.EXTRACTION_BROKEN,
  ContentReportReason.WRONG_LEVEL,
  ContentReportReason.INACCURATE_AI,
  ContentReportReason.CLASSROOM_CONCERN,
  ContentReportReason.OTHER,
] as const;

/** Human-readable labels for each reason. */
export const REPORT_REASON_LABELS: Record<ContentReportReason, string> = {
  [ContentReportReason.RIGHTS_COPYRIGHT]: "Rights / Copyright",
  [ContentReportReason.UNSAFE_CONTENT]: "Unsafe Content",
  [ContentReportReason.EXTRACTION_BROKEN]: "Extraction Broken",
  [ContentReportReason.WRONG_LEVEL]: "Wrong Level",
  [ContentReportReason.INACCURATE_AI]: "Inaccurate AI Enrichment",
  [ContentReportReason.CLASSROOM_CONCERN]: "Classroom Concern",
  [ContentReportReason.OTHER]: "Other",
};

/** Human-readable labels for each status. */
export const REPORT_STATUS_LABELS: Record<ContentReportStatus, string> = {
  [ContentReportStatus.OPEN]: "Open",
  [ContentReportStatus.REVIEWING]: "Reviewing",
  [ContentReportStatus.RESOLVED]: "Resolved",
  [ContentReportStatus.DISMISSED]: "Dismissed",
};

const REPORT_STATUSES = Object.values(ContentReportStatus);

export function isReportReason(value: unknown): value is ContentReportReason {
  return (
    typeof value === "string" &&
    (REPORT_REASONS as readonly string[]).includes(value)
  );
}

export function isReportStatus(value: unknown): value is ContentReportStatus {
  return (
    typeof value === "string" &&
    REPORT_STATUSES.includes(value as ContentReportStatus)
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The shape returned for a single report in the admin queue. */
export type ContentReportRow = {
  id: string;
  reporterUserId: string;
  articleId: string;
  articleTitle: string | null;
  reason: ContentReportReason;
  note: string | null;
  status: ContentReportStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type CreateContentReportInput = {
  reporterUserId: string;
  articleId: string;
  reason: ContentReportReason;
  /** Optional short note — must not contain raw article text or selected text. */
  note?: string | null;
};

export type CreateContentReportResult =
  | { ok: true; reportId: string }
  | { ok: false; error: string; status: number };

const MAX_NOTE_LENGTH = 500;
const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function createReportError(
  error: string,
  status: number,
): Extract<CreateContentReportResult, { ok: false }> {
  return { ok: false, error, status };
}

async function articleExists(articleId: string): Promise<boolean> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { id: true },
  });
  return Boolean(article);
}

async function hasRecentDuplicateReport(
  reporterUserId: string,
  articleId: string,
  reason: ContentReportReason,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - DEDUP_WINDOW_MS);
  const existing = await prisma.contentReport.findFirst({
    where: {
      reporterUserId,
      articleId,
      reason,
      createdAt: { gte: windowStart },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

/**
 * Creates a user report for a piece of content. Deduplicates within a 1-hour
 * window so a user cannot flood the same reason for the same article.
 */
export async function createContentReport(
  input: CreateContentReportInput,
): Promise<CreateContentReportResult> {
  const { reporterUserId, articleId, reason, note } = input;

  if (!reporterUserId) return createReportError("reporterUserId is required", 400);
  if (!articleId) return createReportError("articleId is required", 400);
  if (!isReportReason(reason)) return createReportError("Invalid report reason", 400);
  if (note != null && note.length > MAX_NOTE_LENGTH) {
    return createReportError(`note must be at most ${MAX_NOTE_LENGTH} characters`, 400);
  }

  // Verify the article exists.
  if (!(await articleExists(articleId))) return createReportError("Article not found", 404);

  // Dedup: reject if the same user already reported the same article with the
  // same reason within the dedup window.
  if (await hasRecentDuplicateReport(reporterUserId, articleId, reason)) {
    return createReportError("You have already reported this article recently", 429);
  }

  const report = await prisma.contentReport.create({
    data: {
      reporterUserId,
      articleId,
      reason,
      note: note ?? null,
      status: ContentReportStatus.OPEN,
    },
    select: { id: true },
  });

  return { ok: true, reportId: report.id };
}

// ---------------------------------------------------------------------------
// Queries (admin)
// ---------------------------------------------------------------------------

export type ListReportsOptions = {
  status?: ContentReportStatus;
  page?: number;
  pageSize?: number;
};

export type ListReportsResult = {
  reports: ContentReportRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

function normalizeListOptions(opts: ListReportsOptions): {
  status: ContentReportStatus;
  page: number;
  pageSize: number;
  skip: number;
} {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  return {
    status: opts.status ?? ContentReportStatus.OPEN,
    page,
    pageSize,
    skip: (page - 1) * pageSize,
  };
}

type ListedReport = {
  id: string;
  reporterUserId: string;
  articleId: string;
  reason: ContentReportReason;
  note: string | null;
  status: ContentReportStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  article: { title: string | null };
};

function toContentReportRow(report: ListedReport): ContentReportRow {
  return {
    id: report.id,
    reporterUserId: report.reporterUserId,
    articleId: report.articleId,
    articleTitle: report.article.title,
    reason: report.reason,
    note: report.note,
    status: report.status,
    createdAt: report.createdAt,
    resolvedAt: report.resolvedAt,
    resolvedBy: report.resolvedBy,
  };
}

/** Lists reports for the admin moderation queue. Defaults to OPEN reports. */
export async function listContentReports(
  opts: ListReportsOptions = {},
): Promise<ListReportsResult> {
  const { status, page, pageSize, skip } = normalizeListOptions(opts);

  const [rows, total] = await Promise.all([
    prisma.contentReport.findMany({
      where: { status },
      orderBy: { createdAt: "asc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        reporterUserId: true,
        articleId: true,
        reason: true,
        note: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        resolvedBy: true,
        article: { select: { title: true } },
      },
    }),
    prisma.contentReport.count({ where: { status } }),
  ]);

  const reports = rows.map((report) =>
    toContentReportRow(report as ListedReport),
  );

  return {
    reports,
    total,
    page,
    pageSize,
    pageCount: Math.ceil(total / pageSize),
  };
}

// ---------------------------------------------------------------------------
// Status update (admin)
// ---------------------------------------------------------------------------

export type UpdateReportStatusInput = {
  reportId: string;
  status: ContentReportStatus;
  resolvedBy: string;
};

export type UpdateReportStatusResult =
  | { ok: true; reportId: string; status: ContentReportStatus }
  | { ok: false; error: string; status: number };

function updateReportError(
  error: string,
  status: number,
): Extract<UpdateReportStatusResult, { ok: false }> {
  return { ok: false, error, status };
}

function isTerminalStatus(status: ContentReportStatus): boolean {
  return (
    status === ContentReportStatus.RESOLVED ||
    status === ContentReportStatus.DISMISSED
  );
}

/** Updates the status of a ContentReport (resolve or dismiss). */
export async function updateReportStatus(
  input: UpdateReportStatusInput,
): Promise<UpdateReportStatusResult> {
  const { reportId, status, resolvedBy } = input;

  if (!isReportStatus(status)) {
    return updateReportError("Invalid report status", 400);
  }

  const existing = await prisma.contentReport.findUnique({
    where: { id: reportId },
    select: { id: true, status: true },
  });
  if (!existing) return updateReportError("Report not found", 404);

  const isTerminal = isTerminalStatus(status);

  const updated = await prisma.contentReport.update({
    where: { id: reportId },
    data: {
      status,
      resolvedBy: isTerminal ? resolvedBy : null,
      resolvedAt: isTerminal ? new Date() : null,
    },
    select: { id: true, status: true },
  });

  return { ok: true, reportId: updated.id, status: updated.status };
}
