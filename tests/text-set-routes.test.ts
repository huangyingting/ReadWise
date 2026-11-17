/**
 * HTTP route tests for the Text Set API (#1308). The domain commands are
 * mocked (real-database behaviour lives in tests/db/text-sets.test.ts); these
 * cover auth, body validation, status mapping, and audit wiring.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, deleteReq, getReq, jsonPatch, jsonPost, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

type Failure = { ok: false; status: number; reason: string };

let authState: AuthState = "ok";
let calls: Array<{ fn: string; args: unknown[] }> = [];
let failure: Failure | null = null;
let auditEntries: Array<Record<string, unknown>> = [];
let detail: Record<string, unknown> | null = { id: "ts1", title: "Unit" };
let searchResult: unknown[] | null = [{ id: "a1" }];

function record(fn: string, args: unknown[]) {
  calls.push({ fn, args });
}

function auditViaFactory(factory: unknown) {
  const build = factory as (entry: { action: string; targetId: string; metadata: Record<string, unknown> }) => Record<string, unknown>;
  auditEntries.push(build({ action: "text_set.test", targetId: "ts1", metadata: { orgId: "org-1" } }));
}

before(() => {
  mock.module("@/lib/api-auth", { namedExports: fullAuthExports(() => authState) });
  mock.module("@/lib/classroom/text-sets", {
    namedExports: {
      TEXT_SET_MAX_ITEMS: 20,
      TEXT_SET_VISIBILITIES: ["PRIVATE", "ORG"],
      listTextSetsForViewer: async (_viewer: unknown) => {
        record("list", [_viewer]);
        return { mine: [{ id: "ts1" }], shared: [] };
      },
      createTextSet: async (_viewer: unknown, orgId: string, input: unknown, audit: unknown) => {
        record("create", [orgId, input]);
        auditViaFactory(audit);
        return failure ?? { ok: true, id: "ts-new" };
      },
      getTextSetForViewer: async (id: string) => {
        record("get", [id]);
        return detail;
      },
      updateTextSet: async (id: string, _viewer: unknown, input: unknown, audit: unknown) => {
        record("update", [id, input]);
        auditViaFactory(audit);
        return failure ?? { ok: true };
      },
      deleteTextSet: async (id: string, _viewer: unknown, audit: unknown) => {
        record("delete", [id]);
        auditViaFactory(audit);
        return failure ?? { ok: true };
      },
      duplicateTextSet: async (id: string) => {
        record("duplicate", [id]);
        return failure ?? { ok: true, id: "ts-copy" };
      },
      assignTextSet: async (id: string, _viewer: unknown, input: unknown) => {
        record("assign", [id, input]);
        return failure ?? { ok: true, classrooms: [{ classroomId: "c1", created: 2, failed: 0 }] };
      },
      searchTextSetArticleOptions: async (_viewer: unknown, orgId: string, q: string) => {
        record("search", [orgId, q]);
        return searchResult;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  calls = [];
  failure = null;
  auditEntries = [];
  detail = { id: "ts1", title: "Unit" };
  searchResult = [{ id: "a1" }];
});

async function routes() {
  return {
    collection: (await import("@/app/api/text-sets/route")) as { GET: RouteHandler; POST: RouteHandler },
    item: (await import("@/app/api/text-sets/[id]/route")) as {
      GET: RouteHandler;
      PATCH: RouteHandler;
      DELETE: RouteHandler;
    },
    duplicate: (await import("@/app/api/text-sets/[id]/duplicate/route")) as { POST: RouteHandler },
    assign: (await import("@/app/api/text-sets/[id]/assign/route")) as { POST: RouteHandler },
    options: (await import("@/app/api/text-sets/article-options/route")) as { GET: RouteHandler },
  };
}

const BASE = "http://test/api/text-sets";
const params = withParams({ id: "ts1" });
const BODY = {
  title: "Wildfire",
  essentialQuestion: null,
  description: "Read in order",
  educatorNotes: null,
  visibility: "ORG",
  items: [{ articleId: "a1", guidingNote: null }],
};

test("every text set route requires a session", async () => {
  authState = "unauth";
  const r = await routes();
  const statuses = [
    (await r.collection.GET(getReq(BASE))).status,
    (await r.collection.POST(jsonPost(BASE, { organizationId: "org-1", ...BODY }))).status,
    (await r.item.GET(getReq(`${BASE}/ts1`), params)).status,
    (await r.item.PATCH(jsonPatch(`${BASE}/ts1`, BODY), params)).status,
    (await r.item.DELETE(deleteReq(`${BASE}/ts1`), params)).status,
    (await r.duplicate.POST(jsonPost(`${BASE}/ts1/duplicate`, {}), params)).status,
    (await r.assign.POST(jsonPost(`${BASE}/ts1/assign`, { classroomIds: ["c1"] }), params)).status,
    (await r.options.GET(getReq(`${BASE}/article-options?organizationId=org-1`))).status,
  ];
  assert.deepEqual(statuses, Array(8).fill(401));
  assert.deepEqual(calls, []);
});

test("list and create", async () => {
  const r = await routes();
  const list = await r.collection.GET(getReq(BASE));
  assert.deepEqual(await list.json(), { mine: [{ id: "ts1" }], shared: [] });

  const created = await r.collection.POST(jsonPost(BASE, { organizationId: "org-1", ...BODY }));
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { ok: true, id: "ts-new" });
  assert.equal(calls.at(-1)?.args[0], "org-1");
  assert.equal((calls.at(-1)?.args[1] as { title: string }).title, "Wildfire");
  assert.equal(auditEntries[0]?.targetType, "text_set");
  assert.equal(auditEntries[0]?.action, "text_set.test");
  assert.equal(auditEntries[0]?.requestId !== undefined, true);
});

test("create validates the body", async () => {
  const r = await routes();
  for (const body of [
    { ...BODY },
    { organizationId: "org-1", ...BODY, title: "" },
    { organizationId: "org-1", ...BODY, visibility: "PUBLIC" },
    { organizationId: "org-1", ...BODY, items: Array.from({ length: 21 }, (_, i) => ({ articleId: `a${i}` })) },
  ]) {
    assert.equal((await r.collection.POST(jsonPost(BASE, body))).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.deepEqual(calls, []);
});

test("domain failures map to their status and message", async () => {
  const r = await routes();
  const cases: Array<[Failure, number, string]> = [
    [{ ok: false, status: 403, reason: "forbidden" }, 403, "Forbidden"],
    [{ ok: false, status: 404, reason: "not_found" }, 404, "Text set not found"],
    [{ ok: false, status: 400, reason: "invalid_articles" }, 400, "One or more articles aren't available to this organization"],
    [{ ok: false, status: 400, reason: "empty_items" }, 400, "Add at least one article to the text set"],
    [{ ok: false, status: 400, reason: "invalid_classrooms" }, 400, "Choose active classrooms you manage in this organization"],
  ];
  for (const [nextFailure, status, message] of cases) {
    failure = nextFailure;
    const res = await r.collection.POST(jsonPost(BASE, { organizationId: "org-1", ...BODY }));
    assert.equal(res.status, status);
    assert.equal(((await res.json()) as { error: string }).error, message);
  }
  failure = { ok: false, status: 403, reason: "forbidden" };
  assert.equal((await r.item.PATCH(jsonPatch(`${BASE}/ts1`, BODY), params)).status, 403);
  assert.equal((await r.item.DELETE(deleteReq(`${BASE}/ts1`), params)).status, 403);
  assert.equal((await r.duplicate.POST(jsonPost(`${BASE}/ts1/duplicate`, {}), params)).status, 403);
  assert.equal((await r.assign.POST(jsonPost(`${BASE}/ts1/assign`, { classroomIds: ["c1"] }), params)).status, 403);
});

test("read, update, delete, duplicate, and assign succeed", async () => {
  const r = await routes();
  assert.deepEqual(await (await r.item.GET(getReq(`${BASE}/ts1`), params)).json(), {
    textSet: { id: "ts1", title: "Unit" },
  });
  detail = null;
  assert.equal((await r.item.GET(getReq(`${BASE}/ts1`), params)).status, 404);

  assert.deepEqual(await (await r.item.PATCH(jsonPatch(`${BASE}/ts1`, BODY), params)).json(), { ok: true });
  assert.deepEqual(await (await r.item.DELETE(deleteReq(`${BASE}/ts1`), params)).json(), { ok: true });
  const dup = await r.duplicate.POST(jsonPost(`${BASE}/ts1/duplicate`, {}), params);
  assert.equal(dup.status, 201);
  assert.deepEqual(await dup.json(), { ok: true, id: "ts-copy" });

  const assigned = await r.assign.POST(jsonPost(`${BASE}/ts1/assign`, { classroomIds: ["c1"], dueDate: "2026-12-31" }), params);
  assert.deepEqual(await assigned.json(), { ok: true, classrooms: [{ classroomId: "c1", created: 2, failed: 0 }] });
  assert.deepEqual(calls.at(-1), { fn: "assign", args: ["ts1", { classroomIds: ["c1"], dueDate: "2026-12-31" }] });
  assert.equal((await r.assign.POST(jsonPost(`${BASE}/ts1/assign`, { classroomIds: "c1" }), params)).status, 400);
});

test("article options require an organization and teaching access", async () => {
  const r = await routes();
  assert.equal((await r.options.GET(getReq(`${BASE}/article-options`))).status, 400);
  const ok = await r.options.GET(getReq(`${BASE}/article-options?organizationId=org-1&q=${"x".repeat(150)}`));
  assert.deepEqual(await ok.json(), { articles: [{ id: "a1" }] });
  assert.equal((calls.at(-1)?.args[1] as string).length, 100, "query is capped");
  searchResult = null;
  assert.equal((await r.options.GET(getReq(`${BASE}/article-options?organizationId=org-1`))).status, 403);
});
