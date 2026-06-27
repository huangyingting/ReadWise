/**
 * PWA constants drift-detection tests — REF-056.
 *
 * Parses `public/sw.js` and `public/offline-reader.html` and asserts that
 * every inline constant matches the authoritative TypeScript value exported
 * from `@/lib/pwa`.  These tests fail immediately when any constant drifts
 * so developers cannot accidentally ship a broken offline experience by editing
 * one side without updating the other.
 *
 * Run with: npm test -- --test-name-pattern pwa
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SW_CACHE_VERSION,
  SW_CACHE_NAME,
  SYNC_TAG,
  FLUSH_MESSAGE,
  PURGE_CACHES_MESSAGE,
  DB_NAME,
  DB_VERSION,
  STORE_ARTICLES,
  OFFLINE_ARTICLE_EXPIRY_MS,
} from "@/lib/pwa";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const PUBLIC = join(ROOT, "public");

const sw = readFileSync(join(PUBLIC, "sw.js"), "utf8");
const offlineReader = readFileSync(join(PUBLIC, "offline-reader.html"), "utf8");

// ---------------------------------------------------------------------------
// service worker — cache version constants
// ---------------------------------------------------------------------------

test("sw.js CACHE_VERSION matches SW_CACHE_VERSION", () => {
  const match = sw.match(/const CACHE_VERSION\s*=\s*"([^"]+)"/);
  assert.ok(match, "CACHE_VERSION constant not found in sw.js");
  assert.equal(
    match![1],
    SW_CACHE_VERSION,
    `sw.js CACHE_VERSION="${match![1]}" does not match SW_CACHE_VERSION="${SW_CACHE_VERSION}" — bump both together`,
  );
});

test("sw.js CACHE_NAME matches SW_CACHE_NAME", () => {
  // sw.js derives CACHE_NAME as CACHE_PREFIX + CACHE_VERSION; assert the
  // resulting composed value is what TypeScript computes.
  const prefixMatch = sw.match(/const CACHE_PREFIX\s*=\s*"([^"]+)"/);
  const versionMatch = sw.match(/const CACHE_VERSION\s*=\s*"([^"]+)"/);
  assert.ok(prefixMatch, "CACHE_PREFIX not found in sw.js");
  assert.ok(versionMatch, "CACHE_VERSION not found in sw.js");
  const composed = prefixMatch![1] + versionMatch![1];
  assert.equal(
    composed,
    SW_CACHE_NAME,
    `sw.js CACHE_NAME="${composed}" does not match SW_CACHE_NAME="${SW_CACHE_NAME}"`,
  );
});

// ---------------------------------------------------------------------------
// service worker — sync/message constants
// ---------------------------------------------------------------------------

test("sw.js SYNC_TAG matches SYNC_TAG", () => {
  const match = sw.match(/const SYNC_TAG\s*=\s*"([^"]+)"/);
  assert.ok(match, "SYNC_TAG constant not found in sw.js");
  assert.equal(
    match![1],
    SYNC_TAG,
    `sw.js SYNC_TAG="${match![1]}" does not match TypeScript SYNC_TAG="${SYNC_TAG}"`,
  );
});

test("sw.js FLUSH_MESSAGE matches FLUSH_MESSAGE", () => {
  const match = sw.match(/const FLUSH_MESSAGE\s*=\s*"([^"]+)"/);
  assert.ok(match, "FLUSH_MESSAGE constant not found in sw.js");
  assert.equal(
    match![1],
    FLUSH_MESSAGE,
    `sw.js FLUSH_MESSAGE="${match![1]}" does not match TypeScript FLUSH_MESSAGE="${FLUSH_MESSAGE}"`,
  );
});

test("sw.js purge-caches message type matches PURGE_CACHES_MESSAGE", () => {
  assert.ok(
    sw.includes(`"${PURGE_CACHES_MESSAGE}"`),
    `sw.js must reference purge-caches message type "${PURGE_CACHES_MESSAGE}"`,
  );
});

// ---------------------------------------------------------------------------
// offline-reader.html — IndexedDB constants
// ---------------------------------------------------------------------------

test("offline-reader.html DB_NAME matches DB_NAME", () => {
  const match = offlineReader.match(/var DB_NAME\s*=\s*"([^"]+)"/);
  assert.ok(match, "DB_NAME variable not found in offline-reader.html");
  assert.equal(
    match![1],
    DB_NAME,
    `offline-reader.html DB_NAME="${match![1]}" does not match TypeScript DB_NAME="${DB_NAME}"`,
  );
});

test("offline-reader.html opens IndexedDB with DB_VERSION", () => {
  // Match indexedDB.open(DB_NAME, <version>) — version must equal DB_VERSION.
  const match = offlineReader.match(/indexedDB\.open\s*\(\s*\w+\s*,\s*(\d+)\s*\)/);
  assert.ok(match, "indexedDB.open() call not found in offline-reader.html");
  const version = parseInt(match![1], 10);
  assert.equal(
    version,
    DB_VERSION,
    `offline-reader.html opens IndexedDB with version ${version} but TypeScript DB_VERSION=${DB_VERSION} — update offline-reader.html`,
  );
});

test("offline-reader.html STORE_NAME matches STORE_ARTICLES", () => {
  const match = offlineReader.match(/var STORE_NAME\s*=\s*"([^"]+)"/);
  assert.ok(match, "STORE_NAME variable not found in offline-reader.html");
  assert.equal(
    match![1],
    STORE_ARTICLES,
    `offline-reader.html STORE_NAME="${match![1]}" does not match TypeScript STORE_ARTICLES="${STORE_ARTICLES}"`,
  );
});

test("offline-reader.html EXPIRY_MS matches OFFLINE_ARTICLE_EXPIRY_MS", () => {
  // Match the numeric literal assigned to EXPIRY_MS.  The inline form is
  // `var EXPIRY_MS = 30 * 24 * 60 * 60 * 1000` which the JS engine evaluates
  // to 2592000000; we compare the computed constant instead of the expression.
  const match = offlineReader.match(
    /var EXPIRY_MS\s*=\s*([\d\s*]+);/,
  );
  assert.ok(match, "EXPIRY_MS variable not found in offline-reader.html");
  // Evaluate the raw expression safely (only digits, spaces, and *).
  const expr = match![1].replace(/\s+/g, "");
  assert.match(expr, /^[\d*]+$/, "EXPIRY_MS expression contains unexpected characters");
  const computed = Function(`"use strict"; return (${expr});`)() as number;
  assert.equal(
    computed,
    OFFLINE_ARTICLE_EXPIRY_MS,
    `offline-reader.html EXPIRY_MS=${computed} does not match TypeScript OFFLINE_ARTICLE_EXPIRY_MS=${OFFLINE_ARTICLE_EXPIRY_MS}`,
  );
});
