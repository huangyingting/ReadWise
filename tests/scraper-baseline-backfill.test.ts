/**
 * Pure unit tests for the discovery baseline seed classification (#1083).
 *
 * These cover the DB-free grouping/classification logic in
 * `src/lib/scraper/incremental/baseline-backfill.ts`: identity-version mapping,
 * grouping by provisional identity, unique-vs-conflict splitting, and the
 * controlled skip reasons. They import only the pure #1082 identity module, so
 * no network fetch, scraper fetch, or database access is involved.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyBaselineArticles,
  identityVersionToInt,
  type BaselineArticleInput,
} from "@/lib/scraper/incremental/baseline-backfill";
import { deriveProvisionalIdentity } from "@/lib/scraper/url-identity";

function article(id: string, sourceUrl: string | null): BaselineArticleInput {
  return { id, sourceUrl, publishedAt: null, createdAt: new Date("2024-01-01T00:00:00Z") };
}

test("identityVersionToInt maps the v1 string tag to numeric 1", () => {
  assert.equal(identityVersionToInt("v1"), 1);
  assert.equal(identityVersionToInt("V1"), 1);
  assert.equal(identityVersionToInt("v2"), 2);
});

test("identityVersionToInt rejects a malformed version tag", () => {
  assert.throws(() => identityVersionToInt("vX"), /Unrecognized URL identity version/);
  assert.throws(() => identityVersionToInt("v0"), /Unrecognized URL identity version/);
});

test("each distinct provider identity becomes a unique group", () => {
  const articles = [
    article("a1", "https://undark.org/2024/01/02/alpha-story/"),
    article("a2", "https://undark.org/2024/01/02/beta-story/"),
  ];

  const { unique, conflicts, skipped } = classifyBaselineArticles(articles);

  assert.equal(conflicts.length, 0);
  assert.equal(skipped.length, 0);
  assert.equal(unique.length, 2);
  for (const group of unique) {
    assert.equal(group.articleIds.length, 1);
    assert.equal(group.providerKey, "undark");
    assert.equal(group.identityVersion, 1);
    assert.match(group.provisionalKey, /^v1:[0-9a-f]{64}$/);
  }
});

test("two URLs normalizing to one identity form a single conflict group", () => {
  // A tracking param is stripped by the shared normalizer, so both URLs share
  // one provisional identity.
  const articles = [
    article("a1", "https://undark.org/2024/01/02/gamma-story/"),
    article("a2", "https://undark.org/2024/01/02/gamma-story/?utm_source=newsletter"),
  ];

  const { unique, conflicts } = classifyBaselineArticles(articles);

  assert.equal(unique.length, 0);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].articleIds, ["a1", "a2"]);
  const expected = deriveProvisionalIdentity("https://undark.org/2024/01/02/gamma-story/");
  assert.equal(conflicts[0].provisionalKey, expected.key);
});

test("conflict group members preserve input order deterministically", () => {
  const articles = [
    article("first", "https://undark.org/2024/01/02/delta/?utm_medium=x"),
    article("second", "https://undark.org/2024/01/02/delta/"),
    article("third", "https://undark.org/2024/01/02/delta/?fbclid=y"),
  ];

  const { conflicts } = classifyBaselineArticles(articles);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].articleIds, ["first", "second", "third"]);
});

test("a missing sourceUrl is skipped with a controlled reason", () => {
  const { skipped, unique } = classifyBaselineArticles([article("a1", null)]);
  assert.equal(unique.length, 0);
  assert.deepEqual(skipped, [{ articleId: "a1", reason: "missing-source-url" }]);
});

test("an unparseable URL is skipped as invalid-url without echoing the URL", () => {
  const { skipped } = classifyBaselineArticles([article("a1", "not a url")]);
  assert.deepEqual(skipped, [{ articleId: "a1", reason: "invalid-url" }]);
});

test("a non-http(s) scheme is skipped as unsupported-scheme", () => {
  const { skipped } = classifyBaselineArticles([article("a1", "ftp://undark.org/x")]);
  assert.deepEqual(skipped, [{ articleId: "a1", reason: "unsupported-scheme" }]);
});

test("a URL with no registered provider is skipped, never given a fabricated provider", () => {
  const { skipped, unique, conflicts } = classifyBaselineArticles([
    article("a1", "https://no-such-provider.example/story"),
  ]);
  assert.equal(unique.length, 0);
  assert.equal(conflicts.length, 0);
  assert.deepEqual(skipped, [{ articleId: "a1", reason: "no-registered-provider" }]);
});

test("mixed input classifies unique, conflict, and skipped independently", () => {
  const articles = [
    article("solo", "https://undark.org/2024/01/02/solo-story/"),
    article("dupe-a", "https://undark.org/2024/01/02/dupe/"),
    article("dupe-b", "https://undark.org/2024/01/02/dupe/?utm_source=z"),
    article("nourl", null),
    article("noprovider", "https://unknown.example/thing"),
  ];

  const { unique, conflicts, skipped } = classifyBaselineArticles(articles);

  assert.deepEqual(
    unique.map((g) => g.articleIds),
    [["solo"]],
  );
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].articleIds, ["dupe-a", "dupe-b"]);
  assert.deepEqual(
    skipped.sort((a, b) => a.articleId.localeCompare(b.articleId)),
    [
      { articleId: "noprovider", reason: "no-registered-provider" },
      { articleId: "nourl", reason: "missing-source-url" },
    ],
  );
});
