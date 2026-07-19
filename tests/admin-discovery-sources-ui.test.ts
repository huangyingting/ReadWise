/**
 * Unit tests for the discovery-source admin UI (issue #1089, Phase 1.9,
 * frontend half).
 *
 * Covers:
 *  - AdminNav includes /admin/discovery-sources with label "Discovery".
 *  - The list + detail pages gate on `sources.manage` via requireCapability.
 *  - The pure lifecycle action-eligibility mirror (which action buttons render
 *    enabled per lifecycle mode) — the UI's DISABLED-action contract.
 *  - The action names/labels are single-sourced from lifecycle-action-meta and
 *    re-exported by the server dispatcher (no drift).
 *  - The action component posts to the lifecycle endpoint and surfaces errors,
 *    and renders no URL/content/secret (AC4).
 *
 * No React, no DOM, no database — source-string + pure-logic checks only,
 * mirroring tests/admin-series-ui.test.ts.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import { DiscoverySourceLifecycleMode } from "@prisma/client";

import {
  enabledLifecycleActions,
  lifecycleActionEnabled,
} from "@/lib/scraper/incremental/lifecycle-action-eligibility";
import {
  LIFECYCLE_ACTIONS,
  LIFECYCLE_ACTION_LABELS,
  isDestructiveLifecycleAction,
} from "@/lib/scraper/incremental/lifecycle-action-meta";
import { LIFECYCLE_ACTIONS as DISPATCHER_ACTIONS } from "@/lib/scraper/incremental/lifecycle-actions";

const WORKTREE = resolve(import.meta.dirname, "..");
const { DISABLED, BASELINE, SHADOW, ACTIVE, PAUSED, RETIRED } =
  DiscoverySourceLifecycleMode;

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

// ---------------------------------------------------------------------------
// AdminNav — "Discovery" link present
// ---------------------------------------------------------------------------

test("AdminNav includes /admin/discovery-sources with label 'Discovery'", () => {
  const src = readSrc("src/components/AdminNav.tsx");
  assert.ok(src.includes('href: "/admin/discovery-sources"'));
  assert.ok(src.includes('label: "Discovery"'));
});

// ---------------------------------------------------------------------------
// Pages gate on sources.manage
// ---------------------------------------------------------------------------

test("discovery-sources list page gates on sourcesManage", () => {
  const src = readSrc("src/app/admin/discovery-sources/page.tsx");
  assert.ok(src.includes("requireCapability"));
  assert.ok(src.includes("CAPABILITIES.sourcesManage"));
  assert.ok(src.includes('"/admin/discovery-sources"'));
  assert.ok(src.includes("listDiscoverySourceMetrics"));
});

test("discovery-source detail page gates on sourcesManage and reads metrics", () => {
  const src = readSrc("src/app/admin/discovery-sources/[id]/page.tsx");
  assert.ok(src.includes("requireCapability"));
  assert.ok(src.includes("CAPABILITIES.sourcesManage"));
  assert.ok(src.includes("getDiscoverySourceMetrics"));
  assert.ok(src.includes("AdminDiscoverySourceActions"));
  assert.ok(src.includes("enabledLifecycleActions"));
});

// ---------------------------------------------------------------------------
// Action metadata is single-sourced (no drift with the API dispatcher)
// ---------------------------------------------------------------------------

test("action names are single-sourced and match the dispatcher", () => {
  assert.deepEqual([...DISPATCHER_ACTIONS], [...LIFECYCLE_ACTIONS]);
  assert.deepEqual(
    [...LIFECYCLE_ACTIONS],
    ["begin-baseline", "activate", "pause", "resume", "rollback", "disable", "retire"],
  );
  for (const action of LIFECYCLE_ACTIONS) {
    assert.equal(typeof LIFECYCLE_ACTION_LABELS[action], "string");
    assert.ok(LIFECYCLE_ACTION_LABELS[action].length > 0);
  }
});

test("only unwind/stop actions are destructive (need a confirm)", () => {
  assert.equal(isDestructiveLifecycleAction("rollback"), true);
  assert.equal(isDestructiveLifecycleAction("disable"), true);
  assert.equal(isDestructiveLifecycleAction("retire"), true);
  assert.equal(isDestructiveLifecycleAction("begin-baseline"), false);
  assert.equal(isDestructiveLifecycleAction("activate"), false);
  assert.equal(isDestructiveLifecycleAction("pause"), false);
  assert.equal(isDestructiveLifecycleAction("resume"), false);
});

// ---------------------------------------------------------------------------
// Action eligibility per lifecycle mode (the DISABLED-action contract)
// ---------------------------------------------------------------------------

test("enabledLifecycleActions matches the safe transition set per mode", () => {
  assert.deepEqual(enabledLifecycleActions(DISABLED), ["begin-baseline", "retire"]);
  assert.deepEqual(enabledLifecycleActions(BASELINE), [
    "pause",
    "rollback",
    "disable",
    "retire",
  ]);
  assert.deepEqual(enabledLifecycleActions(SHADOW), [
    "activate",
    "pause",
    "rollback",
    "retire",
  ]);
  assert.deepEqual(enabledLifecycleActions(ACTIVE), ["pause", "rollback", "retire"]);
  assert.deepEqual(enabledLifecycleActions(PAUSED), [
    "resume",
    "rollback",
    "disable",
    "retire",
  ]);
  assert.deepEqual(enabledLifecycleActions(RETIRED), []);
});

test("activate is only enabled from SHADOW (activation gate, AC)", () => {
  assert.equal(lifecycleActionEnabled("activate", SHADOW), true);
  for (const mode of [DISABLED, BASELINE, ACTIVE, PAUSED, RETIRED]) {
    assert.equal(lifecycleActionEnabled("activate", mode), false);
  }
});

test("begin-baseline is only enabled from DISABLED", () => {
  assert.equal(lifecycleActionEnabled("begin-baseline", DISABLED), true);
  for (const mode of [BASELINE, SHADOW, ACTIVE, PAUSED, RETIRED]) {
    assert.equal(lifecycleActionEnabled("begin-baseline", mode), false);
  }
});

test("resume is only enabled from PAUSED", () => {
  assert.equal(lifecycleActionEnabled("resume", PAUSED), true);
  for (const mode of [DISABLED, BASELINE, SHADOW, ACTIVE, RETIRED]) {
    assert.equal(lifecycleActionEnabled("resume", mode), false);
  }
});

test("a RETIRED source has no enabled actions (terminal)", () => {
  for (const action of LIFECYCLE_ACTIONS) {
    assert.equal(lifecycleActionEnabled(action, RETIRED), false);
  }
});

// ---------------------------------------------------------------------------
// Action component: posts to the lifecycle endpoint, surfaces errors, no PII
// ---------------------------------------------------------------------------

test("action component posts to the lifecycle endpoint and surfaces errors", () => {
  const src = readSrc("src/components/AdminDiscoverySourceActions.tsx");
  assert.ok(src.includes("/api/admin/discovery-sources/"));
  assert.ok(src.includes("/lifecycle"));
  assert.ok(src.includes("postJson"));
  assert.ok(src.includes('role="alert"'));
  assert.ok(src.includes("ConfirmAction"));
});

test("discovery-source UI never references URL/content/secret fields (AC4)", () => {
  const files = [
    "src/app/admin/discovery-sources/page.tsx",
    "src/app/admin/discovery-sources/[id]/page.tsx",
    "src/components/AdminDiscoverySourceActions.tsx",
    "src/components/DiscoverySourceStatusBadge.tsx",
  ];
  const forbidden = [
    "checkpointCursor",
    "watermarkKey",
    "leaseOwner",
    "gapNote",
    "lastError",
    "trustedPublishedAt",
    "provisionalKey",
  ];
  for (const file of files) {
    const src = readSrc(file);
    for (const term of forbidden) {
      assert.ok(
        !src.includes(term),
        `${file} must not reference PII/secret field "${term}"`,
      );
    }
  }
});
