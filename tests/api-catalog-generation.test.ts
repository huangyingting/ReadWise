import { before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, relative } from "node:path";
import type { ApiCatalog } from "@/tools/api-catalog";

const ROOT = process.cwd();
const API_ROOT = join(ROOT, "src", "app", "api");
const files = new Map<string, string>();

function addRoute(relativeDir: string, source: string): void {
  files.set(join(API_ROOT, relativeDir, "route.ts"), source);
}

function directChildren(dir: string): string[] {
  const children = new Set<string>();
  for (const file of files.keys()) {
    const rel = relative(dir, file);
    if (rel.startsWith("..") || rel === "") continue;
    children.add(rel.split(/[\\/]/)[0]);
  }
  return [...children].sort();
}

function isDirectory(path: string): boolean {
  return [...files.keys()].some((file) => dirname(file) === path || file.startsWith(`${path}/`));
}

function findRoute(catalog: ApiCatalog, path: string) {
  return catalog.routes.find((route) => route.path === path);
}

before(() => {
  addRoute(
    "demo",
    `
import { NextResponse } from "next/server";
import { createCapabilityHandler, CAPABILITIES } from "@/lib/api-handler";
const sharedBody = object({
  title: string(),
  note
});
export const runtime = "edge";
export const POST = createCapabilityHandler(CAPABILITIES.articles.review, {
  body: object({
    title: string({ label: \`template literal should not be a key\` }),
    note,
    ...spreadFields,
  }),
  query: object({ q: string() }),
  params: idParams,
}, async ({ params }) => {
  const cursor = params.get("cursor");
  return NextResponse.json({
    ok: true,
    message: \`cursor \${cursor}\`,
    shorthand
  }, { status: 201 });
});
export const PATCH = createCapabilityHandler("customCapability", {
  body: sharedBody,
}, async () => NextResponse.json(result));
`,
  );
  addRoute(
    "download",
    `
import { createPublicHandler } from "@/lib/api-handler";
export const GET = createPublicHandler({}, async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Content-Disposition": "attachment; filename=\"export.json\"",
      "content-type": "application/json"
    }
  });
});
`,
  );
  addRoute(
    "helper-download",
    `
import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
const EXPORT_RESPONSE_INIT = {
  status: 200,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
  },
} as const;
function exportJsonResponse(json, filename) {
  return new NextResponse(json, {
    ...EXPORT_RESPONSE_INIT,
    headers: {
      ...EXPORT_RESPONSE_INIT.headers,
      "Content-Disposition": \`attachment; filename="\${filename}"\`,
    },
  });
}
export const GET = createHandler({}, async () => {
  return exportJsonResponse("{}", "demo.json");
});
`,
  );
  addRoute(
    "helper-response",
    `
import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { queryInt } from "@/lib/validation";
const CREATED_RESPONSE_INIT = { status: 201 } as const;
const NO_CONTENT_STATUS = 204;
function createdResponse(member) {
  return NextResponse.json({ ok: true, member }, CREATED_RESPONSE_INIT);
}
function noContent() {
  return new NextResponse(null, { status: NO_CONTENT_STATUS });
}
function helperQuery(params) {
  return { ok: true, value: { hours: queryInt(params, "hours") } };
}
export const POST = createHandler({ query: helperQuery }, async () => {
  return createdResponse({ id: "member-1" });
});
export const DELETE = createHandler({}, async () => {
  return noContent();
});
`,
  );
  addRoute(
    "inline-helper-query",
    `
import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { queryString } from "@/lib/validation";
function parseFormat(params) {
  return params.get("format") === "csv" ? "csv" : "json";
}
function parseTimezone(params) {
  return queryString(params, "timezone").trim() || null;
}
export const GET = createHandler({
  query: (params) => ({
    ok: true,
    value: {
      days: params.get("days"),
      format: parseFormat(params),
      timezone: parseTimezone(params),
    },
  }),
}, async () => {
  return NextResponse.json({ ok: true });
});
`,
  );
  addRoute(
    "placement",
    `
import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, number, nonEmptyString, oneOf, type ValidationResult } from "@/lib/validation";

type PlacementSeedLevel = "a1" | "a2";
const PLACEMENT_SEED_LEVELS = ["a1", "a2"] as const;
const placementSchema = object({
  articleId: nonEmptyString(200),
  correctCount: number({ int: true }),
  seedLevel: oneOf(PLACEMENT_SEED_LEVELS),
});

function placementQuery(
  params: URLSearchParams,
): ValidationResult<{ seedLevel: PlacementSeedLevel }> {
  const raw = params.get("seedLevel");
  return { ok: true, value: { seedLevel: raw as PlacementSeedLevel } };
}

export const GET = createHandler(
  { query: placementQuery },
  async ({ query }) => {
    return NextResponse.json({ seedLevel: query.seedLevel });
  },
);

export const POST = createHandler(
  { body: placementSchema },
  async ({ body }) => {
    return NextResponse.json({ ok: true, articleId: body.articleId });
  },
);
`,
  );
  addRoute(
    "broken",
    `
import { createHandler } from "@/lib/api-handler";
export const GET = createHandler({}, async () => NextResponse.json({
`,
  );
  addRoute(
    "auth/[...nextauth]",
    `
import NextAuth from "next-auth";
const handler = NextAuth({});
export { handler as GET, handler as POST };
`,
  );

  mock.module("node:fs", {
    namedExports: {
      readdirSync: (dir: string) => directChildren(dir),
      statSync: (path: string) => ({
        isDirectory: () => isDirectory(path),
      }),
      readFileSync: (path: string) => {
        const source = files.get(path);
        if (source === undefined) throw new Error(`missing fake route: ${path}`);
        return source;
      },
    },
  });
});

test("api catalog parses synthetic routes and renders markdown summaries", async () => {
  const { buildCatalog, buildCatalogMarkdown } = await import("@/tools/api-catalog");

  const catalog = buildCatalog();
  const demo = findRoute(catalog, "/api/demo");
  assert.ok(demo);
  assert.equal(demo.runtime, "edge");
  const post = demo.methods.find((method) => method.method === "POST");
  assert.equal(post?.authMode, "capability");
  assert.equal(post?.successStatus, 201);
  assert.deepEqual(post?.bodyFieldNames, ["note", "title"]);
  assert.ok(post?.responseKeys?.includes("message"));

  const patch = demo.methods.find((method) => method.method === "PATCH");
  assert.deepEqual(patch?.bodyFieldNames, ["note", "title"]);

  const auth = findRoute(catalog, "/api/auth/{...nextauth}");
  assert.deepEqual(auth?.methods.map((method) => method.responseFormat), ["nextauth", "nextauth"]);

  const download = findRoute(catalog, "/api/download");
  assert.equal(download?.methods[0].successStatus, 204);
  assert.equal(download?.methods[0].responseFormat, "download-json");

  const helperDownload = findRoute(catalog, "/api/helper-download");
  assert.equal(helperDownload?.methods[0].responseFormat, "download-json");

  const helperResponse = findRoute(catalog, "/api/helper-response");
  const helperPost = helperResponse?.methods.find((method) => method.method === "POST");
  assert.equal(helperPost?.successStatus, 201);
  assert.deepEqual(helperPost?.responseKeys, ["member", "ok"]);
  assert.deepEqual(helperPost?.queryParamNames, ["hours"]);
  const helperDelete = helperResponse?.methods.find((method) => method.method === "DELETE");
  assert.equal(helperDelete?.successStatus, 204);

  const inlineHelperQuery = findRoute(catalog, "/api/inline-helper-query");
  assert.deepEqual(inlineHelperQuery?.methods[0]?.queryParamNames, [
    "days",
    "format",
    "timezone",
  ]);

  const placement = findRoute(catalog, "/api/placement");
  const placementGet = placement?.methods.find((method) => method.method === "GET");
  assert.equal(placementGet?.hasBodySchema, false);
  assert.equal(placementGet?.hasQuerySchema, true);
  assert.equal(placementGet?.bodyFieldNames, null);
  assert.deepEqual(placementGet?.queryParamNames, ["seedLevel"]);
  const placementPost = placement?.methods.find((method) => method.method === "POST");
  assert.equal(placementPost?.hasBodySchema, true);
  assert.equal(placementPost?.hasQuerySchema, false);
  assert.deepEqual(placementPost?.bodyFieldNames, [
    "articleId",
    "correctCount",
    "seedLevel",
  ]);

  const markdown = buildCatalogMarkdown({
    ...catalog,
    generatedAt: "2026-07-01T20:00:00.000Z",
  });
  assert.match(markdown, /last_updated: "2026-07-01"/);
  assert.match(markdown, /Summary by auth mode/);
  assert.match(markdown, /Non-JSON routes/);
  assert.match(markdown, /Contract highlights/);
  assert.match(markdown, /\/api\/demo/);
  assert.match(markdown, /JSON download/);
});
