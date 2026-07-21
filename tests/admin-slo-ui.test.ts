/**
 * Unit tests for the admin SLO dashboard UI wiring (#1187).
 *
 * `GET /api/admin/slo` already returned a catalog + evaluated report. These
 * tests lock the client-safe endpoint/helpers and source-level dashboard island
 * wiring without jsdom.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  formatLatencyThreshold,
  formatSloObjective,
  formatSloPercent,
  sliCatalogByKey,
  sloStatusBadgeVariant,
  sloStatusEndpoint,
} from "@/lib/admin/security/slo-ui";

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
        return { catalog: [], report: { total: 0, ok: 0, breaching: 0, noData: 0, slis: [] } };
      },
    },
  });
  clientFetch = await import("@/lib/client-fetch");
});

beforeEach(() => {
  getCalls = [];
});

test("sloStatusEndpoint targets the existing admin SLO route", () => {
  assert.equal(sloStatusEndpoint(), "/api/admin/slo");
});

test("SLO display helpers map statuses, values, objectives, and thresholds", () => {
  assert.equal(sloStatusBadgeVariant("ok"), "success");
  assert.equal(sloStatusBadgeVariant("breaching"), "danger");
  assert.equal(sloStatusBadgeVariant("no_data"), "neutral");
  assert.equal(formatSloPercent(0.9876), "98.8%");
  assert.equal(formatSloPercent(null), "No data");
  assert.equal(formatSloObjective(0.995), "99.5%");
  assert.equal(
    formatLatencyThreshold({
      key: "dashboard",
      flow: "Dashboard",
      title: "Dashboard latency",
      category: "interactive",
      kind: "latency",
      objective: 0.95,
      latencyThresholdMs: 1000,
      value: 1,
      sampleCount: 3,
      status: "ok",
    }),
    "1000 ms",
  );
});

test("sliCatalogByKey indexes catalog entries by key", () => {
  const catalog = sliCatalogByKey([
    {
      key: "sign_in",
      flow: "Sign-in",
      title: "Sign-in availability",
      description: "Auth endpoint availability",
      category: "interactive",
      objective: 0.995,
      measurement: { metric: "api", kind: "availability", routePrefix: "/api/auth" },
    },
  ]);
  assert.equal(catalog.sign_in?.description, "Auth endpoint availability");
});

test("getJson fetches the SLO snapshot from the exact endpoint", async () => {
  await clientFetch.getJson(sloStatusEndpoint());
  assert.equal(getCalls.length, 1);
  assert.equal(getCalls[0]?.url, "/api/admin/slo");
});

test("AdminSloDashboardPanel is a client island with loading/empty/error/table states", () => {
  const src = readSrc("src/components/admin/security/AdminSloDashboardPanel.tsx");
  assert.ok(src.includes('"use client"'), "must be a client component");
  assert.ok(src.includes("getJson"), "loads via getJson");
  assert.ok(src.includes("sloStatusEndpoint"), "builds URL from pure helper");
  assert.ok(src.includes("classifyAdminFetchError"), "classifies fetch errors");
  assert.ok(src.includes("PanelSkeleton"), "renders loading state");
  assert.ok(src.includes("PanelErrorState"), "renders error/denied state");
  assert.ok(src.includes("EmptyState"), "renders empty state");
  assert.ok(src.includes("AdminTableWrap"), "renders a table surface");
  assert.ok(src.includes("<Badge"), "renders status badges");
  assert.ok(src.includes("Refresh"), "offers a refresh action");
  for (const header of ["Flow", "Status", "Metric", "Value", "Objective", "Threshold", "Samples"]) {
    assert.ok(src.includes(`>${header}<`), `keeps the ${header} column`);
  }
});

test("security page mounts the SLO panel and keeps securityView gating", () => {
  const src = readSrc("src/app/admin/security/page.tsx");
  assert.ok(src.includes("AdminSloDashboardPanel"), "renders the SLO dashboard");
  assert.ok(
    src.includes("requireCapability(CAPABILITIES.securityView"),
    "keeps the securityView capability gate",
  );
});

for (const rel of [
  "src/components/admin/security/AdminSloDashboardPanel.tsx",
  "src/lib/admin/security/slo-ui.ts",
]) {
  test(`${rel} is token-driven (no raw hex, no inline font-size/style)`, () => {
    const src = readSrc(rel).replace(/#\d+/g, "");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "must not use a raw hex colour");
    assert.ok(!src.includes("fontSize"), "must not set an inline fontSize");
    assert.ok(!src.includes("style={{"), "must not use inline styles");
  });
}
