/**
 * Tests for frequencyTier (src/lib/frequency.ts).
 *
 * These tests run on Node's built-in test runner via the project's TS harness.
 * No external I/O — the frequency data is a static JSON file bundled at
 * import time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

test("frequencyTier — top 1K word returns top1k", async () => {
  const { frequencyTier } = await import("@/lib/frequency");
  assert.equal(frequencyTier("the"), "top1k");
  assert.equal(frequencyTier("be"), "top1k");
  assert.equal(frequencyTier("have"), "top1k");
});

test("frequencyTier — case insensitive matching", async () => {
  const { frequencyTier } = await import("@/lib/frequency");
  assert.equal(frequencyTier("THE"), "top1k");
  assert.equal(frequencyTier("Have"), "top1k");
});

test("frequencyTier — top5k word returns top5k", async () => {
  const { frequencyTier } = await import("@/lib/frequency");
  assert.equal(frequencyTier("ability"), "top5k");
  assert.equal(frequencyTier("adequate"), "top5k");
});

test("frequencyTier — academic word returns academic", async () => {
  const { frequencyTier } = await import("@/lib/frequency");
  // Academic words not in top5k
  assert.equal(frequencyTier("albeit"), "academic");
  assert.equal(frequencyTier("pedagogy"), null); // not in any tier
});

test("frequencyTier — inflected form resolves via normalizeCandidates", async () => {
  const { frequencyTier } = await import("@/lib/frequency");
  // "running" should normalize to "run" (top1k)
  const tier = frequencyTier("running");
  // "run" is in the top1k list; accept top1k or top5k (normalization may vary)
  assert.ok(tier !== null, "running should resolve to a known tier");
});

test("frequencyTier — unknown/rare word returns null", async () => {
  const { frequencyTier } = await import("@/lib/frequency");
  assert.equal(frequencyTier("quasar"), null);
  assert.equal(frequencyTier("pneumonoultramicroscopicsilicovolcanoconiosis"), null);
});

test("frequencyTier — empty/blank input returns null", async () => {
  const { frequencyTier } = await import("@/lib/frequency");
  assert.equal(frequencyTier(""), null);
  assert.equal(frequencyTier("   "), null);
});

test("TIER_LABELS covers all tiers", async () => {
  const { TIER_LABELS } = await import("@/lib/frequency");
  assert.ok(TIER_LABELS.top1k.length > 0);
  assert.ok(TIER_LABELS.top5k.length > 0);
  assert.ok(TIER_LABELS.academic.length > 0);
});

test("TIER_VARIANTS covers all tiers", async () => {
  const { TIER_VARIANTS } = await import("@/lib/frequency");
  assert.ok(TIER_VARIANTS.top1k);
  assert.ok(TIER_VARIANTS.top5k);
  assert.ok(TIER_VARIANTS.academic);
});

test("wordFrequencyBand exposes granular deterministic difficulty bands", async () => {
  const { wordFrequencyBand } = await import("@/lib/frequency-ranks");
  assert.equal(wordFrequencyBand("the"), "top1k");
  assert.notEqual(wordFrequencyBand("frequency"), "rare");
  assert.equal(wordFrequencyBand("epistemological"), "rare");
});
