import assert from "node:assert/strict";
import test from "node:test";

import {
  getLocalSeedPlan,
  isSafeLocalDatabaseUrl,
  LOCAL_PG_DATABASE_URL,
  LOCAL_SEED_DATASET,
} from "@/lib/local-dev";

test("local database URL guard allows only deterministic dev targets", () => {
  assert.equal(isSafeLocalDatabaseUrl(LOCAL_PG_DATABASE_URL), true);
  assert.equal(isSafeLocalDatabaseUrl("postgres://readwise:readwise-dev-password@127.0.0.1:55432/readwise"), true);
  assert.equal(isSafeLocalDatabaseUrl("file:./dev.db"), true);

  assert.equal(isSafeLocalDatabaseUrl("postgresql://readwise:readwise-dev-password@example.com:5432/readwise"), false);
  assert.equal(isSafeLocalDatabaseUrl("postgresql://readwise:readwise-dev-password@localhost:5432/readwise"), false);
  assert.equal(isSafeLocalDatabaseUrl("file:./production.db"), false);
  assert.equal(isSafeLocalDatabaseUrl(undefined), false);
});

test("local seed dataset covers reader and admin parity workflows", () => {
  const plan = getLocalSeedPlan();
  assert.deepEqual(plan, {
    users: 3,
    sessions: 2,
    articles: 6,
    tags: 5,
    progressRows: 3,
    adminWorkflowRows: 7,
  });

  assert.equal(LOCAL_SEED_DATASET.users.some((u) => u.role === "Admin"), true);
  assert.equal(LOCAL_SEED_DATASET.users.some((u) => u.role === "Reader"), true);
  assert.equal(LOCAL_SEED_DATASET.progress.some((p) => p.completed), true);
  assert.equal(LOCAL_SEED_DATASET.sessions.length >= 2, true);

  const statuses = new Set(LOCAL_SEED_DATASET.articles.map((a) => a.status));
  assert.equal(statuses.has("PUBLISHED"), true);
  assert.equal(statuses.has("DRAFT"), true);
  assert.equal(statuses.has("FAILED"), true);
  assert.equal(statuses.has("ARCHIVED"), true);

  for (const article of LOCAL_SEED_DATASET.articles) {
    assert.equal(new URL(article.sourceUrl).hostname, "local.readwise.invalid");
  }
});
