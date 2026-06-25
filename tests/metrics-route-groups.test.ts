/**
 * Focused tests for routeGroupFromPath covering dynamic segment detection,
 * cardinality caps, and non-API path handling.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { routeGroupFromPath } from "@/lib/metrics/route-groups";

// ─── non-API paths ──────────────────────────────────────────────────────────

test("non-API paths become /other", () => {
  assert.equal(routeGroupFromPath("/dashboard/abc"), "/other");
  assert.equal(routeGroupFromPath("/"), "/other");
  assert.equal(routeGroupFromPath(""), "/other");
  assert.equal(routeGroupFromPath("/admin/articles"), "/other");
});

// ─── query string stripping ─────────────────────────────────────────────────

test("query strings are stripped before grouping", () => {
  assert.equal(routeGroupFromPath("/api/health?foo=bar"), "/api/health");
});

// ─── dynamic segment replacement ─────────────────────────────────────────

test("UUID segments are replaced with [id]", () => {
  assert.equal(
    routeGroupFromPath("/api/admin/articles/550e8400-e29b-41d4-a716-446655440000/rebuild"),
    "/api/admin/articles/[id]/rebuild",
  );
});

test("numeric segments are replaced with [id]", () => {
  assert.equal(routeGroupFromPath("/api/items/42"), "/api/items/[id]");
});

test("long alphanumeric Cuid-style segments are replaced with [id]", () => {
  assert.equal(
    routeGroupFromPath("/api/reader/cma1234567890abcdef/progress"),
    "/api/reader/[id]/progress",
  );
});

test("short segments after reader/highlights/lists/items are replaced with [id]", () => {
  assert.equal(routeGroupFromPath("/api/highlights/short/note"), "/api/highlights/[id]/note");
  assert.equal(routeGroupFromPath("/api/lists/mylist/items/a1"), "/api/lists/[id]/items/[id]");
});

test("admin sub-resource ids are replaced with [id]", () => {
  assert.equal(
    routeGroupFromPath("/api/admin/articles/some-article-id-12345/tags"),
    "/api/admin/articles/[id]/tags",
  );
});

// ─── known static segments kept intact ─────────────────────────────────────

test("ingest segment is kept as-is", () => {
  assert.equal(routeGroupFromPath("/api/admin/articles/ingest"), "/api/admin/articles/ingest");
});

test("short static segments are kept as-is", () => {
  assert.equal(routeGroupFromPath("/api/health"), "/api/health");
  assert.equal(routeGroupFromPath("/api/auth/signin"), "/api/auth/signin");
});

// ─── cardinality cap ────────────────────────────────────────────────────────

test("paths longer than 7 segments are capped with [...]", () => {
  const long = "/api/a/b/c/d/e/f/g/h";
  const result = routeGroupFromPath(long);
  assert.match(result, /\[\.\.\.]/);
  // Should be 8 segments: api + 6 + [...]
  const parts = result.split("/").filter(Boolean);
  assert.equal(parts.length, 8);
});
