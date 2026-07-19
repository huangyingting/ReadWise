import { randomUUID } from "node:crypto";

import { type Page } from "@playwright/test";

import { prisma } from "@/lib/prisma";
import {
  CrawlCandidateStatus,
  DiscoverySourceLifecycleMode,
  DiscoverySourceRole,
} from "@prisma/client";

import { expect, test, MOBILE_VIEWPORT } from "./support/fixtures";

type SeededSource = { id: string; providerKey: string; sourceKey: string };

async function seedActiveSource(providerKey: string, sourceKey: string): Promise<SeededSource> {
  const source = await prisma.discoverySource.create({
    data: {
      providerKey,
      sourceKey,
      definitionVersion: 1,
      role: DiscoverySourceRole.PRIMARY_FEED,
      lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    },
  });
  return { id: source.id, providerKey: source.providerKey, sourceKey: source.sourceKey };
}

/** An eligible, untrusted snapshot the promote-flow steps mock. */
function eligibleSnapshot(source: SeededSource) {
  const evidence = {
    sampleSize: 40,
    acceptedCount: 36,
    reviewRejectedCount: 2,
    decidedCount: 38,
    approvalRate: 0.947,
    oldItemFalsePositives: 0,
    oldItemFalsePositiveRate: 0,
    drift: {
      zeroDiscoveryStreak: 0,
      consecutiveFailures: 0,
      volumeAnomaly: "none",
      conflictRate: 0,
      oldItemFalsePositives: 0,
    },
  };
  return {
    source: {
      id: source.id,
      providerKey: source.providerKey,
      sourceKey: source.sourceKey,
      definitionVersion: 1,
      lifecycleMode: "ACTIVE",
      policy: { autoPublishTrusted: false, canRepublishPublicly: false, canFetchAuthenticated: false },
      evidence,
      eligibility: { eligible: true, blockers: [], warnings: [], evidence },
    },
  };
}

async function mockTrustGet(page: Page, source: SeededSource): Promise<void> {
  await page.route(`**/api/admin/discovery-sources/${source.id}/trust`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(eligibleSnapshot(source)),
      });
      return;
    }
    await route.fallback();
  });
}

test("@high-risk admin source trust: evidence, eligibility gating + promote states", async ({
  adminPage: page,
}) => {
  test.setTimeout(240_000);

  const prefix = `e2e-trust-${randomUUID().slice(0, 8)}`;
  const source = await seedActiveSource(prefix, "trust-feed");
  // A handful of undecided candidates → below the promotion bar (deterministic:
  // decidedCount 0 < 10 and sampleSize < 20 → two hard blockers).
  for (let i = 0; i < 6; i++) {
    await prisma.crawlCandidate.create({
      data: {
        providerKey: prefix,
        discoverySourceId: source.id,
        provisionalKey: `1:${randomUUID().replace(/-/g, "")}`,
        status: CrawlCandidateStatus.NEEDS_REVIEW,
      },
    });
  }

  const detailUrl = `/admin/discovery-sources/${source.id}`;

  await test.step("trust panel reports evidence + blocks promotion for an unproven source", async () => {
    await page.goto(detailUrl);
    await expect(page.getByRole("heading", { name: "Source trust & promotion" })).toBeVisible();
    // Current policy badge + evidence are shown.
    await expect(page.getByText("Untrusted").first()).toBeVisible();
    await expect(page.getByText("Sample size").first()).toBeVisible();
    await expect(page.getByText("Approval rate").first()).toBeVisible();
    await expect(page.getByText("Drift evidence").first()).toBeVisible();
    // Not eligible → blockers listed and promote disabled.
    await expect(page.getByText("Promotion blocked")).toBeVisible();
    await expect(page.getByText("Not enough reviewed decisions yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Promote to trusted" })).toBeDisabled();
    // Not trusted → demote disabled.
    await expect(page.getByRole("button", { name: "Demote" })).toBeDisabled();
  });

  await test.step("an eligible source can be promoted with a required reason (mocked)", async () => {
    await mockTrustGet(page, source);
    await page.route(`**/api/admin/discovery-sources/${source.id}/trust`, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, action: "promote", changed: true, definitionVersion: 1, before: false, after: true }),
        });
        return;
      }
      await route.fallback();
    });
    await page.goto(detailUrl);
    const promote = page.getByRole("button", { name: "Promote to trusted" });
    await expect(promote).toBeEnabled();
    await promote.click();
    const confirm = page.getByRole("button", { name: "Confirm promote" });
    await expect(confirm).toBeDisabled();
    await page.getByRole("textbox").fill("proven: 94.7% approval over 38 decisions, no old-item leaks");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByText(/Source promoted/)).toBeVisible();
  });

  await test.step("a version-mismatch (409) prompts a refetch rather than a hard error", async () => {
    await mockTrustGet(page, source);
    await page.route(`**/api/admin/discovery-sources/${source.id}/trust`, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "Definition changed under you", reason: "version-mismatch" }),
        });
        return;
      }
      await route.fallback();
    });
    await page.goto(detailUrl);
    await page.getByRole("button", { name: "Promote to trusted" }).click();
    await page.getByRole("textbox").fill("attempt against a stale definition version");
    await page.getByRole("button", { name: "Confirm promote" }).click();
    await expect(page.getByText(/Refreshing/)).toBeVisible();
  });

  await test.step("keyboard: the promote control is focusable", async () => {
    await mockTrustGet(page, source);
    await page.goto(detailUrl);
    const promote = page.getByRole("button", { name: "Promote to trusted" });
    await promote.focus();
    await expect(promote).toBeFocused();
  });

  await test.step("compact mobile + dark theme render the trust panel", async () => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.goto(detailUrl);
    await expect(page.getByRole("heading", { name: "Source trust & promotion" })).toBeVisible();
  });

  // Cleanup: this spec's rows are NOT covered by the shared e2e DB reset.
  await prisma.crawlCandidate.deleteMany({ where: { providerKey: prefix } });
  await prisma.discoverySource.deleteMany({ where: { providerKey: prefix } });
});
