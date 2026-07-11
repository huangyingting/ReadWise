/**
 * Tests for src/lib/testing/e2e-fixtures.ts deterministic fixture exports.
 *
 * Since the module's main functions (resetE2eDatabase, createUserWithSession, etc.)
 * require a live database, we test:
 * - Exported constants and fixture shape correctness
 * - E2E_ARTICLES fixture structure and determinism
 * - The db-guard module behavior
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_ARTICLE_ID,
  ARTICLE_BODY,
  E2E_ARTICLES,
} from "@/lib/testing/e2e-fixtures";
import { assertSafeE2eDatabaseUrl } from "@/lib/testing/db-guard";

test("TEST_ARTICLE_ID is a deterministic non-empty string", () => {
  assert.equal(typeof TEST_ARTICLE_ID, "string");
  assert.ok(TEST_ARTICLE_ID.length > 0);
  assert.equal(TEST_ARTICLE_ID, "e2e-critical-reader");
});

test("ARTICLE_BODY contains non-trivial HTML for layout exercise", () => {
  assert.equal(typeof ARTICLE_BODY, "string");
  assert.ok(ARTICLE_BODY.includes("<p>"), "should contain paragraph tags");
  assert.ok(ARTICLE_BODY.length > 50, "should have meaningful length");
});

test("E2E_ARTICLES is a non-empty array of valid fixture objects", () => {
  assert.ok(Array.isArray(E2E_ARTICLES));
  assert.ok(E2E_ARTICLES.length >= 3, "at least 3 fixture articles");

  for (const article of E2E_ARTICLES) {
    assert.equal(typeof article.id, "string");
    assert.ok(article.id.length > 0);
    assert.equal(typeof article.title, "string");
    assert.ok(article.title.length > 0);
    assert.equal(typeof article.category, "string");
    assert.equal(typeof article.difficulty, "string");
    assert.equal(typeof article.difficultyScore, "number");
  }
});

test("E2E_ARTICLES have unique ids", () => {
  const ids = E2E_ARTICLES.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, "article ids must be unique");
});

test("E2E_ARTICLES include the critical smoke article", () => {
  const critical = E2E_ARTICLES.find((a) => a.id === TEST_ARTICLE_ID);
  assert.ok(critical, "critical reader article must exist in fixtures");
});

test("assertSafeE2eDatabaseUrl rejects when DATABASE_URL is not set", () => {
  assert.throws(
    () => assertSafeE2eDatabaseUrl({ databaseUrl: undefined }),
    /DATABASE_URL is not set/,
  );
});

test("assertSafeE2eDatabaseUrl rejects mismatched URLs", () => {
  assert.throws(
    () =>
      assertSafeE2eDatabaseUrl({
        databaseUrl: "file:./dev.db",
        expectedDatabaseUrl: "file:./e2e.db",
      }),
    /does not match/,
  );
});

test("assertSafeE2eDatabaseUrl rejects non-e2e database basenames", () => {
  assert.throws(
    () =>
      assertSafeE2eDatabaseUrl({
        databaseUrl: "file:./production.db",
        expectedDatabaseUrl: "file:./production.db",
      }),
    /must point to an isolated e2e/,
  );
});

test("assertSafeE2eDatabaseUrl passes for valid e2e database URL", () => {
  assert.doesNotThrow(() =>
    assertSafeE2eDatabaseUrl({
      databaseUrl: "file:./e2e.db",
      expectedDatabaseUrl: "file:./e2e.db",
    }),
  );
});

test("assertSafeE2eDatabaseUrl passes for e2e URL with suffix", () => {
  assert.doesNotThrow(() =>
    assertSafeE2eDatabaseUrl({
      databaseUrl: "file:./e2e-smoke.db",
      expectedDatabaseUrl: "file:./e2e-smoke.db",
    }),
  );
});
