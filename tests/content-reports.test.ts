/**
 * Unit tests for the content reporting command module and admin queue (#738).
 *
 * No real DB is touched — Prisma is mocked via node:test module mocking.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { ContentReportReason, ContentReportStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

type MockArticle = { id: string; title: string } | null;
type MockReport = {
  id: string;
  reporterUserId: string;
  articleId: string;
  reason: ContentReportReason;
  note: string | null;
  status: ContentReportStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
};

let mockArticle: MockArticle = null;
let mockReports: MockReport[] = [];
let mockFindFirst: MockReport | null = null;

before(() => {
  const article = {
    findUnique: async (args: { where: { id: string }; select?: Record<string, boolean> }) => {
      if (!mockArticle || mockArticle.id !== args.where.id) return null;
      return args.select ? { id: mockArticle.id } : mockArticle;
    },
  };

  const contentReport = {
    create: async (args: { data: Omit<MockReport, "id" | "createdAt" | "resolvedAt" | "resolvedBy">; select?: Record<string, boolean> }) => {
      const report: MockReport = {
        id: `report-${mockReports.length + 1}`,
        ...args.data,
        resolvedAt: null,
        resolvedBy: null,
        createdAt: new Date(),
      };
      mockReports.push(report);
      return { id: report.id };
    },
    findFirst: async (_args: unknown) => mockFindFirst,
    findMany: async (args: {
      where?: { status?: ContentReportStatus };
      orderBy?: unknown;
      skip?: number;
      take?: number;
      select?: Record<string, unknown>;
    }) => {
      const status = args.where?.status ?? ContentReportStatus.OPEN;
      const filtered = mockReports.filter((r) => r.status === status);
      const skip = args.skip ?? 0;
      const take = args.take ?? filtered.length;
      return filtered.slice(skip, skip + take).map((r) => ({
        ...r,
        article: { title: "Test Article" },
      }));
    },
    count: async (args: { where?: { status?: ContentReportStatus } }) => {
      const status = args.where?.status ?? ContentReportStatus.OPEN;
      return mockReports.filter((r) => r.status === status).length;
    },
    findUnique: async (args: { where: { id: string }; select?: Record<string, boolean> }) => {
      return mockReports.find((r) => r.id === args.where.id) ?? null;
    },
    update: async (args: {
      where: { id: string };
      data: Partial<MockReport>;
      select?: Record<string, boolean>;
    }) => {
      const idx = mockReports.findIndex((r) => r.id === args.where.id);
      if (idx < 0) throw new Error("not found");
      Object.assign(mockReports[idx], args.data);
      return { id: mockReports[idx].id, status: mockReports[idx].status };
    },
  };

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: { article, contentReport },
    },
  });
});

beforeEach(() => {
  mockArticle = { id: "article-1", title: "Test Article" };
  mockReports = [];
  mockFindFirst = null;
});

// ---------------------------------------------------------------------------
// Tests: createContentReport
// ---------------------------------------------------------------------------

test("createContentReport — creates report for a valid article", async () => {
  const { createContentReport } = await import("@/lib/moderation/reports");
  const result = await createContentReport({
    reporterUserId: "user-1",
    articleId: "article-1",
    reason: ContentReportReason.UNSAFE_CONTENT,
    note: null,
  });
  assert.ok(result.ok, `Expected ok but got: ${!result.ok ? (result as { error: string }).error : ""}`);
  if (result.ok) assert.ok(result.reportId.startsWith("report-"));
  assert.equal(mockReports.length, 1);
});

test("createContentReport — stores only articleId and reason (no article text)", async () => {
  const { createContentReport } = await import("@/lib/moderation/reports");
  await createContentReport({
    reporterUserId: "user-1",
    articleId: "article-1",
    reason: ContentReportReason.RIGHTS_COPYRIGHT,
    note: null,
  });
  const report = mockReports[0];
  assert.equal(report.articleId, "article-1");
  assert.equal(report.reason, ContentReportReason.RIGHTS_COPYRIGHT);
  assert.equal(report.note, null);
});

test("createContentReport — accepts optional note under 500 chars", async () => {
  const { createContentReport } = await import("@/lib/moderation/reports");
  const result = await createContentReport({
    reporterUserId: "user-1",
    articleId: "article-1",
    reason: ContentReportReason.OTHER,
    note: "Short note.",
  });
  assert.ok(result.ok);
  assert.equal(mockReports[0].note, "Short note.");
});

test("createContentReport — rejects note over 500 chars", async () => {
  const { createContentReport } = await import("@/lib/moderation/reports");
  const result = await createContentReport({
    reporterUserId: "user-1",
    articleId: "article-1",
    reason: ContentReportReason.OTHER,
    note: "x".repeat(501),
  });
  assert.ok(!result.ok);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.ok(result.error.includes("500"));
  }
});

test("createContentReport — returns 404 when article not found", async () => {
  const { createContentReport } = await import("@/lib/moderation/reports");
  mockArticle = null;
  const result = await createContentReport({
    reporterUserId: "user-1",
    articleId: "missing-article",
    reason: ContentReportReason.EXTRACTION_BROKEN,
  });
  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.status, 404);
});

test("createContentReport — deduplicates within 1-hour window (returns 429)", async () => {
  const { createContentReport } = await import("@/lib/moderation/reports");
  mockFindFirst = {
    id: "existing-report",
    reporterUserId: "user-1",
    articleId: "article-1",
    reason: ContentReportReason.UNSAFE_CONTENT,
    note: null,
    status: ContentReportStatus.OPEN,
    createdAt: new Date(),
    resolvedAt: null,
    resolvedBy: null,
  };
  const result = await createContentReport({
    reporterUserId: "user-1",
    articleId: "article-1",
    reason: ContentReportReason.UNSAFE_CONTENT,
  });
  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.status, 429);
});

test("createContentReport — rejects invalid reason", async () => {
  const { createContentReport } = await import("@/lib/moderation/reports");
  const result = await createContentReport({
    reporterUserId: "user-1",
    articleId: "article-1",
    reason: "not_a_real_reason" as ContentReportReason,
  });
  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.status, 400);
});

// ---------------------------------------------------------------------------
// Tests: listContentReports (admin queue)
// ---------------------------------------------------------------------------

test("listContentReports — returns open reports by default", async () => {
  const { listContentReports } = await import("@/lib/moderation/reports");
  mockReports = [
    {
      id: "r1",
      reporterUserId: "u1",
      articleId: "article-1",
      reason: ContentReportReason.UNSAFE_CONTENT,
      note: null,
      status: ContentReportStatus.OPEN,
      createdAt: new Date(),
      resolvedAt: null,
      resolvedBy: null,
    },
    {
      id: "r2",
      reporterUserId: "u2",
      articleId: "article-1",
      reason: ContentReportReason.WRONG_LEVEL,
      note: null,
      status: ContentReportStatus.RESOLVED,
      createdAt: new Date(),
      resolvedAt: new Date(),
      resolvedBy: "admin-1",
    },
  ];
  const result = await listContentReports();
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].id, "r1");
  assert.equal(result.total, 1);
});

test("listContentReports — filters by status", async () => {
  const { listContentReports } = await import("@/lib/moderation/reports");
  mockReports = [
    {
      id: "r1",
      reporterUserId: "u1",
      articleId: "article-1",
      reason: ContentReportReason.UNSAFE_CONTENT,
      note: null,
      status: ContentReportStatus.RESOLVED,
      createdAt: new Date(),
      resolvedAt: new Date(),
      resolvedBy: "admin-1",
    },
  ];
  const result = await listContentReports({ status: ContentReportStatus.RESOLVED });
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].status, ContentReportStatus.RESOLVED);
});

test("listContentReports — returns articleTitle from joined article", async () => {
  const { listContentReports } = await import("@/lib/moderation/reports");
  mockReports = [
    {
      id: "r1",
      reporterUserId: "u1",
      articleId: "article-1",
      reason: ContentReportReason.OTHER,
      note: null,
      status: ContentReportStatus.OPEN,
      createdAt: new Date(),
      resolvedAt: null,
      resolvedBy: null,
    },
  ];
  const result = await listContentReports();
  assert.equal(result.reports[0].articleTitle, "Test Article");
});

// ---------------------------------------------------------------------------
// Tests: updateReportStatus
// ---------------------------------------------------------------------------

test("updateReportStatus — resolves an open report", async () => {
  const { updateReportStatus } = await import("@/lib/moderation/reports");
  mockReports = [
    {
      id: "r1",
      reporterUserId: "u1",
      articleId: "article-1",
      reason: ContentReportReason.UNSAFE_CONTENT,
      note: null,
      status: ContentReportStatus.OPEN,
      createdAt: new Date(),
      resolvedAt: null,
      resolvedBy: null,
    },
  ];
  const result = await updateReportStatus({
    reportId: "r1",
    status: ContentReportStatus.RESOLVED,
    resolvedBy: "admin-1",
  });
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.status, ContentReportStatus.RESOLVED);
});

test("updateReportStatus — dismisses a report", async () => {
  const { updateReportStatus } = await import("@/lib/moderation/reports");
  mockReports = [
    {
      id: "r1",
      reporterUserId: "u1",
      articleId: "article-1",
      reason: ContentReportReason.INACCURATE_AI,
      note: null,
      status: ContentReportStatus.OPEN,
      createdAt: new Date(),
      resolvedAt: null,
      resolvedBy: null,
    },
  ];
  const result = await updateReportStatus({
    reportId: "r1",
    status: ContentReportStatus.DISMISSED,
    resolvedBy: "admin-1",
  });
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.status, ContentReportStatus.DISMISSED);
});

test("updateReportStatus — returns 404 for unknown report", async () => {
  const { updateReportStatus } = await import("@/lib/moderation/reports");
  const result = await updateReportStatus({
    reportId: "nonexistent",
    status: ContentReportStatus.RESOLVED,
    resolvedBy: "admin-1",
  });
  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.status, 404);
});

test("updateReportStatus — rejects invalid status", async () => {
  const { updateReportStatus } = await import("@/lib/moderation/reports");
  mockReports = [
    {
      id: "r1",
      reporterUserId: "u1",
      articleId: "article-1",
      reason: ContentReportReason.OTHER,
      note: null,
      status: ContentReportStatus.OPEN,
      createdAt: new Date(),
      resolvedAt: null,
      resolvedBy: null,
    },
  ];
  const result = await updateReportStatus({
    reportId: "r1",
    status: "INVALID" as ContentReportStatus,
    resolvedBy: "admin-1",
  });
  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.status, 400);
});

// ---------------------------------------------------------------------------
// Tests: constant / label validation
// ---------------------------------------------------------------------------

test("REPORT_REASON_LABELS — covers all ContentReportReason values", async () => {
  const { REPORT_REASON_LABELS, REPORT_REASONS } = await import("@/lib/moderation/reports");
  for (const reason of REPORT_REASONS) {
    assert.ok(
      REPORT_REASON_LABELS[reason],
      `Missing label for reason: ${reason}`,
    );
  }
});

test("REPORT_STATUS_LABELS — covers all ContentReportStatus values", async () => {
  const { REPORT_STATUS_LABELS } = await import("@/lib/moderation/reports");
  const statuses = Object.values(ContentReportStatus);
  for (const status of statuses) {
    assert.ok(
      REPORT_STATUS_LABELS[status],
      `Missing label for status: ${status}`,
    );
  }
});

test("isReportReason — returns true for valid reasons", async () => {
  const { isReportReason } = await import("@/lib/moderation/reports");
  assert.ok(isReportReason(ContentReportReason.UNSAFE_CONTENT));
  assert.ok(isReportReason(ContentReportReason.RIGHTS_COPYRIGHT));
  assert.ok(!isReportReason("not_valid"));
  assert.ok(!isReportReason(null));
});
