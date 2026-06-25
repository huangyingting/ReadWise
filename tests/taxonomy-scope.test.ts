/**
 * Unit tests for src/lib/taxonomy/scope.ts
 *
 * These are pure-function tests; no database, no AI, no mocks required.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ArticleVisibility, TagScope } from "@prisma/client";
import {
  PUBLIC_NAMESPACE,
  slugifyTag,
  namespaceFor,
  tagScopeForArticle,
} from "@/lib/taxonomy/scope";

// ── slugifyTag ────────────────────────────────────────────────────────────────

test("slugifyTag: converts to lowercase hyphenated slug", () => {
  assert.equal(slugifyTag("Climate Change"), "climate-change");
});

test("slugifyTag: strips diacritics", () => {
  assert.equal(slugifyTag("Café"), "cafe");
});

test("slugifyTag: replaces & with 'and'", () => {
  assert.equal(slugifyTag("Café & Crème"), "cafe-and-creme");
});

test("slugifyTag: collapses multiple spaces and trims hyphens", () => {
  assert.equal(slugifyTag("  Multiple   Spaces  "), "multiple-spaces");
});

test("slugifyTag: strips leading/trailing punctuation", () => {
  assert.equal(slugifyTag("--hello--"), "hello");
});

test("slugifyTag: handles purely numeric names", () => {
  assert.equal(slugifyTag("2024"), "2024");
});

// ── namespaceFor ──────────────────────────────────────────────────────────────

test("namespaceFor: PUBLIC scope returns the public namespace constant", () => {
  assert.equal(namespaceFor(TagScope.PUBLIC), PUBLIC_NAMESPACE);
  assert.equal(PUBLIC_NAMESPACE, "public");
});

test("namespaceFor: PRIVATE scope returns user-prefixed namespace", () => {
  assert.equal(namespaceFor(TagScope.PRIVATE, "user-42"), "user:user-42");
});

test("namespaceFor: PRIVATE scope with null ownerId uses 'unknown'", () => {
  assert.equal(namespaceFor(TagScope.PRIVATE, null), "user:unknown");
});

test("namespaceFor: ORG scope returns org-prefixed namespace", () => {
  assert.equal(namespaceFor(TagScope.ORG, null, "org-99"), "org:org-99");
});

test("namespaceFor: ORG scope with null orgId uses 'unknown'", () => {
  assert.equal(namespaceFor(TagScope.ORG, null, null), "org:unknown");
});

// ── tagScopeForArticle ────────────────────────────────────────────────────────

test("tagScopeForArticle: PUBLIC article maps to PUBLIC scope with public namespace", () => {
  const info = tagScopeForArticle({
    visibility: ArticleVisibility.PUBLIC,
    ownerId: "u1",
  });
  assert.equal(info.scope, TagScope.PUBLIC);
  assert.equal(info.namespace, PUBLIC_NAMESPACE);
  assert.equal(info.ownerId, null);
});

test("tagScopeForArticle: PRIVATE article maps to PRIVATE scope with owner namespace", () => {
  const info = tagScopeForArticle({
    visibility: ArticleVisibility.PRIVATE,
    ownerId: "user-7",
  });
  assert.equal(info.scope, TagScope.PRIVATE);
  assert.equal(info.namespace, "user:user-7");
  assert.equal(info.ownerId, "user-7");
});

test("tagScopeForArticle: PRIVATE article with null ownerId uses 'unknown' namespace", () => {
  const info = tagScopeForArticle({
    visibility: ArticleVisibility.PRIVATE,
    ownerId: null,
  });
  assert.equal(info.scope, TagScope.PRIVATE);
  assert.equal(info.namespace, "user:unknown");
  assert.equal(info.ownerId, null);
});

test("tagScopeForArticle: public and private scopes are distinct (no cross-namespace leakage)", () => {
  const pub = tagScopeForArticle({ visibility: ArticleVisibility.PUBLIC, ownerId: "u1" });
  const priv = tagScopeForArticle({ visibility: ArticleVisibility.PRIVATE, ownerId: "u1" });
  assert.notEqual(pub.scope, priv.scope);
  assert.notEqual(pub.namespace, priv.namespace);
});
