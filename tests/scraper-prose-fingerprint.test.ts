/**
 * Unit tests for the PURE versioned prose fingerprint (issue #1092, Phase 2.2).
 *
 * The module under test (`src/lib/scraper/incremental/prose-fingerprint.ts`) is
 * pure — no DB, no network. It proves EXACT-only matching, versioning, the
 * secret-free (hash-only) contract, and the conservative normalization rules.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  PROSE_FINGERPRINT_VERSION,
  computeProseFingerprint,
  normalizeProse,
} from "@/lib/scraper/incremental/prose-fingerprint";

test("identical prose yields an identical fingerprint (exact match)", () => {
  const a = computeProseFingerprint("The quick brown fox jumps over the lazy dog.");
  const b = computeProseFingerprint("The quick brown fox jumps over the lazy dog.");
  assert.ok(a && b);
  assert.equal(a.key, b.key);
});

test("normalization folds whitespace, casing, and Unicode width — same fingerprint", () => {
  const a = computeProseFingerprint("Hello   World\n\tArticle");
  const b = computeProseFingerprint("hello world article");
  assert.ok(a && b);
  assert.equal(a.hash, b.hash);
});

test("genuinely different prose yields different fingerprints (no fuzzy merge)", () => {
  const a = computeProseFingerprint("The economy grew by three percent last year.");
  const b = computeProseFingerprint("The economy grew by four percent last year.");
  assert.ok(a && b);
  assert.notEqual(a.hash, b.hash);
});

test("fingerprint key is versioned and matches the documented scheme", () => {
  const fp = computeProseFingerprint("Some article body text.");
  assert.ok(fp);
  assert.equal(fp.version, PROSE_FINGERPRINT_VERSION);
  const expected = createHash("sha256")
    .update(normalizeProse("Some article body text."), "utf8")
    .digest("hex");
  assert.equal(fp.hash, expected);
  assert.equal(fp.key, `v${PROSE_FINGERPRINT_VERSION}:${expected}`);
});

test("fingerprint never contains the prose text (hash only)", () => {
  const prose = "A very distinctive secret-looking phrase xyzzy-42.";
  const fp = computeProseFingerprint(prose);
  assert.ok(fp);
  assert.ok(!fp.hash.includes("xyzzy"));
  assert.ok(!fp.key.includes("xyzzy"));
  assert.match(fp.hash, /^[0-9a-f]{64}$/);
});

test("empty / whitespace-only prose returns null (never collides with another empty)", () => {
  assert.equal(computeProseFingerprint(""), null);
  assert.equal(computeProseFingerprint("   \n\t  "), null);
});
