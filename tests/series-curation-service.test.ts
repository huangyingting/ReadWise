process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

type SeriesRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  topic: string | null;
  targetLevelMin: string | null;
  targetLevelMax: string | null;
  articleIds: string[];
  status: "draft" | "active" | "archived";
  public: boolean;
  createdAt: Date;
  updatedAt: Date;
};

let seriesRows: SeriesRow[] = [];
let activeEnrollmentCounts = new Map<string, number>();
let sequence = 0;
let transactionCalls = 0;

function cloneRow(row: SeriesRow): SeriesRow {
  return {
    ...row,
    articleIds: [...row.articleIds],
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function nowFor(seed: number): Date {
  return new Date(Date.UTC(2026, 6, 1, 0, 0, seed));
}

function seedSeries(row: Partial<SeriesRow> = {}): SeriesRow {
  sequence += 1;
  const base: SeriesRow = {
    id: `series-${sequence}`,
    slug: `series-${sequence}`,
    title: `Series ${sequence}`,
    description: null,
    topic: null,
    targetLevelMin: null,
    targetLevelMax: null,
    articleIds: [],
    status: "draft",
    public: false,
    createdAt: nowFor(sequence),
    updatedAt: nowFor(sequence),
  };
  const next = { ...base, ...row };
  next.articleIds = [...next.articleIds];
  seriesRows.push(next);
  return cloneRow(next);
}

before(() => {
  const readingSeries = {
    findMany: async () =>
      [...seriesRows]
        .sort((a, b) =>
          b.updatedAt.getTime() - a.updatedAt.getTime()
          || b.createdAt.getTime() - a.createdAt.getTime()
          || a.id.localeCompare(b.id)
        )
        .map(cloneRow),
    findUnique: async ({
      where,
    }: {
      where: { id?: string; slug?: string };
      select?: unknown;
    }) => {
      if (where.id) {
        const byId = seriesRows.find((row) => row.id === where.id);
        return byId ? cloneRow(byId) : null;
      }
      if (where.slug) {
        const bySlug = seriesRows.find((row) => row.slug === where.slug);
        return bySlug ? cloneRow(bySlug) : null;
      }
      return null;
    },
    create: async ({
      data,
    }: {
      data: {
        slug: string;
        title: string;
        description?: string | null;
        topic?: string | null;
        targetLevelMin?: string | null;
        targetLevelMax?: string | null;
        articleIds?: string[];
        status?: "draft" | "active" | "archived";
        public?: boolean;
      };
    }) => {
      sequence += 1;
      const created: SeriesRow = {
        id: `series-${sequence}`,
        slug: data.slug,
        title: data.title,
        description: data.description ?? null,
        topic: data.topic ?? null,
        targetLevelMin: data.targetLevelMin ?? null,
        targetLevelMax: data.targetLevelMax ?? null,
        articleIds: [...(data.articleIds ?? [])],
        status: data.status ?? "draft",
        public: data.public ?? false,
        createdAt: nowFor(sequence),
        updatedAt: nowFor(sequence),
      };
      seriesRows.push(created);
      return cloneRow(created);
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<SeriesRow>;
    }) => {
      const row = seriesRows.find((entry) => entry.id === where.id);
      if (!row) throw new Error("missing series");
      if (data.slug !== undefined) row.slug = data.slug;
      if (data.title !== undefined) row.title = data.title;
      if (data.description !== undefined) row.description = data.description;
      if (data.topic !== undefined) row.topic = data.topic;
      if (data.targetLevelMin !== undefined) row.targetLevelMin = data.targetLevelMin;
      if (data.targetLevelMax !== undefined) row.targetLevelMax = data.targetLevelMax;
      if (data.articleIds !== undefined) row.articleIds = [...data.articleIds];
      if (data.status !== undefined) row.status = data.status;
      if (data.public !== undefined) row.public = data.public;
      row.updatedAt = nowFor(sequence += 1);
      return cloneRow(row);
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const index = seriesRows.findIndex((entry) => entry.id === where.id);
      if (index < 0) throw new Error("missing series");
      const [removed] = seriesRows.splice(index, 1);
      return cloneRow(removed);
    },
  };

  const seriesEnrollment = {
    count: async ({
      where,
    }: {
      where: { seriesId: string; status?: string };
    }) => activeEnrollmentCounts.get(where.seriesId) ?? 0,
  };

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        readingSeries,
        seriesEnrollment,
        $transaction: async (
          fn: (tx: { readingSeries: typeof readingSeries; seriesEnrollment: typeof seriesEnrollment }) => Promise<unknown>,
        ) => {
          transactionCalls += 1;
          return fn({ readingSeries, seriesEnrollment });
        },
      },
    },
  });

  mock.module("@/lib/article-library/policy", {
    namedExports: {
      getPublicListableArticleById: async () => null,
    },
  });

  mock.module("@/lib/analytics/events", {
    namedExports: {
      ANALYTICS_EVENT_TYPES: { seriesEnrolled: "series_enrolled" },
      recordEvent: async () => {},
    },
  });
});

beforeEach(() => {
  seriesRows = [];
  activeEnrollmentCounts = new Map();
  sequence = 0;
  transactionCalls = 0;
});

const loadSeries = () => import("@/lib/engagement/series");

test("listSeriesForAdmin returns empty and deterministic non-empty rows", async () => {
  const { listSeriesForAdmin } = await loadSeries();
  assert.deepEqual(await listSeriesForAdmin(), []);

  seedSeries({
    id: "s-old",
    slug: "old",
    title: "Old",
    articleIds: ["a1", "a1", "a2"],
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  seedSeries({
    id: "s-new",
    slug: "new",
    title: "New",
    articleIds: ["b1"],
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
  });

  const rows = await listSeriesForAdmin();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "s-new");
  assert.equal(rows[1].id, "s-old");
  assert.equal(rows[1].articleCount, 2);
});

test("getSeriesForAdmin returns detail for existing rows", async () => {
  const { getSeriesForAdmin } = await loadSeries();
  const seeded = seedSeries({
    id: "s-detail",
    slug: "detail",
    articleIds: ["a1", "a2", "a2"],
    status: "active",
    public: true,
  });

  const detail = await getSeriesForAdmin(seeded.id);
  assert.ok(detail);
  assert.equal(detail?.id, "s-detail");
  assert.equal(detail?.status, "active");
  assert.deepEqual(detail?.articleIds, ["a1", "a2"]);

  assert.equal(await getSeriesForAdmin("missing"), null);
});

test("createReadingSeries validates slug/title/description and enforces duplicate handling", async () => {
  const { createReadingSeries } = await loadSeries();

  let result = await createReadingSeries({
    slug: "Bad Slug",
    title: "Title",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);

  result = await createReadingSeries({
    slug: "valid-slug",
    title: " ",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);

  result = await createReadingSeries({
    slug: "title-too-long",
    title: "x".repeat(201),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);

  result = await createReadingSeries({
    slug: "desc-too-long",
    title: "Valid title",
    description: "x".repeat(2001),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);

  result = await createReadingSeries({
    slug: "status-active",
    title: "Valid title",
    status: "active",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);

  seedSeries({ slug: "taken" });
  result = await createReadingSeries({
    slug: "taken",
    title: "Duplicate",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 409);
});

test("createReadingSeries persists draft defaults and normalized ordering", async () => {
  const { createReadingSeries } = await loadSeries();
  const result = await createReadingSeries({
    slug: "  Tech-Daily  ",
    title: "  Tech Daily ",
    description: "  Intro series  ",
    articleIds: ["a1", "a1", " a2 "],
    public: true,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.series.slug, "tech-daily");
    assert.equal(result.series.title, "Tech Daily");
    assert.equal(result.series.description, "Intro series");
    assert.equal(result.series.status, "draft");
    assert.equal(result.series.public, true);
    assert.deepEqual(result.series.articleIds, ["a1", "a2"]);
  }
});

test("updateReadingSeries handles not-found, invalid transitions, duplicate slug, and lifecycle", async () => {
  const { updateReadingSeries } = await loadSeries();

  let result = await updateReadingSeries("missing", { title: "x" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);

  const first = seedSeries({ id: "s1", slug: "first", status: "draft" });
  seedSeries({ id: "s2", slug: "second", status: "draft" });

  result = await updateReadingSeries(first.id, { slug: "second" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 409);

  result = await updateReadingSeries(first.id, { status: "active" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.series.status, "active");

  result = await updateReadingSeries(first.id, { status: "draft" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 409);

  result = await updateReadingSeries(first.id, { status: "archived" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.series.status, "archived");

  result = await updateReadingSeries(first.id, { status: "active" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 409);

  result = await updateReadingSeries(first.id, {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);
});

test("updateReadingSeries updates editable metadata fields with normalized values", async () => {
  const { updateReadingSeries } = await loadSeries();
  seedSeries({ id: "s-meta", slug: "meta", status: "draft", articleIds: ["a0"] });

  const result = await updateReadingSeries("s-meta", {
    slug: "meta-renamed",
    title: "  Renamed series ",
    description: "  Description ",
    topic: "  science ",
    targetLevelMin: " B1 ",
    targetLevelMax: " C1 ",
    articleIds: ["a2", "a1", "a1"],
    public: true,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.series.slug, "meta-renamed");
    assert.equal(result.series.title, "Renamed series");
    assert.equal(result.series.description, "Description");
    assert.equal(result.series.topic, "science");
    assert.equal(result.series.targetLevelMin, "B1");
    assert.equal(result.series.targetLevelMax, "C1");
    assert.equal(result.series.public, true);
    assert.deepEqual(result.series.articleIds, ["a2", "a1"]);
  }
});

test("reorderReadingSeriesItems requires identical membership and updates order in a transaction", async () => {
  const { reorderReadingSeriesItems } = await loadSeries();

  let result = await reorderReadingSeriesItems("missing", ["a"]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
  assert.equal(transactionCalls, 1);

  seedSeries({ id: "s-reorder", articleIds: ["a", "b", "c"], status: "active" });
  result = await reorderReadingSeriesItems("s-reorder", ["c", "b"]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);

  result = await reorderReadingSeriesItems("s-reorder", ["c", "a", "b"]);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.series.articleIds, ["c", "a", "b"]);

  result = await reorderReadingSeriesItems("s-reorder", ["c", "a", "b"]);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.series.articleIds, ["c", "a", "b"]);
});

test("deleteReadingSeries handles not-found, active-enrollment conflict, and destructive success", async () => {
  const { deleteReadingSeries } = await loadSeries();

  let result = await deleteReadingSeries("missing");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);

  seedSeries({ id: "s-delete" });
  activeEnrollmentCounts.set("s-delete", 1);
  result = await deleteReadingSeries("s-delete");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 409);

  activeEnrollmentCounts.set("s-delete", 0);
  result = await deleteReadingSeries("s-delete");
  assert.equal(result.ok, true);

  assert.equal(seriesRows.some((row) => row.id === "s-delete"), false);
});
