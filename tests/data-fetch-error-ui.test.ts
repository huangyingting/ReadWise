/**
 * UI wiring tests for explicit data-fetch error + retry states (#1188).
 *
 * These components used to fail closed: reminder preferences rendered nothing on
 * `/api/push/preferences` failure and the Offline Library collapsed IndexedDB
 * failures into an empty state. The tests follow the repo source-string
 * convention for client islands and mock `client-fetch` where an endpoint is
 * asserted.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

type GetCall = { url: string };
let getCalls: GetCall[] = [];
let clientFetch: typeof import("@/lib/client-fetch");

before(async () => {
  mock.module("@/lib/client-fetch", {
    namedExports: {
      getJson: async (url: string) => {
        getCalls.push({ url });
        return {
          preference: {
            enabled: true,
            preferredHour: null,
            quietHoursStart: null,
            quietHoursEnd: null,
            timezone: "UTC",
          },
        };
      },
      putJson: async () => ({
        preference: {
          enabled: true,
          preferredHour: null,
          quietHoursStart: null,
          quietHoursEnd: null,
          timezone: "UTC",
        },
      }),
    },
  });
  clientFetch = await import("@/lib/client-fetch");
});

beforeEach(() => {
  getCalls = [];
});

test("ReminderPreferencesForm fetches the exact push preferences endpoint", async () => {
  await clientFetch.getJson("/api/push/preferences");
  assert.equal(getCalls.length, 1);
  assert.equal(getCalls[0]?.url, "/api/push/preferences");
});

test("ReminderPreferencesForm has explicit loading, error, retry, and ready states", () => {
  const src = readSrc("src/components/ReminderPreferencesForm.tsx");
  assert.ok(src.includes("PreferenceLoadState"), "uses an explicit load-state union");
  assert.ok(src.includes('status: "loading"'), "tracks loading");
  assert.ok(src.includes('status: "error"'), "tracks failed fetches separately");
  assert.ok(src.includes('status: "ready"'), "tracks loaded preferences separately");
  assert.ok(src.includes("SkeletonText"), "renders a skeleton while loading");
  assert.ok(src.includes('role="alert"'), "announces load errors");
  assert.ok(src.includes("Retry"), "offers a retry action");
  assert.ok(src.includes("loadPreferences"), "retry re-runs the preferences fetch");
  assert.ok(!src.includes("if (!pref)"), "does not fail closed when the fetch fails");
});

test("OfflineLibraryClient distinguishes loading, IndexedDB errors, empty, and ready states", () => {
  const src = readSrc("src/app/(app)/offline/OfflineLibraryClient.tsx");
  assert.ok(src.includes("OfflineLibraryState"), "uses an explicit load-state union");
  assert.ok(src.includes('status: "loading"'), "tracks loading");
  assert.ok(src.includes('status: "error"'), "tracks IndexedDB read failures separately");
  assert.ok(src.includes('status: "ready"'), "tracks loaded articles separately");
  assert.ok(src.includes("SkeletonText"), "replaces raw Loading text with a skeleton");
  assert.ok(src.includes("Offline library couldn't load"), "renders a distinct error copy");
  assert.ok(src.includes('role="alert"'), "announces the error state");
  assert.ok(src.includes("Retry"), "offers a retry action");
  assert.ok(src.includes("loadOfflineArticles"), "retry re-runs the IndexedDB read");
  assert.ok(!src.includes(".catch(() => setArticles([]))"), "does not collapse read errors to empty");
  assert.ok(!src.includes("Loading…"), "does not use raw loading text");
});

test("ReadingPlacementCard no longer fails closed on placement fetch errors", () => {
  const src = readSrc("src/components/placement/ReadingPlacementCard.tsx");
  assert.ok(src.includes("loadError"), "tracks load failure separately from unavailable");
  assert.ok(src.includes("Placement couldn&apos;t load"), "renders a placement fetch error");
  assert.ok(src.includes('role="alert"'), "announces the placement fetch error");
  assert.ok(src.includes("Retry"), "offers a retry action");
  assert.ok(src.includes("loadPlacement"), "retry re-runs the placement fetch");
});

for (const rel of [
  "src/components/ReminderPreferencesForm.tsx",
  "src/app/(app)/offline/OfflineLibraryClient.tsx",
]) {
  test(`${rel} is token-driven (no raw hex, no inline font-size/style)`, () => {
    const src = readSrc(rel).replace(/#\d+/g, "");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "must not use a raw hex colour");
    assert.ok(!src.includes("fontSize"), "must not set an inline fontSize");
    assert.ok(!src.includes("style={{"), "must not use inline styles");
  });
}
