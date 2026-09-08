import assert from "node:assert/strict";
import { test } from "node:test";

import { isSafeIntegrationDatabaseUrl } from "./db/support/db-config";

test("database integration guard accepts only isolated loopback test targets", () => {
  for (const databaseUrl of [
    "postgresql://user:pass@localhost:5432/readwise_test?schema=public",
    "postgres://user:pass@127.0.0.1:5432/readwise-ci?schema=public",
    "postgresql://user:pass@[::1]:5432/readwise-e2e",
    "file:./coverage-ci.db",
    "file:/tmp/readwise.test.db",
  ]) {
    assert.equal(isSafeIntegrationDatabaseUrl(databaseUrl), true, databaseUrl);
  }

  for (const databaseUrl of [
    "",
    "postgresql://user:pass@db.example.com:5432/readwise_test",
    "postgresql://user:pass@localhost:5432/readwise",
    "postgresql://user:pass@localhost:5432/readwise?schema=ci",
    "postgresql://user:pass@localhost:5432/readwise_test?host=database.example.com",
    "postgresql://user:pass@localhost:5432/readwise_test?dbname=production",
    "postgresql://user:pass@localhost:5432/testimony",
    "file:./dev.db",
    "file:/var/data/production.db",
    "mysql://localhost/readwise_test",
  ]) {
    assert.equal(isSafeIntegrationDatabaseUrl(databaseUrl), false, databaseUrl);
  }
});
