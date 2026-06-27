/**
 * Tests for the formatRelative display helper.
 *
 * NOTE — SOURCE OBSERVATIONS (do not fix here):
 *   1. `formatRelative("not-a-date")` returns "NaNd ago", NOT "". The catch
 *      block on line 14-15 is unreachable with ordinary string inputs because
 *      `new Date(anyString).getTime()` returns NaN (no throw) and NaN
 *      arithmetic falls through to the last branch producing "NaNd ago".
 *   2. To exercise the catch block the only viable technique is passing a
 *      non-string whose `toString()` throws.  Both limitations reflect defensive
 *      code that is never triggered by well-typed callers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRelative } from "@/lib/format-relative";

/** Returns an ISO string for a timestamp `ms` milliseconds in the past. */
function msAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

// ---------------------------------------------------------------------------
// "just now" bucket  (diff < 60 000 ms)
// ---------------------------------------------------------------------------

test("formatRelative returns 'just now' for a timestamp 30 seconds ago", () => {
  assert.equal(formatRelative(msAgo(30_000)), "just now");
});

test("formatRelative returns 'just now' for the current instant", () => {
  assert.equal(formatRelative(new Date().toISOString()), "just now");
});

test("formatRelative returns 'just now' for a future timestamp because diff is negative and less than 60 000", () => {
  // diff = Date.now() - futureDate < 0; negative < 60_000 is true → "just now"
  const future = new Date(Date.now() + 10_000).toISOString();
  assert.equal(formatRelative(future), "just now");
});

// ---------------------------------------------------------------------------
// Minutes bucket  (60 000 ≤ diff < 3 600 000)
// ---------------------------------------------------------------------------

test("formatRelative returns '1m ago' for a timestamp exactly 1 minute ago", () => {
  assert.equal(formatRelative(msAgo(60_000)), "1m ago");
});

test("formatRelative returns '5m ago' for a timestamp 5 minutes ago", () => {
  assert.equal(formatRelative(msAgo(5 * 60_000)), "5m ago");
});

test("formatRelative returns '59m ago' for a timestamp 59 minutes ago", () => {
  assert.equal(formatRelative(msAgo(59 * 60_000)), "59m ago");
});

// ---------------------------------------------------------------------------
// Hours bucket  (3 600 000 ≤ diff < 86 400 000)
// ---------------------------------------------------------------------------

test("formatRelative returns '1h ago' for a timestamp exactly 1 hour ago", () => {
  assert.equal(formatRelative(msAgo(3_600_000)), "1h ago");
});

test("formatRelative returns '2h ago' for a timestamp 2 hours ago", () => {
  assert.equal(formatRelative(msAgo(2 * 3_600_000)), "2h ago");
});

test("formatRelative returns '23h ago' for a timestamp 23 hours ago", () => {
  assert.equal(formatRelative(msAgo(23 * 3_600_000)), "23h ago");
});

// ---------------------------------------------------------------------------
// Days bucket  (diff ≥ 86 400 000)
// ---------------------------------------------------------------------------

test("formatRelative returns '1d ago' for a timestamp exactly 24 hours ago", () => {
  assert.equal(formatRelative(msAgo(86_400_000)), "1d ago");
});

test("formatRelative returns '3d ago' for a timestamp 3 days ago", () => {
  assert.equal(formatRelative(msAgo(3 * 86_400_000)), "3d ago");
});

test("formatRelative returns '7d ago' for a timestamp 7 days ago", () => {
  assert.equal(formatRelative(msAgo(7 * 86_400_000)), "7d ago");
});

// ---------------------------------------------------------------------------
// Error / catch branch
// ---------------------------------------------------------------------------

test("formatRelative returns '' when the input causes new Date() to throw", () => {
  // Passing a non-string whose toString() throws exercises the catch block.
  // This is a type-safety escape hatch; real callers always pass strings.
  const throwingInput = {
    toString() { throw new Error("boom"); },
  } as unknown as string;
  assert.equal(formatRelative(throwingInput), "");
});

// ---------------------------------------------------------------------------
// Invalid date string — documents current behaviour (not the catch branch)
// ---------------------------------------------------------------------------

test("formatRelative returns a 'NaNd ago' string for an unparseable date because the catch block is not reached by string inputs", () => {
  // new Date("not-a-date").getTime() === NaN; NaN arithmetic does not throw;
  // all comparisons are false so the function falls through to the days branch.
  // SOURCE OBSERVATION: the catch block returning "" is unreachable for strings.
  const result = formatRelative("not-a-valid-date");
  assert.equal(typeof result, "string");
  assert.ok(result.includes("NaN"), `expected 'NaN' in result but got: ${result}`);
});
