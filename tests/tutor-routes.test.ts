/**
 * Tests for /api/reader/[id]/tutor route handlers (GET, POST, DELETE).
 * Mocks @/lib/api-auth, @/lib/prisma, and @/lib/tutor.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

// --- mutable auth state -------------------------------------------------
let authState: "ok" | "unauth" = "ok";
const session = { user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" } };

// --- mutable lib state --------------------------------------------------
let articleExists = true;
let tutorMessages: { id: string; role: string; content: string; createdAt: Date }[] = [];
let askTutorResult: { answer: string; fallback: boolean; messages: typeof tutorMessages } | null = {
  answer: "The article is about X.",
  fallback: false,
  messages: [],
};
let clearCalled = false;

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
          : { session },
      requireAdminApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
          : { session },
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findUnique: async () => (articleExists ? { id: "a1" } : null),
        },
      },
    },
  });

  mock.module("@/lib/tutor", {
    namedExports: {
      MAX_QUESTION_LENGTH: 1000,
      getTutorMessages: async () => tutorMessages,
      askTutor: async () => askTutorResult,
      clearTutor: async () => {
        clearCalled = true;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  articleExists = true;
  tutorMessages = [];
  askTutorResult = { answer: "The article is about X.", fallback: false, messages: [] };
  clearCalled = false;
});

function ctx(id = "a1") {
  return { params: Promise.resolve({ id }) };
}

function jsonReq(method: string, body: unknown): Request {
  return new Request("http://test/api/reader/a1/tutor", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---- GET ----------------------------------------------------------------

test("GET tutor returns the user's messages (200)", async () => {
  tutorMessages = [
    { id: "1", role: "user", content: "What is this?", createdAt: new Date("2026-01-01") },
  ];
  const { GET } = (await import("@/app/api/reader/[id]/tutor/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/reader/a1/tutor"), ctx());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, "user");
});

test("GET tutor returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/reader/[id]/tutor/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/reader/a1/tutor"), ctx());
  assert.equal(res.status, 401);
});

test("GET tutor returns 404 when article is missing", async () => {
  articleExists = false;
  const { GET } = (await import("@/app/api/reader/[id]/tutor/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/reader/missing/tutor"), ctx("missing"));
  assert.equal(res.status, 404);
});

// ---- POST ---------------------------------------------------------------

test("POST tutor happy path: returns answer + fallback:false + messages (200)", async () => {
  askTutorResult = {
    answer: "The article is about science.",
    fallback: false,
    messages: [
      { id: "1", role: "user", content: "What is this?", createdAt: new Date() },
      { id: "2", role: "assistant", content: "The article is about science.", createdAt: new Date() },
    ],
  };
  const { POST } = (await import("@/app/api/reader/[id]/tutor/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq("POST", { question: "What is this?" }), ctx());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.fallback, false);
  assert.equal(body.answer, "The article is about science.");
  assert.equal(body.messages.length, 2);
});

test("POST tutor returns fallback:true when AI is unavailable", async () => {
  askTutorResult = {
    answer: "I'm sorry, the AI tutor is unavailable right now.",
    fallback: true,
    messages: [],
  };
  const { POST } = (await import("@/app/api/reader/[id]/tutor/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq("POST", { question: "What is this?" }), ctx());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.fallback, true);
  assert.match(body.answer, /unavailable/i);
});

test("POST tutor returns 404 when article is missing (askTutor returns null)", async () => {
  askTutorResult = null;
  const { POST } = (await import("@/app/api/reader/[id]/tutor/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq("POST", { question: "What?" }), ctx("missing"));
  assert.equal(res.status, 404);
});

test("POST tutor returns 400 for an empty question", async () => {
  const { POST } = (await import("@/app/api/reader/[id]/tutor/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq("POST", { question: "" }), ctx());
  assert.equal(res.status, 400);
});

test("POST tutor returns 400 for a question exceeding MAX_QUESTION_LENGTH", async () => {
  const longQuestion = "a".repeat(1001);
  const { POST } = (await import("@/app/api/reader/[id]/tutor/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq("POST", { question: longQuestion }), ctx());
  assert.equal(res.status, 400);
});

test("POST tutor returns 400 when question is missing from body", async () => {
  const { POST } = (await import("@/app/api/reader/[id]/tutor/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq("POST", {}), ctx());
  assert.equal(res.status, 400);
});

test("POST tutor returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { POST } = (await import("@/app/api/reader/[id]/tutor/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq("POST", { question: "Hello?" }), ctx());
  assert.equal(res.status, 401);
});

// ---- DELETE -------------------------------------------------------------

test("DELETE tutor clears the conversation and returns {ok:true}", async () => {
  const { DELETE } = (await import("@/app/api/reader/[id]/tutor/route")) as {
    DELETE: RouteHandler;
  };
  const res = await DELETE(new Request("http://test/api/reader/a1/tutor", { method: "DELETE" }), ctx());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true });
  assert.equal(clearCalled, true);
});

test("DELETE tutor returns 404 when article is missing", async () => {
  articleExists = false;
  const { DELETE } = (await import("@/app/api/reader/[id]/tutor/route")) as {
    DELETE: RouteHandler;
  };
  const res = await DELETE(
    new Request("http://test/api/reader/missing/tutor", { method: "DELETE" }),
    ctx("missing"),
  );
  assert.equal(res.status, 404);
});

test("DELETE tutor returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { DELETE } = (await import("@/app/api/reader/[id]/tutor/route")) as {
    DELETE: RouteHandler;
  };
  const res = await DELETE(
    new Request("http://test/api/reader/a1/tutor", { method: "DELETE" }),
    ctx(),
  );
  assert.equal(res.status, 401);
});
