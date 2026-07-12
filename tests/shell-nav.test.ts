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
 *  - Feature-flag gating (filterNavForUser) — Today nav hidden/shown (#1011)
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
  filterNavForUser,
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
    "/today",
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

// ---------------------------------------------------------------------------
// Today nav item — feature-gated discoverability (#1011)
// ---------------------------------------------------------------------------

test("NAV_ITEMS includes Today with correct shape", () => {
  const today = NAV_ITEMS.find((item) => item.href === "/today");
  assert.ok(today, "/today must be present in NAV_ITEMS");
  assert.equal(today.label, "Today");
  assert.equal(today.group, "secondary");
  assert.equal(today.mobileTab, false);
  assert.equal(today.protected, true);
  assert.equal(today.requiresFeature, "todaySession");
});

test("Today is in SECONDARY_NAV (secondary group)", () => {
  const today = SECONDARY_NAV.find((item) => item.href === "/today");
  assert.ok(today, "Today must appear in SECONDARY_NAV (secondary sidebar + More sheet)");
});

test("Today does NOT appear in PRIMARY_TABS (mobile tab budget preserved)", () => {
  const today = PRIMARY_TABS.find((item) => item.href === "/today");
  assert.equal(today, undefined, "Today must not crowd the four primary mobile tabs");
});

test("PRIMARY_TABS still contains exactly four items with Today present in NAV_ITEMS", () => {
  assert.equal(PRIMARY_TABS.length, 4, "Mobile tab budget must remain at four items");
});

test("isActivePath matches /today exactly", () => {
  assert.equal(isActivePath("/today", "/today"), true);
});

test("isActivePath matches nested /today/* routes", () => {
  assert.equal(isActivePath("/today/session/1", "/today"), true);
});

// ---------------------------------------------------------------------------
// filterNavForUser — feature-flag gating
// ---------------------------------------------------------------------------

test("filterNavForUser - hides Today when showTodayNav=false", () => {
  const result = filterNavForUser(SECONDARY_NAV, false);
  const today = result.find((item) => item.href === "/today");
  assert.equal(today, undefined, "Today must be filtered out when showTodayNav=false");
});

test("filterNavForUser - shows Today when showTodayNav=true", () => {
  const result = filterNavForUser(SECONDARY_NAV, true);
  const today = result.find((item) => item.href === "/today");
  assert.ok(today, "Today must appear when showTodayNav=true");
});

test("filterNavForUser - non-feature-gated items always pass through", () => {
  const flagOff = filterNavForUser(SECONDARY_NAV, false);
  const flagOn = filterNavForUser(SECONDARY_NAV, true);
  const unconditional = SECONDARY_NAV.filter((item) => !item.requiresFeature);
  for (const item of unconditional) {
    assert.ok(
      flagOff.some((i) => i.href === item.href),
      `${item.href} must appear with showTodayNav=false`,
    );
    assert.ok(
      flagOn.some((i) => i.href === item.href),
      `${item.href} must appear with showTodayNav=true`,
    );
  }
});

test("filterNavForUser - PRIMARY_NAV with showTodayNav=false excludes Today", () => {
  const result = filterNavForUser(PRIMARY_NAV, false);
  assert.equal(
    result.find((i) => i.href === "/today"),
    undefined,
    "Today must not appear in filtered PRIMARY_NAV when disabled",
  );
});

test("filterNavForUser - PRIMARY_NAV with showTodayNav=true includes Today", () => {
  const result = filterNavForUser(PRIMARY_NAV, true);
  assert.ok(
    result.find((i) => i.href === "/today"),
    "Today must appear in filtered PRIMARY_NAV when enabled",
  );
});
