/**
 * Shell navigation subsystem tests (REF-054).
 *
 * Covers the pure-function layer of the nav model:
 *  - Active path matching (isActivePath)
 *  - Admin visibility / role gating in the nav model
 *  - Reader-route effective collapsed derivation (getEffectiveCollapsed)
 *  - localStorage parsing / responsive default (parseSidebarStored, getResponsiveDefault)
 *  - Protected-route list generation (getNavProtectedPrefixes)
 *  - NAV_ITEMS structural invariants (mobileTab, group, protected fields)
 *
 * No React, no DOM, no database — pure logic only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isActivePath,
  getNavProtectedPrefixes,
  parseSidebarStored,
  getResponsiveDefault,
  getEffectiveCollapsed,
  NAV_ITEMS,
  PRIMARY_NAV,
  PRIMARY_TABS,
  SECONDARY_NAV,
  ADMIN_NAV_ITEMS,
  READER_ROUTE_PREFIX,
} from "@/components/shell/nav-items";

// ---------------------------------------------------------------------------
// isActivePath — active link matching
// ---------------------------------------------------------------------------

test("isActivePath - exact match returns true", () => {
  assert.equal(isActivePath("/dashboard", "/dashboard"), true);
  assert.equal(isActivePath("/study", "/study"), true);
});

test("isActivePath - nested path under href returns true", () => {
  assert.equal(isActivePath("/study/session/1", "/study"), true);
  assert.equal(isActivePath("/admin/users", "/admin"), true);
});

test("isActivePath - sibling path does not match", () => {
  assert.equal(isActivePath("/studygroup", "/study"), false);
  assert.equal(isActivePath("/dashboard2", "/dashboard"), false);
});

test("isActivePath - reader route does not match Browse (/browse)", () => {
  assert.equal(isActivePath("/reader/abc123", "/browse"), false);
});

test("isActivePath - unrelated path returns false", () => {
  assert.equal(isActivePath("/notes", "/browse"), false);
  assert.equal(isActivePath("/", "/dashboard"), false);
});

test("isActivePath - empty pathname returns false for non-root href", () => {
  assert.equal(isActivePath("", "/dashboard"), false);
});

// ---------------------------------------------------------------------------
// Admin visibility — role-gated nav items
// ---------------------------------------------------------------------------

test("ADMIN_NAV_ITEMS has exactly one item (admin panel)", () => {
  assert.equal(ADMIN_NAV_ITEMS.length, 1);
});

test("admin nav item has correct href and requiresRole", () => {
  const [admin] = ADMIN_NAV_ITEMS;
  assert.equal(admin.href, "/admin");
  assert.equal(admin.requiresRole, "Admin");
});

test("admin nav item has group 'utility' and mobileTab false", () => {
  const [admin] = ADMIN_NAV_ITEMS;
  assert.equal(admin.group, "utility");
  assert.equal(admin.mobileTab, false);
});

test("admin nav item is not in PRIMARY_NAV (utility group excluded)", () => {
  const inPrimary = PRIMARY_NAV.some((item) => item.href === "/admin");
  assert.equal(inPrimary, false);
});

test("no non-admin item has requiresRole set", () => {
  const gated = NAV_ITEMS.filter(
    (item) => item.requiresRole && item.requiresRole !== "Admin",
  );
  assert.equal(gated.length, 0);
});

// ---------------------------------------------------------------------------
// Reader route — getEffectiveCollapsed
// ---------------------------------------------------------------------------

test("reader route defaults to collapsed (no override)", () => {
  assert.equal(getEffectiveCollapsed(false, null, true), true);
  assert.equal(getEffectiveCollapsed(true, null, true), true);
});

test("reader route override = true keeps sidebar collapsed", () => {
  assert.equal(getEffectiveCollapsed(false, true, true), true);
});

test("reader route override = false expands sidebar (transient)", () => {
  assert.equal(getEffectiveCollapsed(false, false, true), false);
});

test("non-reader route uses storedCollapsed, ignores override", () => {
  assert.equal(getEffectiveCollapsed(false, true, false), false);
  assert.equal(getEffectiveCollapsed(true, false, false), true);
  assert.equal(getEffectiveCollapsed(false, null, false), false);
});

// ---------------------------------------------------------------------------
// localStorage parsing — parseSidebarStored
// ---------------------------------------------------------------------------

test("parseSidebarStored - 'true' returns true", () => {
  assert.equal(parseSidebarStored("true"), true);
});

test("parseSidebarStored - 'false' returns false", () => {
  assert.equal(parseSidebarStored("false"), false);
});

test("parseSidebarStored - null (unset) returns null", () => {
  assert.equal(parseSidebarStored(null), null);
});

test("parseSidebarStored - invalid value returns null", () => {
  assert.equal(parseSidebarStored("yes"), null);
  assert.equal(parseSidebarStored(""), null);
  assert.equal(parseSidebarStored("1"), null);
});

// ---------------------------------------------------------------------------
// Responsive default — getResponsiveDefault
// ---------------------------------------------------------------------------

test("getResponsiveDefault - lg viewport (≥1024px) returns false (expanded)", () => {
  const matchMedia = (q: string) => q === "(min-width: 1024px)";
  assert.equal(getResponsiveDefault(matchMedia), false);
});

test("getResponsiveDefault - md viewport (<1024px) returns true (collapsed)", () => {
  const matchMedia = (_q: string) => false; // no query matches
  assert.equal(getResponsiveDefault(matchMedia), true);
});

// ---------------------------------------------------------------------------
// Protected-route list — getNavProtectedPrefixes
// ---------------------------------------------------------------------------

test("getNavProtectedPrefixes includes all expected protected hrefs", () => {
  const prefixes = getNavProtectedPrefixes();
  const expected = [
    "/dashboard",
    "/browse",
    "/study",
    "/progress",
    "/import",
    "/lists",
    "/notes",
    "/offline",
    "/tags",
    "/assignments",
    "/teacher",
    "/admin",
  ];
  for (const prefix of expected) {
    assert.ok(
      prefixes.includes(prefix),
      `getNavProtectedPrefixes must include "${prefix}"`,
    );
  }
});

test("getNavProtectedPrefixes - every nav item with protected:true is included", () => {
  const prefixes = getNavProtectedPrefixes();
  const protectedItems = NAV_ITEMS.filter((item) => item.protected);
  for (const item of protectedItems) {
    assert.ok(
      prefixes.includes(item.href),
      `Protected item "${item.href}" must appear in getNavProtectedPrefixes()`,
    );
  }
});

// ---------------------------------------------------------------------------
// NAV_ITEMS structural invariants
// ---------------------------------------------------------------------------

test("PRIMARY_TABS contains exactly the four primary-group items", () => {
  assert.equal(PRIMARY_TABS.length, 4);
  const hrefs = PRIMARY_TABS.map((t) => t.href);
  assert.ok(hrefs.includes("/dashboard"), "PRIMARY_TABS must include /dashboard");
  assert.ok(hrefs.includes("/browse"), "PRIMARY_TABS must include /browse");
  assert.ok(hrefs.includes("/study"), "PRIMARY_TABS must include /study");
  assert.ok(hrefs.includes("/progress"), "PRIMARY_TABS must include /progress");
});

test("every PRIMARY_TABS item has mobileTab=true", () => {
  for (const item of PRIMARY_TABS) {
    assert.equal(item.mobileTab, true, `${item.href} must have mobileTab=true`);
  }
});

test("no SECONDARY_NAV item has mobileTab=true", () => {
  for (const item of SECONDARY_NAV) {
    assert.equal(item.mobileTab, false, `${item.href} must have mobileTab=false`);
  }
});

test("every item in NAV_ITEMS has all required fields", () => {
  for (const item of NAV_ITEMS) {
    assert.ok(item.href, `item.href must be truthy`);
    assert.ok(item.label, `item.label must be truthy`);
    assert.ok(item.icon, `item.icon must be present`);
    assert.ok(["primary", "secondary", "utility"].includes(item.group), `item.group must be valid`);
    assert.equal(typeof item.mobileTab, "boolean", `item.mobileTab must be boolean`);
    assert.equal(typeof item.protected, "boolean", `item.protected must be boolean`);
  }
});

test("READER_ROUTE_PREFIX is /reader/", () => {
  assert.equal(READER_ROUTE_PREFIX, "/reader/");
});

test("PRIMARY_NAV does not include utility-group items", () => {
  const utilityInPrimary = PRIMARY_NAV.filter((item) => item.group === "utility");
  assert.equal(
    utilityInPrimary.length,
    0,
    "utility items must not appear in PRIMARY_NAV",
  );
});
