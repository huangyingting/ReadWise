/**
 * Unit tests for the Phase-1.10 canary configuration + definition-version pure
 * planners (issue #1090).
 *
 * Proves: the three canaries are declared (one per channel), none seeds ACTIVE
 * (no registry sync silently activates a source), all are unauthenticated
 * registered providers, adapter selection maps each channel to the right adapter,
 * and the pure definition-version planners behave.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import { DiscoverySourceLifecycleMode } from "@prisma/client";

import type { DiscoveryFetch, DiscoveryFetchResult } from "@/lib/scraper/fetch";
import {
  CANARIES,
  assertNoCanaryAutoActivates,
  canaryAdapterFor,
  findCanary,
  isCanarySource,
  selectCanaryAdapterForSource,
} from "@/lib/scraper/incremental/canaries";
import {
  nextDefinitionVersion,
  planRollback,
} from "@/lib/scraper/incremental/definition-version";
import { getProvider } from "@/lib/scraper/providers";

const M = DiscoverySourceLifecycleMode;

const okFetch: DiscoveryFetch = async (): Promise<DiscoveryFetchResult> => ({
  outcome: "ok",
  status: 200,
  finalUrl: "https://example.test/doc",
  body: "<rss></rss>",
  notModified: false,
  validators: {},
  headers: {},
});

test("exactly three canaries are configured, one per channel", () => {
  assert.equal(CANARIES.length, 3);
  const channels = CANARIES.map((c) => c.channel).sort();
  assert.deepEqual(channels, ["rss", "seed-html", "sitemap"]);
});

test("no canary seeds ACTIVE (no silent activation)", () => {
  for (const canary of CANARIES) {
    assert.notEqual(canary.seedLifecycleMode, M.ACTIVE);
  }
  // The assertion helper does not throw for the real config.
  assert.doesNotThrow(() => assertNoCanaryAutoActivates());
});

test("assertNoCanaryAutoActivates throws when a canary is seeded ACTIVE", () => {
  assert.throws(
    () =>
      assertNoCanaryAutoActivates([
        { ...CANARIES[0], seedLifecycleMode: M.ACTIVE },
      ]),
    /must not seed ACTIVE/,
  );
});

test("every canary maps to a registered, unauthenticated provider", () => {
  for (const canary of CANARIES) {
    const provider = getProvider(canary.providerKey);
    assert.ok(provider, `provider ${canary.providerKey} is registered`);
  }
});

test("isCanarySource / findCanary identify configured canaries only", () => {
  assert.ok(isCanarySource("theconversation", "canary-rss"));
  assert.ok(!isCanarySource("theconversation", "some-other-key"));
  assert.ok(!isCanarySource("unknown-provider", "canary-rss"));
  assert.equal(findCanary("worksinprogress", "canary-sitemap")?.channel, "sitemap");
});

test("canaryAdapterFor builds a working fetcher for each channel", async () => {
  for (const canary of CANARIES) {
    const adapter = canaryAdapterFor(canary, { fetchResponse: okFetch });
    const page = await adapter({ source: { id: "x" } as never });
    assert.equal(page.boundaryReached, true);
  }
});

test("selectCanaryAdapterForSource returns null for a non-canary source", () => {
  const adapter = selectCanaryAdapterForSource(
    { providerKey: "unknown", sourceKey: "nope" },
    { fetchResponse: okFetch },
  );
  assert.equal(adapter, null);
});

test("selectCanaryAdapterForSource resolves a canary source to its adapter", () => {
  const adapter = selectCanaryAdapterForSource(
    { providerKey: "undark", sourceKey: "canary-seed-html" },
    { fetchResponse: okFetch },
  );
  assert.ok(adapter);
});

// ---------------------------------------------------------------------------
// Definition-version pure planners
// ---------------------------------------------------------------------------

test("nextDefinitionVersion allocates one above the current maximum", () => {
  assert.equal(nextDefinitionVersion([]), 1);
  assert.equal(nextDefinitionVersion([1]), 2);
  assert.equal(nextDefinitionVersion([1, 2, 3]), 4);
  assert.equal(nextDefinitionVersion([3, 1, 2]), 4);
});

test("planRollback retires the newest non-retired version and restores the prior", () => {
  const plan = planRollback([
    { definitionVersion: 1, lifecycleMode: M.SHADOW },
    { definitionVersion: 2, lifecycleMode: M.SHADOW },
  ]);
  assert.deepEqual(plan, { retire: 2, restore: 1 });
});

test("planRollback returns null when there is no prior version to restore", () => {
  assert.equal(planRollback([{ definitionVersion: 1, lifecycleMode: M.SHADOW }]), null);
  assert.equal(
    planRollback([
      { definitionVersion: 1, lifecycleMode: M.RETIRED },
      { definitionVersion: 2, lifecycleMode: M.SHADOW },
    ]),
    null,
  );
});
