import { before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, relative } from "node:path";

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
  const demo = catalog.routes.find((route) => route.path === "/api/demo");
  assert.ok(demo);
  assert.equal(demo.runtime, "edge");
  const post = demo.methods.find((method) => method.method === "POST");
  assert.equal(post?.authMode, "capability");
  assert.equal(post?.successStatus, 201);
  assert.deepEqual(post?.bodyFieldNames, ["note", "title"]);
  assert.ok(post?.responseKeys?.includes("message"));

  const patch = demo.methods.find((method) => method.method === "PATCH");
  assert.deepEqual(patch?.bodyFieldNames, ["note", "title"]);

  const auth = catalog.routes.find((route) => route.path === "/api/auth/{...nextauth}");
  assert.deepEqual(auth?.methods.map((method) => method.responseFormat), ["nextauth", "nextauth"]);

  const download = catalog.routes.find((route) => route.path === "/api/download");
  assert.equal(download?.methods[0].successStatus, 204);
  assert.equal(download?.methods[0].responseFormat, "download-json");

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
