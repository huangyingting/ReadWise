/**
 * HTTP route tests for the 10 previously-untested route endpoints.
 * TEST2-1, TEST2-2, TEST2-5
 *
 * Covers:
 *   GET  /api/level-recommendation  — 401, 404 (profile not found), 200
 *   POST /api/onboarding             — 401, 200
 *   POST /api/saved                  — 401, 200
 *   POST /api/client-errors          — 204, PII scrub verified via captureError
 *   DELETE /api/account              — 401, 204
 *   GET  /api/account/export         — 401, 200 with Content-Disposition header
 *   GET  /api/study/words            — 401, 200
 *
 * Mocks: @/lib/api-auth, @/lib/leveling, @/lib/security/rate-limit/index,
 *        @/lib/prisma, @/lib/analytics/events, @/lib/article-library,
 *        @/lib/observability/errors, @/lib/account-lifecycle,
 *        @/lib/security/audit, @/lib/lexical/saved-words — no DB or real auth.
 *
 * NOTE: Do NOT import anything from @/lib/api-handler at the top level.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, jsonPost, deleteReq, getReq } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: AuthState = "ok";

// level-recommendation stubs
let levelRecommendation: Record<string, unknown> | null = defaultLevelRecommendation();

// Privacy capture — captureError receives only the route's controlled synthetic error.
let capturedErrors: { message: string }[] = [];
let clientErrorsRateLimitLimited = false;

// account lifecycle stubs
let deleteAccountResult: { ok: boolean; status?: number; error?: string } = { ok: true };
let exportDataResult: Record<string, unknown> = defaultExportData();

// study/words stubs
const savedWordsResult = {
  words: [{ id: "w1", word: "ephemeral", articleId: "a1" }],
  total: 1,
  page: 1,
  totalPages: 1,
};

function defaultLevelRecommendation(): Record<string, unknown> {
  return {
    suggestion: "hold",
    confidence: 0.8,
    explanation: ["Your level looks right."],
    targetLevel: null,
    recommendedLevel: "B1",
    currentLevel: "B1",
  };
}

function defaultExportData(): Record<string, unknown> {
  return {
    profile: { id: "user-1", email: "t@e.com" },
    savedWords: [],
    studyPlanSnapshots: [],
  };
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });

  mock.module("@/lib/leveling", {
    namedExports: {
      getAdaptiveLevelRecommendation: async () => levelRecommendation,
    },
  });

  // Rate-limit — silently passes (no throws) in all tests
  mock.module("@/lib/security/rate-limit/index", {
    namedExports: {
      checkRateLimit: async () => {},
      checkRateLimitByKey: async () => {},
      clientIpKey: () => "ip:test",
      sessionUserRateLimitPolicy: (scope: string) => ({ scope, resolveKey: ({ session }: { session: { user: { id: string } } }) => session.user.id }),
      clientIpRateLimitPolicy: (
        _scope: string,
        options?: { onExceeded?: () => Response | Promise<Response> },
      ) => ({ onExceeded: options?.onExceeded }),
      enforceRateLimitPolicy: async (policy: {
        onExceeded?: () => Response | Promise<Response>;
      }) => {
        if (!clientErrorsRateLimitLimited) return undefined;
        return policy.onExceeded ? policy.onExceeded() : undefined;
      },
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        profile: {
          upsert: async () => ({ userId: "user-1" }),
        },
        article: {
          findMany: async () => [],
        },
      },
    },
  });

  mock.module("@/lib/analytics/events", {
    namedExports: {
      ANALYTICS_EVENT_TYPES: {
        onboardingComplete: "onboarding.complete",
      },
      recordEvent: async () => {},
    },
  });

  // article-library — provides both the saved-route function and the study/words helpers
  mock.module("@/lib/article-library", {
    namedExports: {
      getBookmarkedArticleIds: async () => ["a1"],
      articleAccessContextForUser: async (user: { id?: string } | null | undefined) => ({
        userId: user?.id ?? null,
        isAdmin: false,
      }),
      readableArticleWhere: (_ctx: unknown, extra?: unknown) => extra ?? {},
    },
  });

  // Capture scrubbed error messages for PII-scrub assertion
  mock.module("@/lib/observability/errors", {
    namedExports: {
      captureError: (err: { message?: string }, _ctx?: unknown) => {
        capturedErrors.push({ message: err?.message ?? "" });
      },
      // scrubContext is imported by @/lib/security/events (used by api-handler)
      scrubContext: (ctx: unknown) => ctx,
    },
  });

  mock.module("@/lib/account-lifecycle", {
    namedExports: {
      deleteOwnAccount: async () => deleteAccountResult,
      exportUserData: async () => exportDataResult,
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        accountDelete: "account.delete",
        accountExport: "account.export",
        securityAdminAccessDenied: "security.admin_access_denied",
      },
      auditRequestInfo: () => ({ ipAddress: null, userAgent: null }),
      tryRecordAuditLog: async () => {},
      recordAuditFromRequest: async () => {},
    },
  });

  mock.module("@/lib/lexical/saved-words", {
    namedExports: {
      WORDS_PAGE_SIZE: 20,
      getFilteredSavedWords: async () => savedWordsResult,
      getArticleTitlesForWords: async () => ({}),
    },
  });
});

beforeEach(() => {
  authState = "ok";
  levelRecommendation = defaultLevelRecommendation();
  capturedErrors = [];
  clientErrorsRateLimitLimited = false;
  deleteAccountResult = { ok: true };
  exportDataResult = defaultExportData();
});

// ===========================================================================
// GET /api/level-recommendation
// ===========================================================================

test("GET /api/level-recommendation returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/level-recommendation/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/level-recommendation"));
  assert.equal(res.status, 401);
});

test("GET /api/level-recommendation returns 404 when no profile found", async () => {
  levelRecommendation = null;
  const { GET } = (await import("@/app/api/level-recommendation/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/level-recommendation"));
  assert.equal(res.status, 404);
});

test("GET /api/level-recommendation returns 200 with suggestion and explanation", async () => {
  const { GET } = (await import("@/app/api/level-recommendation/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/level-recommendation"));
  assert.equal(res.status, 200);
  const body = await res.json() as {
    suggestion: string;
    confidence: number;
    rationale: string;
    explanation: string[];
    currentLevel: string;
    recommendedLevel: string;
  };
  assert.equal(body.suggestion, "hold");
  assert.equal(body.currentLevel, "B1");
  assert.ok(typeof body.rationale === "string", "rationale is a string");
  assert.ok(Array.isArray(body.explanation));
});

// ===========================================================================
// POST /api/onboarding
// ===========================================================================

test("POST /api/onboarding returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { POST } = (await import("@/app/api/onboarding/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/onboarding", { englishLevel: "B1", topics: [] }),
  );
  assert.equal(res.status, 401);
});

test("POST /api/onboarding returns 200 and ok:true for valid profile", async () => {
  const { POST } = (await import("@/app/api/onboarding/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/onboarding", { englishLevel: "B1", topics: ["tech"] }),
  );
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean };
  assert.equal(body.ok, true);
});

// ===========================================================================
// POST /api/saved
// ===========================================================================

test("POST /api/saved returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { POST } = (await import("@/app/api/saved/route")) as { POST: RouteHandler };
  const res = await POST(jsonPost("http://test/api/saved", { ids: ["a1", "a2"] }));
  assert.equal(res.status, 401);
});

test("POST /api/saved returns 200 with bookmarked ids", async () => {
  const { POST } = (await import("@/app/api/saved/route")) as { POST: RouteHandler };
  const res = await POST(jsonPost("http://test/api/saved", { ids: ["a1", "a2"] }));
  assert.equal(res.status, 200);
  const body = await res.json() as { bookmarked: string[] };
  assert.ok(Array.isArray(body.bookmarked), "bookmarked is an array");
  assert.ok(body.bookmarked.includes("a1"), "saved article a1 is in results");
});

// ===========================================================================
// POST /api/client-errors  — public (no auth) + PII scrub
// ===========================================================================

test("POST /api/client-errors returns 204 for a valid error report", async () => {
  const { POST } = (await import("@/app/api/client-errors/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/client-errors", {
      message: "TypeError: something broke",
      source: "app/page.tsx",
    }),
  );
  assert.equal(res.status, 204);
});

test("POST /api/client-errors keeps returning 204 when rate-limited", async () => {
  clientErrorsRateLimitLimited = true;
  const { POST } = (await import("@/app/api/client-errors/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/client-errors", {
      message: "TypeError: too many",
    }),
  );
  assert.equal(res.status, 204);
  assert.equal(capturedErrors.length, 0, "rate-limited requests should be silently absorbed");
});

test("POST /api/client-errors discards email-bearing exception prose before captureError", async () => {
  const { POST } = (await import("@/app/api/client-errors/route")) as { POST: RouteHandler };
  await POST(
    jsonPost("http://test/api/client-errors", {
      message: "Error: user@secret.com triggered an exception",
    }),
  );
  assert.ok(capturedErrors.length > 0, "captureError was called");
  const captured = capturedErrors[0].message;
  assert.equal(captured, "client_error");
  assert.ok(!captured.includes("@secret.com"), "email address never reaches captureError");
  assert.ok(!captured.includes("[email]"), "discarded prose is not retained as a placeholder");
});

test("POST /api/client-errors discards token-bearing exception prose before captureError", async () => {
  const { POST } = (await import("@/app/api/client-errors/route")) as { POST: RouteHandler };
  await POST(
    jsonPost("http://test/api/client-errors", {
      message: "Token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abc expired",
    }),
  );
  assert.ok(capturedErrors.length > 0, "captureError was called");
  const captured = capturedErrors[0].message;
  assert.equal(captured, "client_error");
  assert.ok(
    !captured.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abc"),
    "token never reaches captureError",
  );
  assert.ok(!captured.includes("[token]"), "discarded prose is not retained as a placeholder");
});

// ===========================================================================
// DELETE /api/account
// ===========================================================================

test("DELETE /api/account returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { DELETE } = (await import("@/app/api/account/route")) as { DELETE: RouteHandler };
  const res = await DELETE(deleteReq("http://test/api/account"));
  assert.equal(res.status, 401);
});

test("DELETE /api/account returns 204 on successful account deletion", async () => {
  deleteAccountResult = { ok: true };
  const { DELETE } = (await import("@/app/api/account/route")) as { DELETE: RouteHandler };
  const res = await DELETE(deleteReq("http://test/api/account"));
  assert.equal(res.status, 204);
});

// ===========================================================================
// GET /api/account/export
// ===========================================================================

test("GET /api/account/export returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/account/export/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/account/export"));
  assert.equal(res.status, 401);
});

test("GET /api/account/export returns 200 with download headers", async () => {
  const { GET } = (await import("@/app/api/account/export/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/account/export"));
  assert.equal(res.status, 200);
  assert.match(
    res.headers.get("content-type") ?? "",
    /^application\/json/i,
    "Content-Type is JSON",
  );
  const contentDisp = res.headers.get("content-disposition") ?? "";
  assert.match(contentDisp, /attachment/i, "Content-Disposition is an attachment");
  assert.match(contentDisp, /readwise-data-export/, "filename contains readwise-data-export");
});

test("GET /api/account/export serializes exportedAt + data payload", async () => {
  exportDataResult = {
    profile: { id: "user-1", email: "t@e.com" },
    savedWords: [],
    studyPlanSnapshots: [
      {
        weekStart: "2026-07-07T00:00:00.000Z",
        weekEnd: "2026-07-14T00:00:00.000Z",
      },
    ],
  };
  const { GET } = (await import("@/app/api/account/export/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/account/export"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    exportedAt: string;
    data: {
      profile: Record<string, unknown>;
      savedWords: unknown[];
      studyPlanSnapshots: Array<Record<string, string>>;
    };
  };
  assert.equal(typeof body.exportedAt, "string");
  assert.ok(!Number.isNaN(Date.parse(body.exportedAt)), "exportedAt is parseable ISO datetime");
  assert.deepEqual(body.data, exportDataResult);
  assert.ok(Array.isArray(body.data.studyPlanSnapshots));
});

// ===========================================================================
// GET /api/study/words
// ===========================================================================

test("GET /api/study/words returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/study/words/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/study/words"));
  assert.equal(res.status, 401);
});

test("GET /api/study/words returns 200 with paginated word list", async () => {
  const { GET } = (await import("@/app/api/study/words/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/study/words"));
  assert.equal(res.status, 200);
  const body = await res.json() as {
    words: unknown[];
    total: number;
    page: number;
    totalPages: number;
    pageSize: number;
  };
  assert.ok(Array.isArray(body.words), "words is an array");
  assert.equal(body.total, 1);
  assert.equal(body.page, 1);
  assert.ok(typeof body.pageSize === "number", "pageSize is a number");
});
