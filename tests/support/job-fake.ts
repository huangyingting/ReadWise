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

function nowDate(): Date {
  return new Date();
}

function makeDefaults(): JobRow {
  return {
    id: "",
    type: "ARTICLE_PROCESS",
    status: "PENDING",
    payload: {},
    attempts: 0,
    maxAttempts: 5,
    priority: 0,
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

function matchField(value: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>;
    if ("in" in c) return (c.in as unknown[]).includes(value);
    if ("notIn" in c) return !(c.notIn as unknown[]).includes(value);
    if ("lte" in c) {
      const r = cmp(value, c.lte);
      return Number.isNaN(r) ? false : r <= 0;
    }
    if ("lt" in c) {
      const r = cmp(value, c.lt);
      return Number.isNaN(r) ? false : r < 0;
    }
    if ("gte" in c) {
      const r = cmp(value, c.gte);
      return Number.isNaN(r) ? false : r >= 0;
    }
    if ("gt" in c) {
      const r = cmp(value, c.gt);
      return Number.isNaN(r) ? false : r > 0;
    }
    if ("not" in c) return value !== c.not;
    return value === cond;
  }
  return value === cond;
}

function matchWhere(row: JobRow, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === "OR") {
      if (!(cond as Record<string, unknown>[]).some((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (key === "AND") {
      if (!(cond as Record<string, unknown>[]).every((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (!matchField(row[key], cond)) return false;
  }
  return true;
}

function applyOrder(rows: JobRow[], orderBy?: Record<string, "asc" | "desc">[]): JobRow[] {
  if (!orderBy || orderBy.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const clause of orderBy) {
      const [field, dir] = Object.entries(clause)[0];
      const r = cmp(a[field], b[field]);
      if (!Number.isNaN(r) && r !== 0) return dir === "desc" ? -r : r;
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

export type JobFake = {
  prisma: {
    job: ReturnType<typeof makeJobDelegate>;
    $transaction: (fn: (tx: { job: ReturnType<typeof makeJobDelegate> }) => unknown) => unknown;
  };
  /** Seeds a job row directly into the store (bypasses enqueue) with sane defaults. */
  seed: (overrides?: Partial<JobRow>) => JobRow;
  /** The live store — inspect or mutate in tests. */
  store: Map<string, JobRow>;
};

function makeJobDelegate(store: Map<string, JobRow>, counter: { value: number }) {
  return {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (data.dedupeKey != null) {
        for (const existing of store.values()) {
          if (existing.dedupeKey === data.dedupeKey) throw uniqueViolation();
        }
      }
      const id = (data.id as string) ?? `job-${++counter.value}`;
      const row: JobRow = { ...makeDefaults(), ...data, id, createdAt: nowDate(), updatedAt: nowDate() };
      store.set(id, row);
      return clone(row);
    },
    findUnique: async ({ where }: { where: Record<string, unknown> }) => {
      if (where.id != null) return clone(store.get(where.id as string) ?? null);
      if (where.dedupeKey != null) {
        for (const row of store.values()) {
          if (row.dedupeKey === where.dedupeKey) return clone(row);
        }
      }
      return null;
    },
    findFirst: async ({
      where,
      orderBy,
    }: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, "asc" | "desc">[];
    }) => {
      const rows = applyOrder(
        [...store.values()].filter((r) => matchWhere(r, where)),
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
      where?: Record<string, unknown>;
      orderBy?: Record<string, "asc" | "desc">[];
      take?: number;
      skip?: number;
    }) => {
      let rows = applyOrder([...store.values()].filter((r) => matchWhere(r, where)), orderBy);
      if (skip) rows = rows.slice(skip);
      if (take != null) rows = rows.slice(0, take);
      return rows.map((r) => clone(r));
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = store.get(where.id);
      if (!row) throw new Error(`job ${where.id} not found`);
      Object.assign(row, data);
      row.updatedAt = (data.updatedAt as Date) ?? nowDate();
      return clone(row);
    },
    updateMany: async ({
      where,
      data,
    }: {
      where?: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const rows = [...store.values()].filter((r) => matchWhere(r, where));
      for (const row of rows) {
        Object.assign(row, data);
        row.updatedAt = (data.updatedAt as Date) ?? nowDate();
      }
      return { count: rows.length };
    },
    groupBy: async ({ by }: { by: string[] }) => {
      const counts = new Map<string, number>();
      for (const row of store.values()) {
        const key = by.map((b) => row[b]).join("|");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.entries()].map(([key, count]) => {
        const obj: Record<string, unknown> = { _count: { _all: count } };
        by.forEach((b, i) => (obj[b] = key.split("|")[i]));
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
    $transaction: async (fn: (tx: { job: typeof jobDelegate }) => unknown) =>
      fn({ job: jobDelegate }),
  };

  function seed(overrides: Partial<JobRow> = {}): JobRow {
    const id = (overrides.id as string) ?? `seed-${++counter.value}`;
    const row: JobRow = { ...makeDefaults(), ...overrides, id };
    store.set(id, row);
    return row;
  }

  return { prisma, seed, store };
}
