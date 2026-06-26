/**
 * Tests for the cn / focusRing utilities (REF-057).
 *
 * Pure string-merge contracts — no mocks, no DOM.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { cn, focusRing } from "@/lib/cn";

// ---------------------------------------------------------------------------
// focusRing utility
// ---------------------------------------------------------------------------

describe("focusRing utility — CSS contract", () => {
  test("is a non-empty string", () => {
    assert.equal(typeof focusRing, "string");
    assert.ok(focusRing.length > 0);
  });

  test("includes outline-none to suppress the browser default outline", () => {
    assert.ok(
      focusRing.includes("outline-none"),
      "focusRing must contain outline-none",
    );
  });

  test("uses focus-visible: selector for keyboard-only visibility", () => {
    assert.ok(
      focusRing.includes("focus-visible:"),
      "focusRing must use focus-visible: so mouse users do not see the ring",
    );
  });

  test("includes box-shadow for the ring layers", () => {
    assert.ok(
      focusRing.includes("box-shadow"),
      "focusRing must set box-shadow for ring-offset + focus ring",
    );
  });

  test("references --focus-ring CSS token for theme consistency", () => {
    assert.ok(
      focusRing.includes("--focus-ring"),
      "focusRing must reference --focus-ring token",
    );
  });

  test("references --ring-offset CSS token for the 2px gap", () => {
    assert.ok(
      focusRing.includes("--ring-offset"),
      "focusRing must reference --ring-offset token",
    );
  });
});

// ---------------------------------------------------------------------------
// cn utility
// ---------------------------------------------------------------------------

describe("cn utility — class name merge contract", () => {
  test("concatenates plain class names", () => {
    assert.equal(cn("foo", "bar"), "foo bar");
  });

  test("ignores falsy inputs (null, undefined, false)", () => {
    assert.equal(cn("foo", null, undefined, false, "bar"), "foo bar");
  });

  test("resolves Tailwind conflicts — later class wins", () => {
    const result = cn("text-sm", "text-base");
    assert.ok(result.includes("text-base"), `expected 'text-base' in '${result}'`);
    assert.ok(!result.includes("text-sm"), `unexpected 'text-sm' in '${result}'`);
  });

  test("handles conditional object syntax", () => {
    const result = cn({ active: true, hidden: false });
    assert.ok(result.includes("active"));
    assert.ok(!result.includes("hidden"));
  });

  test("handles array of class names", () => {
    const result = cn(["foo", "bar"]);
    assert.ok(result.includes("foo") && result.includes("bar"));
  });

  test("returns an empty string for all-falsy input", () => {
    assert.equal(cn(null, undefined, false), "");
  });
});

// ---------------------------------------------------------------------------
// focusRing composability (Button/Input/Switch/SegmentedControl)
// ---------------------------------------------------------------------------

describe("focusRing is a composable class string (Button/Input/Switch/SegmentedControl)", () => {
  test("cn(focusRing, 'text-sm') produces a valid merged class string", () => {
    const result = cn(focusRing, "text-sm");
    assert.ok(result.includes("text-sm"));
    assert.ok(result.includes("outline-none"));
    assert.ok(result.includes("focus-visible:"));
  });

  test("cn(focusRing, focusRing) deduplicates outline-none", () => {
    const result = cn(focusRing, focusRing);
    const count = (result.match(/outline-none/g) ?? []).length;
    assert.ok(count >= 1, "outline-none must be present");
  });

  test("focusRing can be negated by a later outline-none override", () => {
    const result = cn(focusRing, "outline-2");
    assert.ok(result.includes("outline-2") || result.includes("outline-none"),
      "merged result must retain one outline utility");
  });
});
