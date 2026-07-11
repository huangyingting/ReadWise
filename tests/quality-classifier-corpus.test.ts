/**
 * Tests for the quality classifier corpus data modules:
 * - src/lib/scraper/quality-classifier-seed-corpus.ts
 * - src/lib/scraper/quality-classifier-corpus.ts
 *
 * Validates:
 * - Seed arrays are non-empty readonly string arrays
 * - No array contains empty strings or whitespace-only entries
 * - Combined corpus includes all seed samples
 * - No duplicate entries within each category
 * - Privacy: no entries exceed reasonable length (no full article bodies)
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEED_ARTICLE_SAMPLES,
  SEED_AD_SAMPLES,
} from "@/lib/scraper/quality-classifier-seed-corpus";
import {
  ARTICLE_SAMPLES,
  AD_SAMPLES,
} from "@/lib/scraper/quality-classifier-corpus";

const MAX_SAMPLE_LENGTH = 500; // corpus should contain only short excerpts

test("seed article samples are non-empty and contain valid strings", () => {
  assert.ok(SEED_ARTICLE_SAMPLES.length > 0, "should have seed articles");
  for (const sample of SEED_ARTICLE_SAMPLES) {
    assert.equal(typeof sample, "string");
    assert.ok(sample.trim().length > 0, "no empty/whitespace-only entries");
  }
});

test("seed ad samples are non-empty and contain valid strings", () => {
  assert.ok(SEED_AD_SAMPLES.length > 0, "should have seed ads");
  for (const sample of SEED_AD_SAMPLES) {
    assert.equal(typeof sample, "string");
    assert.ok(sample.trim().length > 0, "no empty/whitespace-only entries");
  }
});

test("combined corpus includes all seed samples", () => {
  for (const seed of SEED_ARTICLE_SAMPLES) {
    assert.ok(ARTICLE_SAMPLES.includes(seed), `missing seed article: ${seed.slice(0, 40)}…`);
  }
  for (const seed of SEED_AD_SAMPLES) {
    assert.ok(AD_SAMPLES.includes(seed), `missing seed ad: ${seed.slice(0, 40)}…`);
  }
});

test("combined corpus has at least as many entries as seeds", () => {
  assert.ok(ARTICLE_SAMPLES.length >= SEED_ARTICLE_SAMPLES.length);
  assert.ok(AD_SAMPLES.length >= SEED_AD_SAMPLES.length);
});

test("no duplicate entries in article samples", () => {
  const unique = new Set(ARTICLE_SAMPLES);
  assert.equal(unique.size, ARTICLE_SAMPLES.length, "article samples should have no duplicates");
});

test("no duplicate entries in ad samples", () => {
  const unique = new Set(AD_SAMPLES);
  assert.equal(unique.size, AD_SAMPLES.length, "ad samples should have no duplicates");
});

test("privacy: no samples exceed max length (no full article bodies)", () => {
  for (const sample of ARTICLE_SAMPLES) {
    assert.ok(
      sample.length <= MAX_SAMPLE_LENGTH,
      `article sample too long (${sample.length} chars): ${sample.slice(0, 50)}…`,
    );
  }
  for (const sample of AD_SAMPLES) {
    assert.ok(
      sample.length <= MAX_SAMPLE_LENGTH,
      `ad sample too long (${sample.length} chars): ${sample.slice(0, 50)}…`,
    );
  }
});
