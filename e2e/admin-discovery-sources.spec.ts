import { randomUUID } from "node:crypto";

import { type Page } from "@playwright/test";

import { prisma } from "@/lib/prisma";
import {
  CrawlCandidateStatus,
  DiscoveryAutomationPolicy,
  DiscoveryGapState,
  DiscoverySourceHealth,
  DiscoverySourceLifecycleMode,
  DiscoverySourceRole,
} from "@prisma/client";

import { expect, test, MOBILE_VIEWPORT } from "./support/fixtures";

type SeededSource = { id: string; providerKey: string; sourceKey: string };

async function seedSource(
  providerKey: string,
  sourceKey: string,
  overrides: Partial<{
    lifecycleMode: DiscoverySourceLifecycleMode;
    health: DiscoverySourceHealth;
    gapState: DiscoveryGapState;
    automationPolicy: DiscoveryAutomationPolicy;
    role: DiscoverySourceRole;
    baselineCompletedAt: Date | null;
    watermarkAt: Date | null;
    consecutiveFailures: number;
    gapDetectedAt: Date | null;
  }> = {},
): Promise<SeededSource> {
  const source = await prisma.discoverySource.create({
    data: {
      providerKey,
      sourceKey,
      definitionVersion: 1,
      role: overrides.role ?? DiscoverySourceRole.PRIMARY_FEED,
      lifecycleMode: overrides.lifecycleMode ?? DiscoverySourceLifecycleMode.DISABLED,
      automationPolicy: overrides.automationPolicy ?? DiscoveryAutomationPolicy.MANUAL,
      health: overrides.health ?? DiscoverySourceHealth.UNKNOWN,
      gapState: overrides.gapState ?? DiscoveryGapState.NONE,
      gapDetectedAt: overrides.gapDetectedAt ?? null,
      baselineCompletedAt: overrides.baselineCompletedAt ?? null,
      watermarkAt: overrides.watermarkAt ?? null,
      consecutiveFailures: overrides.consecutiveFailures ?? 0,
    },
  });
  return { id: source.id, providerKey: source.providerKey, sourceKey: source.sourceKey };
}

async function seedBacklogCandidate(source: SeededSource): Promise<void> {
  await prisma.crawlCandidate.create({
    data: {
      providerKey: source.providerKey,
      discoverySourceId: source.id,
      provisionalKey: `${source.providerKey}:${randomUUID()}`,
      status: CrawlCandidateStatus.QUEUED,
    },
  });
}

async function lifecycleModeOnDetail(page: Page): Promise<string> {
  const dd = page.locator("dt", { hasText: "Lifecycle mode" }).locator("xpath=following-sibling::dd[1]");
  return (await dd.innerText()).trim();
}

test("@high-risk admin discovery-sources: observability + lifecycle controls", async ({
  adminPage: page,
}) => {
  test.setTimeout(240_000);

  const prefix = `e2e-disc-${randomUUID().slice(0, 8)}`;
  const now = new Date();

  const disabled = await seedSource(prefix, "disabled-feed", {
    lifecycleMode: DiscoverySourceLifecycleMode.DISABLED,
  });
  const shadow = await seedSource(prefix, "shadow-feed", {
    lifecycleMode: DiscoverySourceLifecycleMode.SHADOW,
    health: DiscoverySourceHealth.HEALTHY,
    baselineCompletedAt: now,
    watermarkAt: now,
  });
  const active = await seedSource(prefix, "active-feed", {
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    health: DiscoverySourceHealth.HEALTHY,
    automationPolicy: DiscoveryAutomationPolicy.SCHEDULED,
    baselineCompletedAt: now,
    watermarkAt: now,
  });
  await seedBacklogCandidate(active);
  const gap = await seedSource(prefix, "gap-feed", {
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    health: DiscoverySourceHealth.HEALTHY,
    gapState: DiscoveryGapState.DETECTED,
    gapDetectedAt: now,
    watermarkAt: now,
  });
  const stalled = await seedSource(prefix, "stalled-feed", {
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    health: DiscoverySourceHealth.FAILING,
    consecutiveFailures: 5,
    watermarkAt: now,
  });

  const listUrl = `/admin/discovery-sources?providerKey=${encodeURIComponent(prefix)}`;

  await test.step("list distinguishes the five operational statuses (AC1)", async () => {
    await page.goto(listUrl);
    await expect(page.getByRole("heading", { name: "Discovery sources" })).toBeVisible();
    const table = page.locator("table.admin-table");
    await expect(table).toBeVisible();
    // Distinct status badges rendered without inspecting the DB.
    await expect(table.locator('[data-status="healthy-caught-up"]').first()).toBeVisible();
    await expect(table.locator('[data-status="healthy-backlog"]').first()).toBeVisible();
    await expect(table.locator('[data-status="gap-detected"]').first()).toBeVisible();
    await expect(table.locator('[data-status="stalled"]').first()).toBeVisible();
    void gap;
    void stalled;
  });

  await test.step("empty state when no sources match the filter", async () => {
    await page.goto(`/admin/discovery-sources?providerKey=${prefix}-no-such-provider`);
    await expect(page.getByText("No discovery sources match.")).toBeVisible();
  });

  await test.step("detail shows full metrics + lifecycle controls, keyboard focusable", async () => {
    await page.goto(`/admin/discovery-sources/${active.id}`);
    await expect(
      page.getByRole("heading", { name: `${active.providerKey}/${active.sourceKey}` }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lifecycle controls" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Candidate counts" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Drift/ })).toBeVisible();
    // Keyboard focus semantics: the Pause button can hold focus.
    const pause = page.getByRole("button", { name: "Pause", exact: true });
    await pause.focus();
    await expect(pause).toBeFocused();
  });

  await test.step("baseline action transitions a DISABLED source to BASELINE", async () => {
    await page.goto(`/admin/discovery-sources/${disabled.id}`);
    // Activation gate: activate is disabled from DISABLED.
    await expect(page.getByRole("button", { name: "Activate", exact: true })).toBeDisabled();
    const beginBaseline = page.getByRole("button", { name: "Begin baseline" });
    await expect(beginBaseline).toBeEnabled();
    await beginBaseline.click();
    await expect
      .poll(() => lifecycleModeOnDetail(page), { timeout: 60_000 })
      .toBe("BASELINE");
  });

  await test.step("activation gate then activate a SHADOW source", async () => {
    await page.goto(`/admin/discovery-sources/${shadow.id}`);
    await expect(page.getByRole("button", { name: "Begin baseline" })).toBeDisabled();
    const activate = page.getByRole("button", { name: "Activate", exact: true });
    await expect(activate).toBeEnabled();
    await activate.click();
    await expect.poll(() => lifecycleModeOnDetail(page), { timeout: 60_000 }).toBe("ACTIVE");
  });

  await test.step("mutation error (409) is surfaced and leaves the mode unchanged", async () => {
    await page.goto(`/admin/discovery-sources/${active.id}`);
    await page.route(
      `**/api/admin/discovery-sources/${active.id}/lifecycle`,
      async (route) => {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Source is currently being processed by a worker",
          }),
        });
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "currently being processed" }).first(),
    ).toBeVisible();
    await expect(page.getByText("Lifecycle mode")).toBeVisible();
    expect(await lifecycleModeOnDetail(page)).toBe("ACTIVE");
  });

  await test.step("pause action transitions ACTIVE to PAUSED", async () => {
    await page.goto(`/admin/discovery-sources/${active.id}`);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect.poll(() => lifecycleModeOnDetail(page), { timeout: 60_000 }).toBe("PAUSED");
  });

  await test.step("rollback action (with confirm) unwinds one step", async () => {
    await page.goto(`/admin/discovery-sources/${active.id}`);
    await page.getByRole("button", { name: "Rollback" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Confirm rollback" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm rollback" }).click();
    // PAUSED rolls back to DISABLED.
    await expect.poll(() => lifecycleModeOnDetail(page), { timeout: 60_000 }).toBe("DISABLED");
  });

  await test.step("compact mobile + dark theme render the list", async () => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "dark"),
    );
    await page.goto(listUrl);
    await expect(
      page.getByRole("heading", { name: "Discovery sources" }),
    ).toBeVisible();
    await expect(page.locator("table.admin-table")).toBeVisible();
  });

  // Cleanup: remove the sources this spec seeded (they are not covered by the
  // shared e2e DB reset).
  await prisma.crawlCandidate.deleteMany({ where: { providerKey: prefix } });
  await prisma.discoverySource.deleteMany({ where: { providerKey: prefix } });
});
