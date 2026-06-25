/**
 * Tests for GET /api/reader/[id]/speech/audio (#372).
 * Mocks prisma, storage, and article-access — no real DB or network.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { withParams, getReq } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";
import { makePrisma } from "./support/prisma-mock";

let authState: AuthState = "ok";

// Article-access state
let articleReadable = true;

// Speech row state
let speechRow: {
  mimeType: string;
  audioBase64: string | null;
  storageKey: string | null;
} | null = null;

// Storage state
let storageBytes: Buffer | null = null;
let storageConfigured = false;

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: makePrisma({
        articleSpeech: {
          findUnique: async () => speechRow,
        },
        article: {
          findFirst: async () =>
            articleReadable ? { id: "a1", title: "T", content: "<p>Hi</p>" } : null,
        },
      }),
    },
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      articleAccessContext: (user: unknown) => ({ userId: (user as { id?: string })?.id ?? null, role: (user as { role?: string })?.role ?? null }),
      getReadableArticleById: async () =>
        articleReadable ? { id: "a1", title: "T" } : null,
    },
  });

  mock.module("@/lib/storage", {
    namedExports: {
      getMediaStorage: () =>
        storageConfigured
          ? {
              kind: "filesystem" as const,
              get: async (_key: string) => storageBytes,
              put: async () => ({ storageKey: "k", sizeBytes: 0, checksum: "" }),
              delete: async () => {},
            }
          : null,
    },
  });
});

beforeEach(() => {
  authState = "ok";
  articleReadable = true;
  speechRow = null;
  storageBytes = null;
  storageConfigured = false;
});

async function callGet(id: string) {
  const { GET } = await import("@/app/api/reader/[id]/speech/audio/route");
  return GET(getReq(`http://test/api/reader/${id}/speech/audio`), withParams({ id }));
}

test("GET /speech/audio returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await callGet("a1");
  assert.equal(res.status, 401);
});

test("GET /speech/audio returns 404 when article is not readable", async () => {
  articleReadable = false;
  const res = await callGet("a1");
  assert.equal(res.status, 404);
});

test("GET /speech/audio returns 404 when no speech row exists", async () => {
  speechRow = null;
  const res = await callGet("a1");
  assert.equal(res.status, 404);
});

test("GET /speech/audio serves base64 fallback when storageKey is null", async () => {
  const audioData = Buffer.from("fake-mp3-bytes");
  speechRow = {
    mimeType: "audio/mpeg",
    audioBase64: audioData.toString("base64"),
    storageKey: null,
  };
  const res = await callGet("a1");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "audio/mpeg");
  const body = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(body, audioData);
});

test("GET /speech/audio serves bytes from MediaStorage when storageKey is set", async () => {
  const audioData = Buffer.from("storage-audio-bytes");
  storageConfigured = true;
  storageBytes = audioData;
  speechRow = {
    mimeType: "audio/mpeg",
    audioBase64: null,
    storageKey: "speech/abc123.mp3",
  };
  const res = await callGet("a1");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "audio/mpeg");
  const body = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(body, audioData);
});

test("GET /speech/audio returns 404 when storageKey set but storage unavailable and no base64", async () => {
  storageConfigured = false; // storage returns null from getMediaStorage()
  speechRow = {
    mimeType: "audio/mpeg",
    audioBase64: null,
    storageKey: "speech/abc123.mp3",
  };
  const res = await callGet("a1");
  assert.equal(res.status, 404);
});

test("GET /speech/audio Cache-Control is private", async () => {
  const audioData = Buffer.from("x");
  speechRow = {
    mimeType: "audio/mpeg",
    audioBase64: audioData.toString("base64"),
    storageKey: null,
  };
  const res = await callGet("a1");
  assert.equal(res.status, 200);
  const cc = res.headers.get("Cache-Control") ?? "";
  assert.ok(cc.includes("private"), `Cache-Control should contain 'private', got: ${cc}`);
});

test("GET /speech/audio sets Content-Length header", async () => {
  const audioData = Buffer.from("length-check-bytes");
  speechRow = {
    mimeType: "audio/mpeg",
    audioBase64: audioData.toString("base64"),
    storageKey: null,
  };
  const res = await callGet("a1");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Length"), String(audioData.byteLength));
});
