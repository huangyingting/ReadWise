process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { type AuthState, fullAuthExports } from "./support/auth-mock";
import {
  type RouteHandler,
  deleteReq,
  getReq,
  jsonPatch,
  jsonPost,
  readJson,
  withParams,
} from "./support/route";

type DomainError = { ok: false; status: number; error: string };
type SeriesDetail = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  topic: string | null;
  targetLevelMin: string | null;
  targetLevelMax: string | null;
  status: "draft" | "active" | "archived";
  public: boolean;
  articleIds: string[];
  articleCount: number;
  createdAt: Date;
  updatedAt: Date;
};
type MutationResult = { ok: true; series: SeriesDetail } | DomainError;
type DeleteResult = { ok: true } | DomainError;

let authState: AuthState = "ok";
let listRows: Array<Omit<SeriesDetail, "articleIds">> = [];
let detailRow: SeriesDetail | null = null;
let createResult: MutationResult;
let updateResult: MutationResult;
let reorderResult: MutationResult;
let deleteResult: DeleteResult;

let listCalls = 0;
let detailCalls: string[] = [];
let createCalls: Array<Record<string, unknown>> = [];
let updateCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
let reorderCalls: Array<{ id: string; articleIds: string[] }> = [];
let deleteCalls: string[] = [];

const COLLECTION_URL = "http://test/api/admin/series";
const DETAIL_URL = "http://test/api/admin/series/series-1";
const REORDER_URL = "http://test/api/admin/series/series-1/reorder";

function makeSeries(id: string, status: "draft" | "active" | "archived" = "draft"): SeriesDetail {
  return {
    id,
    slug: `slug-${id}`,
    title: `Series ${id}`,
    description: null,
    topic: null,
    targetLevelMin: null,
    targetLevelMax: null,
    status,
    public: false,
    articleIds: ["a1", "a2"],
    articleCount: 2,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  };
}

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/engagement/series", {
    namedExports: {
      listSeriesForAdmin: async () => {
        listCalls += 1;
        return listRows;
      },
      getSeriesForAdmin: async (id: string) => {
        detailCalls.push(id);
        return detailRow;
      },
      createReadingSeries: async (body: Record<string, unknown>) => {
        createCalls.push(body);
        return createResult;
      },
      updateReadingSeries: async (id: string, body: Record<string, unknown>) => {
        updateCalls.push({ id, body });
        return updateResult;
      },
      reorderReadingSeriesItems: async (id: string, articleIds: string[]) => {
        reorderCalls.push({ id, articleIds });
        return reorderResult;
      },
      deleteReadingSeries: async (id: string) => {
        deleteCalls.push(id);
        return deleteResult;
      },
      SERIES_STATUSES: ["draft", "active", "archived"],
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: { securityAdminAccessDenied: "security.admin_access_denied" },
      auditRequestInfo: () => ({ ipAddress: null, userAgent: null }),
      tryRecordAuditLog: async () => {},
      recordAuditFromRequest: async () => {},
    },
  });

  mock.module("@/lib/security/events", {
    namedExports: {
      SECURITY_EVENT_TYPES: {
        unauthorized: "auth.unauthorized",
        forbidden: "auth.forbidden",
        rateLimited: "rate_limited",
        csrfBlocked: "csrf.blocked",
        adminMutation: "admin.mutation",
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
});

beforeEach(() => {
  authState = "ok";
  listRows = [];
  detailRow = null;
  createResult = { ok: true, series: makeSeries("created") };
  updateResult = { ok: true, series: makeSeries("series-1", "active") };
  reorderResult = { ok: true, series: makeSeries("series-1", "active") };
  deleteResult = { ok: true };
  listCalls = 0;
  detailCalls = [];
  createCalls = [];
  updateCalls = [];
  reorderCalls = [];
  deleteCalls = [];
});

async function loadCollectionHandlers(): Promise<{ GET: RouteHandler; POST: RouteHandler }> {
  return import("@/app/api/admin/series/route") as Promise<{ GET: RouteHandler; POST: RouteHandler }>;
}

async function loadDetailHandlers(): Promise<{ GET: RouteHandler; PATCH: RouteHandler; DELETE: RouteHandler }> {
  return import("@/app/api/admin/series/[id]/route") as Promise<{
    GET: RouteHandler;
    PATCH: RouteHandler;
    DELETE: RouteHandler;
  }>;
}

async function loadReorderHandler(): Promise<RouteHandler> {
  const mod = await import("@/app/api/admin/series/[id]/reorder/route") as { POST: RouteHandler };
  return mod.POST;
}

test("GET /api/admin/series enforces auth/capability and returns list payloads", async () => {
  const { GET } = await loadCollectionHandlers();

  authState = "unauth";
  let res = await GET(getReq(COLLECTION_URL), undefined);
  assert.equal(res.status, 401);
  assert.equal(listCalls, 0);

  authState = "forbidden";
  res = await GET(getReq(COLLECTION_URL), undefined);
  assert.equal(res.status, 403);
  assert.equal(listCalls, 0);

  authState = "ok";
  listRows = [
    makeSeries("series-1") as Omit<SeriesDetail, "articleIds">,
    makeSeries("series-2", "archived") as Omit<SeriesDetail, "articleIds">,
  ];
  res = await GET(getReq(COLLECTION_URL), undefined);
  assert.equal(res.status, 200);
  const body = await readJson<{ series: Array<{ id: string; status: string }> }>(res);
  assert.equal(body.series.length, 2);
  assert.equal(body.series[0]?.id, "series-1");
  assert.equal(body.series[1]?.status, "archived");
});

test("POST /api/admin/series validates payload and maps success/conflict", async () => {
  const { POST } = await loadCollectionHandlers();

  let res = await POST(jsonPost(COLLECTION_URL, {}), undefined);
  assert.equal(res.status, 400);

  createResult = { ok: false, status: 409, error: "slug already exists" };
  res = await POST(
    jsonPost(COLLECTION_URL, {
      slug: "tech-daily",
      title: "Tech Daily",
    }),
    undefined,
  );
  assert.equal(res.status, 409);

  createResult = { ok: true, series: makeSeries("created") };
  res = await POST(
    jsonPost(COLLECTION_URL, {
      slug: "  tech-daily ",
      title: "Tech Daily",
      articleIds: ["a1", "a2"],
    }),
    undefined,
  );
  assert.equal(res.status, 201);
  const body = await readJson<{ ok: boolean; series: { id: string } }>(res);
  assert.equal(body.ok, true);
  assert.equal(body.series.id, "created");
  assert.equal(createCalls.length, 2);
  assert.equal(createCalls.at(-1)?.slug, "tech-daily");
});

test("GET/PATCH/DELETE /api/admin/series/[id] cover not-found, validation, mutation, and conflicts", async () => {
  const { GET, PATCH, DELETE } = await loadDetailHandlers();

  let res = await GET(getReq(DETAIL_URL), withParams({ id: "series-1" }));
  assert.equal(res.status, 404);
  assert.deepEqual(detailCalls, ["series-1"]);

  detailRow = makeSeries("series-1");
  res = await GET(getReq(DETAIL_URL), withParams({ id: "series-1" }));
  assert.equal(res.status, 200);
  const detailBody = await readJson<{ series: { id: string } }>(res);
  assert.equal(detailBody.series.id, "series-1");

  authState = "forbidden";
  res = await PATCH(
    jsonPatch(DETAIL_URL, { title: "Updated" }),
    withParams({ id: "series-1" }),
  );
  assert.equal(res.status, 403);
  assert.equal(updateCalls.length, 0);
  authState = "ok";

  res = await PATCH(jsonPatch(DETAIL_URL, { title: "" }), withParams({ id: "series-1" }));
  assert.equal(res.status, 400);

  updateResult = { ok: false, status: 409, error: "Cannot transition series status from active to draft" };
  res = await PATCH(
    jsonPatch(DETAIL_URL, { status: "draft" }),
    withParams({ id: "series-1" }),
  );
  assert.equal(res.status, 409);

  updateResult = { ok: true, series: makeSeries("series-1", "active") };
  res = await PATCH(
    jsonPatch(DETAIL_URL, { title: "Renamed", status: "active" }),
    withParams({ id: "series-1" }),
  );
  assert.equal(res.status, 200);
  const patchBody = await readJson<{ ok: boolean; series: { status: string } }>(res);
  assert.equal(patchBody.ok, true);
  assert.equal(patchBody.series.status, "active");
  assert.equal(updateCalls.at(-1)?.id, "series-1");

  deleteResult = { ok: false, status: 404, error: "Series not found" };
  res = await DELETE(deleteReq(DETAIL_URL), withParams({ id: "series-1" }));
  assert.equal(res.status, 404);

  deleteResult = { ok: false, status: 409, error: "Cannot delete a series with active enrollments" };
  res = await DELETE(deleteReq(DETAIL_URL), withParams({ id: "series-1" }));
  assert.equal(res.status, 409);

  deleteResult = { ok: true };
  res = await DELETE(deleteReq(DETAIL_URL), withParams({ id: "series-1" }));
  assert.equal(res.status, 200);
  const deleteBody = await readJson<{ ok: boolean }>(res);
  assert.equal(deleteBody.ok, true);
  assert.equal(deleteCalls.at(-1), "series-1");
});

test("POST /api/admin/series/[id]/reorder validates body and maps edge-case errors", async () => {
  const POST = await loadReorderHandler();

  let res = await POST(
    jsonPost(REORDER_URL, { articleIds: "bad" }),
    withParams({ id: "series-1" }),
  );
  assert.equal(res.status, 400);

  reorderResult = {
    ok: false,
    status: 400,
    error: "articleIds must contain each existing series article id exactly once",
  };
  res = await POST(
    jsonPost(REORDER_URL, { articleIds: ["a2", "a1"] }),
    withParams({ id: "series-1" }),
  );
  assert.equal(res.status, 400);

  reorderResult = {
    ok: false,
    status: 404,
    error: "Series not found",
  };
  res = await POST(
    jsonPost(REORDER_URL, { articleIds: ["a1", "a2"] }),
    withParams({ id: "series-1" }),
  );
  assert.equal(res.status, 404);

  reorderResult = { ok: true, series: { ...makeSeries("series-1", "active"), articleIds: ["a2", "a1"] } };
  res = await POST(
    jsonPost(REORDER_URL, { articleIds: ["a2", "a1"] }),
    withParams({ id: "series-1" }),
  );
  assert.equal(res.status, 200);
  const body = await readJson<{ ok: boolean; series: { articleIds: string[] } }>(res);
  assert.equal(body.ok, true);
  assert.deepEqual(body.series.articleIds, ["a2", "a1"]);
  assert.deepEqual(reorderCalls.at(-1), { id: "series-1", articleIds: ["a2", "a1"] });
});
