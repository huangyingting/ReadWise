import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeE2eDatabaseUrl } from "../e2e/support/db-guard";

test("allows the default isolated Playwright database", () => {
  assert.doesNotThrow(() =>
    assertSafeE2eDatabaseUrl({
      databaseUrl: "file:./e2e.db",
      expectedDatabaseUrl: "file:./e2e.db",
    }),
  );
});

test("allows an explicitly configured isolated e2e database", () => {
  assert.doesNotThrow(() =>
    assertSafeE2eDatabaseUrl({
      databaseUrl: "file:./e2e-smoke.db",
      expectedDatabaseUrl: "file:./e2e-smoke.db",
    }),
  );
});

test("rejects a non-e2e database even when configured explicitly", () => {
  assert.throws(
    () =>
      assertSafeE2eDatabaseUrl({
        databaseUrl: "file:./dev.db",
        expectedDatabaseUrl: "file:./dev.db",
      }),
    /isolated e2e\*\.db SQLite file/,
  );
});

test("rejects a database URL that does not match Playwright configuration", () => {
  assert.throws(
    () =>
      assertSafeE2eDatabaseUrl({
        databaseUrl: "file:./dev.db",
        expectedDatabaseUrl: "file:./e2e.db",
      }),
    /does not match the Playwright E2E database URL/,
  );
});
