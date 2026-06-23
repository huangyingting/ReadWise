process.env.LOG_LEVEL = "error";
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

// Mutable auth state
let authState: "ok" | "unauth" = "ok";
const session = { user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" } };

// Mutable lib return values
let translateSentenceResult: { translation: string | null; fallback: boolean } | null = {
  translation: "Hola mundo",
  fallback: false,
};
let supportedLang = true;

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
          : { session },
      requireAdminApi: async () => ({ session }),
    },
  });

  mock.module("@/lib/sentence-translation", {
    namedExports: {
      translateSentence: async () => translateSentenceResult,
      MAX_SENTENCE_CHARS: 1000,
    },
  });

  mock.module("@/lib/translation", {
    namedExports: {
      isSupportedLanguage: () => supportedLang,
      htmlToPlainText: (html: string) => html,
    },
  });

  mock.module("@/lib/article-access", {
    namedExports: {
      articleAccessContext: (user: { id: string; role: string }) => ({
        userId: user.id,
        role: user.role,
      }),
      getReadableArticleById: async () => ({ id: "a1", status: "published" }),
    },
  });
});

beforeEach(() => {
  authState = "ok";
  supportedLang = true;
  translateSentenceResult = { translation: "Hola mundo", fallback: false };
});

function jsonReq(body: unknown): Request {
  return new Request("http://test/api/reader/a1/translate-sentence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(id = "a1") {
  return { params: Promise.resolve({ id }) };
}

test("POST translate-sentence returns translation and fallback flag", async () => {
  const { POST } = (await import(
    "@/app/api/reader/[id]/translate-sentence/route"
  )) as { POST: RouteHandler };
  const res = await POST(jsonReq({ text: "Hello world", lang: "es" }), ctx());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.translation, "Hola mundo");
  assert.equal(body.fallback, false);
  assert.ok(res.headers.get("x-request-id"));
});

test("POST translate-sentence returns fallback:true when AI unavailable", async () => {
  translateSentenceResult = { translation: null, fallback: true };
  const { POST } = (await import(
    "@/app/api/reader/[id]/translate-sentence/route"
  )) as { POST: RouteHandler };
  const res = await POST(jsonReq({ text: "Hello world", lang: "es" }), ctx());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.fallback, true);
  assert.equal(body.translation, null);
});

test("POST translate-sentence returns 404 when article not found", async () => {
  translateSentenceResult = null;
  const { POST } = (await import(
    "@/app/api/reader/[id]/translate-sentence/route"
  )) as { POST: RouteHandler };
  const res = await POST(jsonReq({ text: "Hello world", lang: "es" }), ctx());
  assert.equal(res.status, 404);
});

test("POST translate-sentence returns 400 for unsupported language", async () => {
  supportedLang = false;
  const { POST } = (await import(
    "@/app/api/reader/[id]/translate-sentence/route"
  )) as { POST: RouteHandler };
  const res = await POST(jsonReq({ text: "Hello world", lang: "zz" }), ctx());
  assert.equal(res.status, 400);
});

test("POST translate-sentence returns 400 for empty text", async () => {
  const { POST } = (await import(
    "@/app/api/reader/[id]/translate-sentence/route"
  )) as { POST: RouteHandler };
  const res = await POST(jsonReq({ text: "", lang: "es" }), ctx());
  assert.equal(res.status, 400);
});

test("POST translate-sentence returns 400 for text exceeding 1000 chars", async () => {
  const { POST } = (await import(
    "@/app/api/reader/[id]/translate-sentence/route"
  )) as { POST: RouteHandler };
  const longText = "a".repeat(1001);
  const res = await POST(jsonReq({ text: longText, lang: "es" }), ctx());
  assert.equal(res.status, 400);
});

test("POST translate-sentence returns 400 when text is missing", async () => {
  const { POST } = (await import(
    "@/app/api/reader/[id]/translate-sentence/route"
  )) as { POST: RouteHandler };
  const res = await POST(jsonReq({ lang: "es" }), ctx());
  assert.equal(res.status, 400);
});

test("POST translate-sentence returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { POST } = (await import(
    "@/app/api/reader/[id]/translate-sentence/route"
  )) as { POST: RouteHandler };
  const res = await POST(jsonReq({ text: "Hello world", lang: "es" }), ctx());
  assert.equal(res.status, 401);
});
