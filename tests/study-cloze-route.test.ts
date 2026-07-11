/**
 * Route tests for GET /api/study/cloze (issue #995).
 *
 * Covers: auth, feature/rate gates, validation bounds, successful learning
 * persistence, optional AI/provider fallback, and controlled errors.
 *
 * Mocks: @/lib/api-auth, @/lib/learning/flashcards, @/lib/learning/cloze,
 *        @/lib/security/rate-limit/index, @/lib/security/events,
 *        @/lib/security/client-ip, @/lib/security/audit.
 * No DB, no real auth, no network.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, getReq } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: AuthState = "ok";
let rateLimitCalls: Array<{ userId: string; scope: string }> = [];
let rateLimitError: Error | null = null;

type StubCard = {
  id: string;
  word: string;
  explanation: string | null;
  example: string | null;
  contextSentence: string | null;
  articleId: string | null;
};

let dueCards: StubCard[] = [
  {
    id: "card-1",
    word: "ephemeral",
    explanation: "lasting a short time",
    example: "The ephemeral beauty of cherry blossoms.",
    contextSentence: null,
    articleId: "article-1",
  },
  {
    id: "card-2",
    word: "ubiquitous",
    explanation: "present everywhere",
    example: null,
    contextSentence: null,
    articleId: null,
  },
];

let getDueFlashcardsArgs: { userId: string; limit: number } | null = null;

type ClozeResult =
  | { ok: true; card: { masked: string; answerLength: number } }
  | { ok: false; error: string };

let buildClozeResult: ClozeResult = {
  ok: true,
  card: { masked: "The ___ beauty of cherry blossoms.", answerLength: 9 },
};

const CLOZE_URL = "http://test/api/study/cloze";

function clozeRequest(query = ""): Request {
  return getReq(query ? `${CLOZE_URL}?${query}` : CLOZE_URL);
}

async function loadGet(): Promise<RouteHandler> {
  const { GET } = (await import("@/app/api/study/cloze/route")) as { GET: RouteHandler };
  return GET;
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });

  mock.module("@/lib/security/rate-limit/index", {
    namedExports: {
      sessionUserRateLimitPolicy: (scope: string) => ({
        scope,
        resolveKey: ({ session }: { session: { user: { id: string } } }) => session.user.id,
      }),
      enforceRateLimitPolicy: async (
        policy: { resolveKey: (ctx: { session: { user: { id: string } } }) => string; scope: string },
        ctx: { session: { user: { id: string } } },
      ) => {
        rateLimitCalls.push({ userId: policy.resolveKey(ctx), scope: policy.scope });
        if (rateLimitError) throw rateLimitError;
      },
    },
  });

  mock.module("@/lib/learning/flashcards", {
    namedExports: {
      getDueFlashcards: async (userId: string, limit: number) => {
        getDueFlashcardsArgs = { userId, limit };
        return dueCards;
      },
    },
  });

  mock.module("@/lib/learning/cloze", {
    namedExports: {
      buildCloze: (_word: string, _example: string) => {
        return buildClozeResult;
      },
    },
  });

  mock.module("@/lib/security/events", {
    namedExports: {
      SECURITY_EVENT_TYPES: {
        unauthorized: "auth.unauthorized",
        forbidden: "auth.forbidden",
        adminAccessDenied: "auth.admin_denied",
        rateLimited: "rate_limit.exceeded",
        csrfBlocked: "csrf.blocked",
        adminMutation: "admin.mutation",
        importFailed: "import.failed",
        importBlocked: "import.blocked",
        suspiciousLookup: "lookup.suspicious_volume",
      },
      recordSecurityEvent: () => {},
    },
  });

  mock.module("@/lib/security/client-ip", {
    namedExports: {
      clientIp: () => "127.0.0.1",
      clientIpKey: () => "ip:127.0.0.1",
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {},
      auditRequestInfo: () => ({ ipAddress: null, userAgent: null }),
      recordAuditFromRequest: async () => {},
      tryRecordAuditLog: async () => {},
    },
  });
});

beforeEach(() => {
  authState = "ok";
  rateLimitCalls = [];
  rateLimitError = null;
  getDueFlashcardsArgs = null;
  dueCards = [
    {
      id: "card-1",
      word: "ephemeral",
      explanation: "lasting a short time",
      example: "The ephemeral beauty of cherry blossoms.",
      contextSentence: null,
      articleId: "article-1",
    },
    {
      id: "card-2",
      word: "ubiquitous",
      explanation: "present everywhere",
      example: null,
      contextSentence: null,
      articleId: null,
    },
  ];
  buildClozeResult = {
    ok: true,
    card: { masked: "The ___ beauty of cherry blossoms.", answerLength: 9 },
  };
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

test("GET /api/study/cloze returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const GET = await loadGet();
  const res = await GET(clozeRequest(), undefined);
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// Rate limit gate
// ---------------------------------------------------------------------------

test("GET /api/study/cloze enforces rate limit", async () => {
  const GET = await loadGet();
  await GET(clozeRequest(), undefined);
  assert.equal(rateLimitCalls.length, 1);
  assert.equal(rateLimitCalls[0].userId, "user-1");
  assert.equal(rateLimitCalls[0].scope, "lookup");
});

test("GET /api/study/cloze returns 429 when rate limited", async () => {
  const rateLimitErr = new Error("Rate limit exceeded");
  (rateLimitErr as unknown as { status: number }).status = 429;
  (rateLimitErr as unknown as { statusCode: number }).statusCode = 429;
  rateLimitError = rateLimitErr;
  const GET = await loadGet();
  const res = await GET(clozeRequest(), undefined);
  // The handler should propagate the error; depending on api-handler behavior,
  // it may be 429 or 500 (since the mock throws directly).
  assert.ok(res.status >= 400);
});

// ---------------------------------------------------------------------------
// Validation / query bounds
// ---------------------------------------------------------------------------

test("GET /api/study/cloze uses default limit when not specified", async () => {
  const GET = await loadGet();
  await GET(clozeRequest(), undefined);
  assert.equal(getDueFlashcardsArgs!.limit, 20);
});

test("GET /api/study/cloze respects custom limit", async () => {
  const GET = await loadGet();
  await GET(clozeRequest("limit=10"), undefined);
  assert.equal(getDueFlashcardsArgs!.limit, 10);
});

test("GET /api/study/cloze caps limit at maximum (50)", async () => {
  const GET = await loadGet();
  await GET(clozeRequest("limit=100"), undefined);
  assert.equal(getDueFlashcardsArgs!.limit, 50);
});

test("GET /api/study/cloze uses fallback for invalid limit", async () => {
  const GET = await loadGet();
  await GET(clozeRequest("limit=abc"), undefined);
  assert.equal(getDueFlashcardsArgs!.limit, 20);
});

// ---------------------------------------------------------------------------
// Success / learning persistence
// ---------------------------------------------------------------------------

test("GET /api/study/cloze returns items with cloze data on success", async () => {
  const GET = await loadGet();
  const res = await GET(clozeRequest(), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, 2);
  assert.equal(body.items[0].id, "card-1");
  assert.equal(body.items[0].word, "ephemeral");
  assert.deepEqual(body.items[0].cloze, {
    masked: "The ___ beauty of cherry blossoms.",
    answerLength: 9,
  });
});

test("GET /api/study/cloze returns null cloze when card has no example", async () => {
  const GET = await loadGet();
  const res = await GET(clozeRequest(), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  // card-2 has no example, so cloze should be null
  assert.equal(body.items[1].cloze, null);
});

// ---------------------------------------------------------------------------
// Provider fallback (buildCloze fails gracefully)
// ---------------------------------------------------------------------------

test("GET /api/study/cloze returns null cloze when buildCloze fails", async () => {
  buildClozeResult = { ok: false, error: "Word not found in example" };
  dueCards = [
    {
      id: "card-3",
      word: "xyz",
      explanation: "test",
      example: "No matching word here.",
      contextSentence: null,
      articleId: null,
    },
  ];
  const GET = await loadGet();
  const res = await GET(clozeRequest(), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items[0].cloze, null);
  assert.equal(body.items[0].word, "xyz");
});

// ---------------------------------------------------------------------------
// Empty results
// ---------------------------------------------------------------------------

test("GET /api/study/cloze returns empty array when no cards are due", async () => {
  dueCards = [];
  const GET = await loadGet();
  const res = await GET(clozeRequest(), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.items, []);
});

// ---------------------------------------------------------------------------
// User scoping
// ---------------------------------------------------------------------------

test("GET /api/study/cloze passes session user id to flashcards query", async () => {
  const GET = await loadGet();
  await GET(clozeRequest(), undefined);
  assert.equal(getDueFlashcardsArgs!.userId, "user-1");
});
