/**
 * Tests for command-items.ts — pure item derivation and fuzzy filtering.
 *
 * These run in Node.js without mounting any React component, satisfying the
 * acceptance check: "Command item filtering can be tested without mounting the
 * full palette."
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Import the module directly — no React/DOM dependency.
import {
  fuzzyFilter,
  getPageItems,
  ACTION_ITEMS,
} from "@/components/command/command-items";

// ---- fuzzyFilter ---------------------------------------------------------

test("fuzzyFilter - returns all items when query is empty", () => {
  const items = [
    { label: "Dashboard", keywords: "home" },
    { label: "Browse", keywords: "explore" },
  ];
  assert.deepEqual(fuzzyFilter(items, ""), items);
});

test("fuzzyFilter - matches by label prefix", () => {
  const items = [
    { label: "Dashboard", keywords: "home" },
    { label: "Browse", keywords: "explore" },
  ];
  const result = fuzzyFilter(items, "das");
  assert.equal(result.length, 1);
  assert.equal(result[0].label, "Dashboard");
});

test("fuzzyFilter - matches by keyword", () => {
  const items = [
    { label: "Dashboard", keywords: "home streak goal" },
    { label: "Browse", keywords: "discover explore" },
  ];
  const result = fuzzyFilter(items, "streak");
  assert.equal(result.length, 1);
  assert.equal(result[0].label, "Dashboard");
});

test("fuzzyFilter - returns empty array when no match", () => {
  const items = [
    { label: "Dashboard", keywords: "home" },
    { label: "Browse", keywords: "explore" },
  ];
  const result = fuzzyFilter(items, "zzz");
  assert.equal(result.length, 0);
});

test("fuzzyFilter - case insensitive", () => {
  const items = [{ label: "Settings", keywords: "profile account" }];
  assert.equal(fuzzyFilter(items, "SETT").length, 1);
  assert.equal(fuzzyFilter(items, "settings").length, 1);
});

test("fuzzyFilter - ranks contiguous match higher than scattered", () => {
  const items = [
    { label: "ab cd", keywords: "" }, // 'ac' scattered
    { label: "acd", keywords: "" },   // 'ac' contiguous
  ];
  // Both match 'ac' as subsequence; contiguous should rank higher.
  const result = fuzzyFilter(items, "ac");
  assert.equal(result.length, 2);
  // "acd" has contiguous 'ac' so should come first.
  assert.equal(result[0].label, "acd");
});

// ---- getPageItems ---------------------------------------------------------

test("getPageItems - returns pages without Admin for non-admin user", () => {
  const pages = getPageItems("Member");
  const labels = pages.map((p) => p.label);
  assert.ok(!labels.includes("Admin"), "Admin page should not appear for non-admin user");
});

test("getPageItems - includes Admin page for Admin role", () => {
  const pages = getPageItems("Admin");
  const labels = pages.map((p) => p.label);
  assert.ok(labels.includes("Admin"), "Admin page should appear for Admin role");
});

test("getPageItems - includes Settings page for all roles", () => {
  const pages = getPageItems(null);
  const labels = pages.map((p) => p.label);
  assert.ok(labels.includes("Settings"));
});

test("getPageItems - all items have required shape", () => {
  const pages = getPageItems("Admin");
  for (const p of pages) {
    assert.equal(p.kind, "page");
    assert.ok(typeof p.id === "string" && p.id.length > 0, "id must be a non-empty string");
    assert.ok(typeof p.label === "string" && p.label.length > 0);
    assert.ok(typeof p.href === "string" && p.href.startsWith("/"));
    assert.ok(typeof p.keywords === "string");
  }
});

// ---- ACTION_ITEMS ---------------------------------------------------------

test("ACTION_ITEMS - all items have required shape", () => {
  for (const a of ACTION_ITEMS) {
    assert.equal(a.kind, "action");
    assert.ok(typeof a.id === "string" && a.id.length > 0);
    assert.ok(typeof a.label === "string" && a.label.length > 0);
    assert.ok(typeof a.keywords === "string");
  }
});

test("ACTION_ITEMS - at least one item has showOnEmpty", () => {
  const onEmpty = ACTION_ITEMS.filter((a) => a.showOnEmpty);
  assert.ok(onEmpty.length > 0, "Expected at least one action with showOnEmpty");
});
