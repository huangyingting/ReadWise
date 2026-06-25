/**
 * Prisma mock builder helpers (REF-033, REF-086).
 *
 * Provides small factory functions for the Prisma delegate shapes that recur
 * across many route tests.  Intentionally lightweight: each helper covers only
 * the methods that appear repeatedly.  Tests that need unusual shapes should
 * define them inline so the important seams remain explicit.
 *
 * Usage:
 *   let articleExists = true;
 *   before(() => {
 *     mock.module("@/lib/prisma", {
 *       namedExports: { prisma: makeArticlePrisma(() => articleExists) },
 *     });
 *   });
 */

// ---------------------------------------------------------------------------
// Article delegate
// ---------------------------------------------------------------------------

type ArticleStub = { id: string } & Record<string, unknown>;

/**
 * Build a minimal `prisma` mock whose `article` delegate returns a stub or
 * null based on a getter function.
 *
 * Both `findUnique` and `findFirst` delegate to the same getter so either
 * lookup pattern works.
 *
 * @param getExists  Returns `true` when a fake article should be returned.
 * @param stub       The article shape to return (defaults to `{ id: "a1" }`).
 */
export function makeArticlePrisma(
  getExists: () => boolean,
  stub: ArticleStub = { id: "a1" },
): { article: Record<string, unknown> } {  return {
    article: {
      findUnique: async () => (getExists() ? stub : null),
      findFirst: async () => (getExists() ? stub : null),
    },
  };
}

// ---------------------------------------------------------------------------
// Generic delegate builder
// ---------------------------------------------------------------------------

/**
 * Compose multiple delegate mocks into a single `prisma`-shaped object for
 * `mock.module("@/lib/prisma", { namedExports: { prisma: makePrisma({...}) } })`.
 *
 * Each key is a Prisma model name; each value is a plain object of method stubs.
 *
 * @example
 *   mock.module("@/lib/prisma", {
 *     namedExports: {
 *       prisma: makePrisma({
 *         ...makeArticlePrisma(() => articleExists),
 *         pushSubscription: { findUnique: async () => existingSub, ... },
 *       }),
 *     },
 *   });
 */
export function makePrisma(
  delegates: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  return delegates;
}

// ---------------------------------------------------------------------------
// Transaction DB stub (REF-086)
// ---------------------------------------------------------------------------

/**
 * Build a `{ $transaction }` stub for services that inject a `db` dep (e.g.,
 * `UrlImportDeps.db`, `TextImportDeps.db`).
 *
 * The callback receives the given `delegates` map as its `tx` argument, so the
 * test controls every model method called inside the transaction without needing
 * a `mock.module("@/lib/prisma", …)` replacement.
 *
 * @example
 *   const db = makeTransactionDb({
 *     article: {
 *       create: async () => ({ id: "new-id" }),
 *       update: async () => {},
 *     },
 *   });
 *   await importArticleFromUrl({ …, deps: { db, … } });
 */
export function makeTransactionDb(
  delegates: Record<string, Record<string, unknown>>,
): { $transaction<R>(fn: (tx: Record<string, unknown>) => Promise<R>): Promise<R> } {
  return {
    $transaction<R>(fn: (tx: Record<string, unknown>) => Promise<R>): Promise<R> {
      return fn(delegates);
    },
  };
}
