/**
 * Today Session — timezone / local-date resolution (#789).
 *
 * Covers the fallback chain: profile tz → request/browser tz → invalid-tz
 * fallback → UTC, plus the YYYY-MM-DD local-day bucketing.
 */
process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

// Mutable profile timezone the mocked prisma returns.
let profileTimezone: string | null = null;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        profile: {
          findUnique: async () => ({ timezone: profileTimezone }),
        },
      },
    },
  });
});

test("isValidTimezone distinguishes real IANA zones from junk", async () => {
  const { isValidTimezone } = await import(
    "@/lib/engagement/today-session/local-date"
  );
  assert.equal(isValidTimezone("America/New_York"), true);
  assert.equal(isValidTimezone("UTC"), true);
  assert.equal(isValidTimezone("Not/AZone"), false);
  assert.equal(isValidTimezone(""), false);
  assert.equal(isValidTimezone(null), false);
  assert.equal(isValidTimezone(undefined), false);
  assert.equal(isValidTimezone(123), false);
});

test("resolveTimezone prefers profile, then request, then UTC", async () => {
  const { resolveTimezone } = await import(
    "@/lib/engagement/today-session/local-date"
  );
  // Profile wins when valid.
  assert.equal(
    resolveTimezone("Europe/Paris", "Asia/Tokyo"),
    "Europe/Paris",
  );
  // Request used when profile missing/invalid.
  assert.equal(resolveTimezone(null, "Asia/Tokyo"), "Asia/Tokyo");
  assert.equal(resolveTimezone("Bad/Zone", "Asia/Tokyo"), "Asia/Tokyo");
  // UTC when neither is valid.
  assert.equal(resolveTimezone(null, "also/bad"), "UTC");
  assert.equal(resolveTimezone(undefined, undefined), "UTC");
});

test("resolveLocalDate uses profile timezone for the YYYY-MM-DD bucket", async () => {
  const { resolveLocalDate } = await import(
    "@/lib/engagement/today-session/local-date"
  );
  profileTimezone = "America/New_York";
  // 2026-06-27T02:00:00Z is still 2026-06-26 (22:00) in New York.
  const res = await resolveLocalDate({
    userId: "u1",
    now: new Date("2026-06-27T02:00:00Z"),
  });
  assert.equal(res.timezone, "America/New_York");
  assert.equal(res.localDate, "2026-06-26");
  assert.match(res.localDate, /^\d{4}-\d{2}-\d{2}$/);
});

test("resolveLocalDate falls back to request timezone then UTC", async () => {
  const { resolveLocalDate } = await import(
    "@/lib/engagement/today-session/local-date"
  );
  // No profile timezone → use the request zone.
  profileTimezone = null;
  const tokyo = await resolveLocalDate({
    userId: "u1",
    requestTimezone: "Asia/Tokyo",
    now: new Date("2026-06-26T20:00:00Z"), // 2026-06-27 05:00 in Tokyo
  });
  assert.equal(tokyo.timezone, "Asia/Tokyo");
  assert.equal(tokyo.localDate, "2026-06-27");

  // Invalid request zone → UTC.
  const utc = await resolveLocalDate({
    userId: "u1",
    requestTimezone: "Bogus/Zone",
    now: new Date("2026-06-26T20:00:00Z"),
  });
  assert.equal(utc.timezone, "UTC");
  assert.equal(utc.localDate, "2026-06-26");
});
