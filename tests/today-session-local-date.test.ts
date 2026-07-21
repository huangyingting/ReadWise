/**
 * Today Session — timezone / local-date resolution (#789).
 *
 * Covers the fallback chain: request/browser tz → profile tz → invalid-tz
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

test("resolveTimezone prefers request, then profile, then UTC", async () => {
  const { resolveTimezone } = await import(
    "@/lib/engagement/today-session/local-date"
  );
  // Request wins when valid.
  assert.equal(
    resolveTimezone("Asia/Tokyo", "Europe/Paris"),
    "Asia/Tokyo",
  );
  // Profile used when request missing/invalid.
  assert.equal(resolveTimezone("Asia/Tokyo", null), "Asia/Tokyo");
  assert.equal(resolveTimezone("Bad/Zone", "Europe/Paris"), "Europe/Paris");
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

test("resolveLocalDate uses request timezone over profile near midnight", async () => {
  const { resolveLocalDate } = await import(
    "@/lib/engagement/today-session/local-date"
  );
  profileTimezone = "America/Los_Angeles";
  const res = await resolveLocalDate({
    userId: "u1",
    requestTimezone: "Asia/Tokyo",
    now: new Date("2026-06-27T15:30:00Z"),
  });
  assert.equal(res.timezone, "Asia/Tokyo");
  assert.equal(res.localDate, "2026-06-28");
});

test("resolveLocalDate falls back to profile timezone then UTC", async () => {
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
