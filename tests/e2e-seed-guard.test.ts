import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeE2eDatabaseUrl } from "@/lib/testing/db-guard";

function expectAllowedDatabase(databaseUrl: string, expectedDatabaseUrl = databaseUrl): void {
  assert.doesNotThrow(() =>
    assertSafeE2eDatabaseUrl({
      databaseUrl,
      expectedDatabaseUrl,
    }),
  );
}

function expectRejectedDatabase(
  databaseUrl: string,
  expectedDatabaseUrl: string,
  message: RegExp,
): void {
  assert.throws(
    () =>
      assertSafeE2eDatabaseUrl({
        databaseUrl,
        expectedDatabaseUrl,
      }),
    message,
  );
}

test("allows the default isolated Playwright database", () => {
  expectAllowedDatabase("file:./e2e.db");
});

test("allows an explicitly configured isolated e2e database", () => {
  expectAllowedDatabase("file:./e2e-smoke.db");
});

test("rejects a non-e2e database even when configured explicitly", () => {
  expectRejectedDatabase(
    "file:./dev.db",
    "file:./dev.db",
    /isolated e2e\*\.db SQLite file/,
  );
});

test("rejects a database URL that does not match Playwright configuration", () => {
  expectRejectedDatabase(
    "file:./dev.db",
    "file:./e2e.db",
    /does not match the Playwright E2E database URL/,
  );
});
