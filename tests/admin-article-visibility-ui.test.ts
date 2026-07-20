/**
 * Unit tests for the operator PUBLIC/UNLISTED visibility control in the article
 * moderation form (issue #1159, item 2).
 *
 * `Article.visibility` (PUBLIC/PRIVATE/UNLISTED/ORG) was editable server-side via
 * `reviewArticle` but unreachable from `AdminArticleReview`. This surfaces ONLY
 * the ownerless public-library subset PUBLIC ↔ UNLISTED (mirroring how `status`
 * exposes the DRAFT/PUBLISHED subset). PRIVATE/ORG stay owner/organization-scoped
 * and are shown read-only; the server guard rejects a change to them (covered in
 * tests/content-review.test.ts).
 *
 * Source-string conventions mirror tests/admin-force-rescrape-ui.test.ts.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

const FORM = "src/components/AdminArticleReview.tsx";
const PAGE = "src/app/admin/articles/[id]/page.tsx";

test("AdminArticleReview offers ONLY the PUBLIC/UNLISTED visibility subset", () => {
  const src = readSrc(FORM);
  assert.ok(src.includes("VISIBILITY_OPTIONS"), "declares a visibility option set");
  assert.ok(src.includes('value: "PUBLIC"'));
  assert.ok(src.includes('value: "UNLISTED"'));
  // NEVER offers the owner/organization-scoped states as selectable options.
  assert.ok(!src.includes('value: "PRIVATE"'), "must not offer PRIVATE");
  assert.ok(!src.includes('value: "ORG"'), "must not offer ORG");
});

test("AdminArticleReview only enables the visibility control for PUBLIC/UNLISTED articles", () => {
  const src = readSrc(FORM);
  assert.ok(src.includes("visibilityEditable"), "gates on an editability flag");
  assert.ok(src.includes('initial.visibility === "PUBLIC"'));
  assert.ok(src.includes('initial.visibility === "UNLISTED"'));
  // Read-only affordance for owned/organization articles.
  assert.ok(/owned or organization article/i.test(src));
});

test("AdminArticleReview sends visibility in the review POST body only when editable", () => {
  const src = readSrc(FORM);
  assert.ok(src.includes("/review`"));
  assert.ok(src.includes("visibilityEditable ? { visibility } : {}"));
  assert.ok(src.includes("setVisibility"));
});

test("the article detail page seeds the form from the article's current visibility", () => {
  const src = readSrc(PAGE);
  assert.ok(src.includes("visibility: article.visibility"));
});

test("AdminArticlereview visibility control is token-driven (no raw hex, no inline font-size)", () => {
  const src = readSrc(FORM).replace(/#\d+/g, "");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "must not use a raw hex colour");
  assert.ok(!src.includes("fontSize"), "must not set an inline fontSize");
});
