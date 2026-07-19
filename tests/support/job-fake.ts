/**
 * Shared in-memory Prisma fake for job-queue tests.
 *
 * `makeJobFake()` returns a ready-to-use `{ prisma, seed, store }` triple:
 *   - `prisma`  — drop-in replacement for `@/lib/prisma` (mock this with
 *                 `mock.module("@/lib/prisma", { namedExports: { prisma } })`).
 *   - `seed`    — inserts a job row directly into `store` (bypasses enqueue).
 *   - `store`   — the live `Map<string, JobRow>` so tests can inspect state.
 *
 * Call `makeJobFake()` inside `before()` and reset `store` / `idCounter` via
 * `beforeEach(() => { store.clear(); idCounter = 0; })` (or use the returned
 * `seed` which handles ID generation automatically).
 */
import { Prisma } from "@prisma/client";

export type JobRow = Record<string, unknown> & { id: string };

type Where = Record<string, unknown>;
type SortDirection = "asc" | "desc";
type OrderBy = Record<string, SortDirection>[];
type JobDelegate = ReturnType<typeof makeJobDelegate>;
type JobTransaction = { job: JobDelegate };

const DEFAULT_JOB_POLICY = {
  type: "ARTICLE_PROCESS",
  status: "PENDING",
  payload: {},
  attempts: 0,
  maxAttempts: 5,
  priority: 0,
} as const;

function nowDate(): Date {
  return new Date();
}

function makeDefaults(): JobRow {
  return {
    id: "",
    ...DEFAULT_JOB_POLICY,
    runAfter: nowDate(),
    lockedBy: null,
    lockedAt: null,
    lastError: null,
    errorHistory: [],
    dedupeKey: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    deadLetteredAt: null,
    createdAt: nowDate(),
    updatedAt: nowDate(),
  };
}

function clone<T>(value: T): T {
  return value == null ? value : (structuredClone(value) as T);
}

function cmp(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (a == null || b == null) return NaN;
  return a < b ? -1 : a > b ? 1 : 0;
}

function matchComparison(
  value: unknown,
  c: Where,
  key: "lte" | "lt" | "gte" | "gt",
  matches: (result: number) => boolean,
): boolean | undefined {
  if (!(key in c)) return undefined;
  const result = cmp(value, c[key]);
  return Number.isNaN(result) ? false : matches(result);
}

function matchField(value: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as Where;
    if ("in" in c) return (c.in as unknown[]).includes(value);
    if ("notIn" in c) return !(c.notIn as unknown[]).includes(value);

    const rangeMatch =
      matchComparison(value, c, "lte", (result) => result <= 0) ??
      matchComparison(value, c, "lt", (result) => result < 0) ??
      matchComparison(value, c, "gte", (result) => result >= 0) ??
      matchComparison(value, c, "gt", (result) => result > 0);
    if (rangeMatch !== undefined) return rangeMatch;

    if ("not" in c) return value !== c.not;
    return value === cond;
  }
  return value === cond;
}

function matchWhere(row: JobRow, where: Where | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === "OR") {
      if (!(cond as Where[]).some((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (key === "AND") {
      if (!(cond as Where[]).every((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (!matchField(row[key], cond)) return false;
  }
  return true;
}

function applyOrder(rows: JobRow[], orderBy?: OrderBy): JobRow[] {
  if (!orderBy || orderBy.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const clause of orderBy) {
      const [field, dir] = Object.entries(clause)[0];
      const result = cmp(a[field], b[field]);
      if (!Number.isNaN(result) && result !== 0) return dir === "desc" ? -result : result;
    }
    return 0;
  });
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

function findByDedupeKey(store: Map<string, JobRow>, dedupeKey: unknown): JobRow | undefined {
  for (const row of store.values()) {
    if (row.dedupeKey === dedupeKey) return row;
  }
  return undefined;
}

function assertUniqueDedupeKey(store: Map<string, JobRow>, dedupeKey: unknown): void {
  if (dedupeKey != null && findByDedupeKey(store, dedupeKey)) {
    throw uniqueViolation();
  }
}

function touch(row: JobRow, data: Where): void {
  Object.assign(row, data);
  row.updatedAt = (data.updatedAt as Date) ?? nowDate();
}

function makeJobRow(data: Partial<JobRow>, id: string, forceFreshTimestamps = false): JobRow {
  const row: JobRow = { ...makeDefaults(), ...data, id };
  if (forceFreshTimestamps) {
    row.createdAt = nowDate();
    row.updatedAt = nowDate();
  }
  return row;
}

export type JobFake = {
  prisma: {
    job: JobDelegate;
    $transaction: (fn: (tx: JobTransaction) => unknown) => unknown;
  };
  /** Seeds a job row directly into the store (bypasses enqueue) with sane defaults. */
  seed: (overrides?: Partial<JobRow>) => JobRow;
  /** The live store — inspect or mutate in tests. */
  store: Map<string, JobRow>;
};

function makeJobDelegate(store: Map<string, JobRow>, counter: { value: number }) {
  return {
    create: async ({ data }: { data: Where }) => {
      assertUniqueDedupeKey(store, data.dedupeKey);
      const id = (data.id as string) ?? `job-${++counter.value}`;
      const row = makeJobRow(data, id, true);
      store.set(id, row);
      return clone(row);
    },
    findUnique: async ({ where }: { where: Where }) => {
      if (where.id != null) return clone(store.get(where.id as string) ?? null);
      if (where.dedupeKey != null) return clone(findByDedupeKey(store, where.dedupeKey) ?? null);
      return null;
    },
    findFirst: async ({
      where,
      orderBy,
    }: {
      where?: Where;
      orderBy?: OrderBy;
    }) => {
      const rows = applyOrder(
        [...store.values()].filter((row) => matchWhere(row, where)),
        orderBy,
      );
      return clone(rows[0] ?? null);
    },
    findMany: async ({
      where,
      orderBy,
      take,
      skip,
    }: {
      where?: Where;
      orderBy?: OrderBy;
      take?: number;
      skip?: number;
    }) => {
      let rows = applyOrder(
        [...store.values()].filter((row) => matchWhere(row, where)),
        orderBy,
      );
      if (skip) rows = rows.slice(skip);
      if (take != null) rows = rows.slice(0, take);
      return rows.map((row) => clone(row));
    },
    update: async ({ where, data }: { where: { id: string }; data: Where }) => {
      const row = store.get(where.id);
      if (!row) throw new Error(`job ${where.id} not found`);
      touch(row, data);
      return clone(row);
    },
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: Where;
      create: Where;
      update: Where;
    }) => {
      // Locate an existing row by the unique selector (id or dedupeKey).
      const existing =
        where.id != null
          ? store.get(where.id as string)
          : where.dedupeKey != null
            ? findByDedupeKey(store, where.dedupeKey)
            : undefined;
      if (existing) {
        // Empty update = no-op (reuse the winner, never reset). Matches the
        // ON CONFLICT DO UPDATE (no-op) semantics of enqueueJobInTx.
        if (Object.keys(update).length > 0) touch(existing, update);
        return clone(existing);
      }
      const id = (create.id as string) ?? `job-${++counter.value}`;
      const row = makeJobRow(create, id, true);
      store.set(id, row);
      return clone(row);
    },
    updateMany: async ({
      where,
      data,
    }: {
      where?: Where;
      data: Where;
    }) => {
      const rows = [...store.values()].filter((row) => matchWhere(row, where));
      for (const row of rows) touch(row, data);
      return { count: rows.length };
    },
    groupBy: async ({ by }: { by: string[] }) => {
      const counts = new Map<string, number>();
      for (const row of store.values()) {
        const key = by.map((field) => row[field]).join("|");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.entries()].map(([key, count]) => {
        const obj: Where = { _count: { _all: count } };
        by.forEach((field, index) => (obj[field] = key.split("|")[index]));
        return obj;
      });
    },
  };
}

/**
 * Creates a self-contained in-memory job fake.
 *
 * @example
 * ```ts
 * const { prisma, seed, store } = makeJobFake();
 * before(() => mock.module("@/lib/prisma", { namedExports: { prisma } }));
 * beforeEach(() => { store.clear(); });
 * ```
 */
export function makeJobFake(): JobFake {
  const store = new Map<string, JobRow>();
  const counter = { value: 0 };
  const jobDelegate = makeJobDelegate(store, counter);

  const prisma = {
    job: jobDelegate,
    $transaction: async (fn: (tx: JobTransaction) => unknown) => fn({ job: jobDelegate }),
  };

  function seed(overrides: Partial<JobRow> = {}): JobRow {
    const id = (overrides.id as string) ?? `seed-${++counter.value}`;
    const row = makeJobRow(overrides, id);
    store.set(id, row);
    return row;
  }

  return { prisma, seed, store };
}
