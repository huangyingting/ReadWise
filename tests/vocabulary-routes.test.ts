/**
 * Route tests for GET /api/vocabulary/export and POST /api/vocabulary/unsave.
 *
 * Validates:
 * - Auth required for both routes
 * - Export returns CSV format by default with proper headers
 * - Export returns Anki (TSV) format when requested
 * - Export returns 400 for invalid format
 * - Unsave accepts valid word and returns {word, saved:false}
 * - Unsave rejects empty body
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { getReq, jsonPost, readJson, type RouteHandler } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

let authState: AuthState = "ok";
let savedWords: Array<{
  word: string;
  explanation: string;
  example: string;
  articleId: string;
  createdAt: Date;
}> = [];
let unsavedWord: string | null = null;

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });

  mock.module("@/lib/lexical/saved-words", {
    namedExports: {
      getSavedWords: async () => savedWords,
      unsaveWord: async (_userId: string, word: string) => {
        unsavedWord = word;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  unsavedWord = null;
  savedWords = [
    {
      word: "confidence",
      explanation: "feeling of trust",
      example: "She spoke with confidence.",
      articleId: "a1",
      createdAt: new Date("2026-06-01T10:00:00Z"),
    },
    {
      word: "practice",
      explanation: "repeated exercise",
      example: "Practice makes perfect.",
      articleId: "a2",
      createdAt: new Date("2026-06-02T10:00:00Z"),
    },
  ];
});

// ── Export route ──────────────────────────────────────────────────────────

let exportGET: RouteHandler;
before(async () => {
  const mod = await import("@/app/api/vocabulary/export/route");
  exportGET = mod.GET as unknown as RouteHandler;
});

test("GET /api/vocabulary/export returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await exportGET(getReq("http://test/api/vocabulary/export"));
  assert.equal(res.status, 401);
});

test("GET /api/vocabulary/export returns CSV by default", async () => {
  const res = await exportGET(getReq("http://test/api/vocabulary/export"));
  assert.equal(res.status, 200);

  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.includes("text/csv"), `expected CSV content-type, got: ${ct}`);

  const disposition = res.headers.get("content-disposition") ?? "";
  assert.ok(disposition.includes(".csv"), "filename should end in .csv");

  const body = await res.text();
  assert.ok(body.startsWith("word,explanation,example,articleId,savedAt"));
  assert.ok(body.includes("confidence"));
  assert.ok(body.includes("practice"));
});

test("GET /api/vocabulary/export?format=anki returns TSV format", async () => {
  const res = await exportGET(getReq("http://test/api/vocabulary/export?format=anki"));
  assert.equal(res.status, 200);

  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.includes("text/plain"), `expected text/plain for anki, got: ${ct}`);

  const disposition = res.headers.get("content-disposition") ?? "";
  assert.ok(disposition.includes(".txt"), "filename should end in .txt");

  const body = await res.text();
  // Anki format: word\tback
  assert.ok(body.includes("confidence\t"));
  assert.ok(body.includes("practice\t"));
});

test("GET /api/vocabulary/export?format=invalid returns 400", async () => {
  const res = await exportGET(getReq("http://test/api/vocabulary/export?format=invalid"));
  assert.equal(res.status, 400);
});

// ── Unsave route ─────────────────────────────────────────────────────────

let unsavePOST: RouteHandler;
before(async () => {
  const mod = await import("@/app/api/vocabulary/unsave/route");
  unsavePOST = mod.POST as unknown as RouteHandler;
});

test("POST /api/vocabulary/unsave returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await unsavePOST(jsonPost("http://test/api/vocabulary/unsave", { word: "test" }));
  assert.equal(res.status, 401);
});

test("POST /api/vocabulary/unsave returns success for valid word", async () => {
  const res = await unsavePOST(jsonPost("http://test/api/vocabulary/unsave", { word: "confidence" }));
  assert.equal(res.status, 200);
  const body = await readJson<{ word: string; saved: boolean }>(res);
  assert.equal(body.word, "confidence");
  assert.equal(body.saved, false);
  assert.equal(unsavedWord, "confidence");
});

test("POST /api/vocabulary/unsave returns 400 for empty body", async () => {
  const res = await unsavePOST(jsonPost("http://test/api/vocabulary/unsave", {}));
  assert.equal(res.status, 400);
});

test("POST /api/vocabulary/unsave returns 400 for empty string word", async () => {
  const res = await unsavePOST(jsonPost("http://test/api/vocabulary/unsave", { word: "" }));
  assert.equal(res.status, 400);
});
