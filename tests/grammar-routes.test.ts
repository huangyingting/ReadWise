/**
 * Route-level integration tests for POST /api/reader/[id]/grammar (issue #1010).
 *
 * Proves the route wires the grammar service fallback correctly:
 * when AI/grammar enrichment is unavailable, the handler returns
 * HTTP 200 with `{ explanation: null, fallback: true }`.
 *
 * Mocks: @/lib/api-auth, @/lib/reader/route-guard, @/lib/grammar,
 *        @/lib/learning/learner-evidence.
 * No live AI, DB, network, article text, prompt, or token is touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  type RouteHandler,
  withParams,
  jsonPost,
} from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";
import type { GrammarResult } from "@/lib/grammar";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: AuthState = "ok";
let grammarResult: GrammarResult = { explanation: null, fallback: true };

// ---------------------------------------------------------------------------
// Module mocks — registered once before any module-under-test is imported
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });

  mock.module("@/lib/reader/route-guard", {
    namedExports: {
      requireReadableArticleForAI: async () => ({
        article: { id: "a1", difficulty: "B1" },
        context: { userId: "user-1" },
      }),
    },
  });

  mock.module("@/lib/grammar", {
    namedExports: {
      explainGrammar: async () => grammarResult,
      MAX_PHRASE_CHARS: 200,
      MAX_CONTEXT_CHARS: 500,
    },
  });

  mock.module("@/lib/learning/learner-evidence", {
    namedExports: {
      recordLearnerEvidence: async () => {},
    },
  });
});

beforeEach(() => {
  authState = "ok";
  grammarResult = { explanation: null, fallback: true };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonReq(body: unknown): Request {
  return jsonPost("http://test/api/reader/a1/grammar", body);
}

function ctx(id = "a1") {
  return withParams({ id });
}

async function postGrammar(body: unknown, id?: string): Promise<Response> {
  const { POST } = (await import(
    "@/app/api/reader/[id]/grammar/route"
  )) as { POST: RouteHandler };
  return POST(jsonReq(body), ctx(id));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("POST grammar returns HTTP 200 with fallback:true and explanation:null when AI unavailable", async () => {
  grammarResult = { explanation: null, fallback: true };
  const res = await postGrammar({ phrase: "give up" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.fallback, true);
  assert.equal(body.explanation, null);
});

test("POST grammar returns HTTP 200 with explanation when AI is available", async () => {
  grammarResult = {
    explanation: "'Give up' is a phrasal verb meaning to stop trying.",
    fallback: false,
  };
  const res = await postGrammar({ phrase: "give up", contextSentence: "He gave up." });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.fallback, false);
  assert.equal(body.explanation, "'Give up' is a phrasal verb meaning to stop trying.");
});

test("POST grammar returns 400 for missing phrase", async () => {
  const res = await postGrammar({ contextSentence: "He gave up." });
  assert.equal(res.status, 400);
});

test("POST grammar returns 400 for empty phrase", async () => {
  const res = await postGrammar({ phrase: "" });
  assert.equal(res.status, 400);
});

test("POST grammar returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await postGrammar({ phrase: "give up" });
  assert.equal(res.status, 401);
});
