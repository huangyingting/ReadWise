/**
 * Unit tests for the article tag-editing CHIP UI in the moderation form
 * (issue #1159, item 3).
 *
 * Tags were edited as a single comma-separated text `Input`. This replaces that
 * with an add/remove chip UI: each tag renders as a `Badge` with a removable
 * `IconButton` ("×"), and a text input + "Add" button (or Enter) appends a new
 * tag — trimmed, empty-ignored, and deduped case-insensitively. The BACKEND
 * CONTRACT IS UNCHANGED: the review POST still sends `tags` as a `string[]`
 * (replace-all) to the same `/review` endpoint.
 *
 * Source-string conventions mirror tests/admin-article-visibility-ui.test.ts
 * (readFileSync of the .tsx source — no jsdom).
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

test("AdminArticleReview holds tags as a string[] seeded from the comma-joined prop", () => {
  const src = readSrc(FORM);
  assert.ok(
    src.includes("useState<string[]>(() => parseTagList(initial.tags))"),
    "tag state is a string[] parsed once from the incoming comma-joined prop",
  );
  // The old single-string text input for tags is gone.
  assert.ok(
    !src.includes("value={tags} onChange"),
    "must not bind the whole tags array to a single text Input",
  );
});

test("AdminArticleReview renders each tag as a Badge chip with an accessible remove control", () => {
  const src = readSrc(FORM);
  assert.ok(src.includes("import { Badge }"), "imports the Badge primitive");
  assert.ok(src.includes("import { IconButton }"), "imports the IconButton primitive");
  assert.ok(src.includes("tags.map("), "iterates tags into chips");
  assert.ok(src.includes("<Badge"), "renders each tag via the Badge primitive");
  assert.ok(
    src.includes("aria-label={`Remove tag ${tag}`}"),
    "the remove control carries a per-tag accessible label",
  );
  assert.ok(src.includes("removeTag("), "wires the remove control to removeTag");
});

test("AdminArticleReview appends a tag via Enter or an Add button, ignoring empties", () => {
  const src = readSrc(FORM);
  assert.ok(src.includes("onTagInputKeyDown"), "handles keydown on the tag input");
  assert.ok(src.includes('event.key === "Enter"'), "Enter adds a chip");
  assert.ok(src.includes("event.preventDefault()"), "Enter-to-add does not submit the form");
  assert.ok(src.includes("onClick={() => addTag(tagInput)}"), "an Add button appends the input");
  assert.ok(src.includes("disabled={!tagInput.trim()}"), "the Add button ignores empty/whitespace");
});

test("addTagTo trims, ignores empties, and dedupes case-insensitively", () => {
  const src = readSrc(FORM);
  assert.ok(src.includes("function addTagTo("), "declares the pure add helper");
  assert.ok(src.includes("value.trim()"), "trims the candidate tag");
  assert.ok(src.includes("if (next.length === 0) return tags"), "ignores empty candidates");
  assert.ok(
    src.includes("tag.toLowerCase() === next.toLowerCase()"),
    "dedupes case-insensitively before appending",
  );
});

test("AdminArticleReview still POSTs tags as a string[] to the same /review endpoint (contract unchanged)", () => {
  const src = readSrc(FORM);
  assert.ok(src.includes("/api/admin/articles/${articleId}/review`"), "same review endpoint");
  // The array state is sent directly — no comma re-parse at submit.
  assert.ok(src.includes("tags,"), "sends the tags array in the POST body");
  assert.ok(!src.includes("tags: parseTagList(tags)"), "no longer parses a comma string at submit");
});

test("AdminArticleReview tag chip UI is token-driven (no raw hex, no inline font-size/style)", () => {
  const src = readSrc(FORM).replace(/#\d+/g, "");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "must not use a raw hex colour");
  assert.ok(!src.includes("fontSize"), "must not set an inline fontSize");
});
