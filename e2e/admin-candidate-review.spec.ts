import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import {
  CandidateDateProvenance,
  CanonicalConflictStatus,
  CrawlCandidateStatus,
  DiscoverySourceLifecycleMode,
  DiscoverySourceRole,
} from "@prisma/client";

import { expect, test, MOBILE_VIEWPORT, TEST_ARTICLE_ID } from "./support/fixtures";

type SeededSource = { id: string; providerKey: string; sourceKey: string };

async function seedSource(providerKey: string, sourceKey: string): Promise<SeededSource> {
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

function provisionalKey(): string {
  // Sanitized "<version>:<hex>" shape — NEVER a URL (mirrors the API contract).
  return `1:${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;
}

async function seedCandidate(
  source: SeededSource,
  overrides: Partial<{
    status: CrawlCandidateStatus;
    observedInBaseline: boolean;
    observationCount: number;
    terminalReason: string | null;
    dateProvenance: CandidateDateProvenance;
    articleId: string | null;
  }> = {},
): Promise<{ id: string; provisionalKey: string }> {
  const key = provisionalKey();
  const candidate = await prisma.crawlCandidate.create({
    data: {
      providerKey: source.providerKey,
      discoverySourceId: source.id,
      provisionalKey: key,
      status: overrides.status ?? CrawlCandidateStatus.NEEDS_REVIEW,
      observedInBaseline: overrides.observedInBaseline ?? false,
      observationCount: overrides.observationCount ?? 2,
      terminalReason: overrides.terminalReason ?? null,
      dateProvenance: overrides.dateProvenance ?? CandidateDateProvenance.FEED,
      articleId: overrides.articleId ?? null,
    },
  });
  return { id: candidate.id, provisionalKey: key };
}

/** The visible portion of a provisional key used to scope a table row. */
function keyFragment(key: string): string {
  return key.slice(0, 20);
}

test("@high-risk admin candidate review: queue, filters, actions, batch + states", async ({
  adminPage: page,
}) => {
  test.setTimeout(240_000);

  const prefix = `e2e-cand-${randomUUID().slice(0, 8)}`;
  const source = await seedSource(prefix, "review-feed");

  // Six plain NEEDS_REVIEW candidates + one linked to a public Article (blocked)
  // + one already-rejected (SKIPPED_REVIEW) for the reactivate/filter paths.
  const plain = [] as { id: string; provisionalKey: string }[];
  for (let i = 0; i < 6; i++) {
    plain.push(await seedCandidate(source, { observationCount: i + 1 }));
  }
  const blocked = await seedCandidate(source, {
    status: CrawlCandidateStatus.NEEDS_REVIEW,
    articleId: TEST_ARTICLE_ID,
  });
  const rejected = await seedCandidate(source, {
    status: CrawlCandidateStatus.SKIPPED_REVIEW,
    terminalReason: "duplicate of an existing article",
  });

  // A canonical conflict so the detail drawer renders conflict history.
  await prisma.canonicalConflict.create({
    data: {
      providerKey: prefix,
      canonicalKey: `canon:${randomUUID()}`,
      challengerKey: `chal:${randomUUID()}`,
      incumbentCandidateId: plain[0].id,
      status: CanonicalConflictStatus.OPEN,
      reason: "competing canonical identity",
    },
  });

  const listUrl = `/admin/candidates?providerKey=${encodeURIComponent(prefix)}`;

  await test.step("queue lists NEEDS_REVIEW candidates with sanitized provenance", async () => {
    await page.goto(listUrl);
    await expect(page.getByRole("heading", { name: "Candidate review" })).toBeVisible();
    const table = page.locator("table.admin-table");
    await expect(table).toBeVisible();
    // Sanitized provisional key is shown; never a URL.
    await expect(table.getByText(keyFragment(plain[0].provisionalKey)).first()).toBeVisible();
    await expect(page.getByText(/candidates ·/)).toBeVisible();
  });

  await test.step("a candidate linked to a public Article is hard-blocked (governing invariant)", async () => {
    const row = page.locator("tr", { hasText: keyFragment(blocked.provisionalKey) });
    await expect(row).toBeVisible();
    await expect(row.getByText("Linked article")).toBeVisible();
    // Its selection checkbox is disabled and it exposes no approve/reject action.
    await expect(row.locator('input[type="checkbox"]')).toBeDisabled();
    await expect(row.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
  });

  await test.step("empty state when no candidates match the filter", async () => {
    await page.goto(`/admin/candidates?providerKey=${prefix}-no-such-provider`);
    await expect(page.getByText("Nothing to review")).toBeVisible();
  });

  await test.step("status filter switches to the rejected (SKIPPED_REVIEW) queue", async () => {
    await page.goto(listUrl);
    await page.getByRole("radio", { name: "Rejected" }).click();
    const row = page.locator("tr", { hasText: keyFragment(rejected.provisionalKey) });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Reactivate" })).toBeVisible();
  });

  await test.step("detail drawer shows sanitized metadata + conflict history", async () => {
    await page.goto(listUrl);
    const row = page.locator("tr", { hasText: keyFragment(plain[0].provisionalKey) });
    await row.getByRole("button", { name: "Details" }).click();
    const drawer = page.getByRole("dialog", { name: "Candidate details" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Canonical conflicts (1)")).toBeVisible();
    await expect(drawer.getByText("competing canonical identity")).toBeVisible();
    await drawer.getByRole("button", { name: "Close details" }).click();
    await expect(drawer).toBeHidden();
  });

  await test.step("approve a single candidate routes it to ingest (real mutation)", async () => {
    await page.goto(listUrl);
    const row = page.locator("tr", { hasText: keyFragment(plain[0].provisionalKey) });
    await row.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /Approved/ }).first()).toBeVisible();
    // It leaves the NEEDS_REVIEW queue on refetch.
    await expect
      .poll(async () => {
        const c = await prisma.crawlCandidate.findUnique({ where: { id: plain[0].id } });
        return c?.status;
      }, { timeout: 30_000 })
      .toBe(CrawlCandidateStatus.QUEUED);
  });

  await test.step("reject requires an audit reason before it can be confirmed", async () => {
    await page.goto(listUrl);
    const row = page.locator("tr", { hasText: keyFragment(plain[1].provisionalKey) });
    await row.getByRole("button", { name: "Reject", exact: true }).click();
    const confirm = page.getByRole("button", { name: "Confirm reject" });
    await expect(confirm).toBeDisabled();
    await page.getByRole("textbox").fill("not relevant to our corpus");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByRole("status").filter({ hasText: /Rejected/ }).first()).toBeVisible();
    await expect
      .poll(async () => {
        const c = await prisma.crawlCandidate.findUnique({ where: { id: plain[1].id } });
        return c?.status;
      }, { timeout: 30_000 })
      .toBe(CrawlCandidateStatus.SKIPPED_REVIEW);
  });

  await test.step("bounded batch approve surfaces a per-item summary (real mutation)", async () => {
    await page.goto(listUrl);
    for (const c of [plain[2], plain[3]]) {
      const row = page.locator("tr", { hasText: keyFragment(c.provisionalKey) });
      await row.locator('input[type="checkbox"]').check();
    }
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.getByRole("button", { name: /Approve 2/ }).click();
    await expect(page.getByText(/approve: 2 applied/)).toBeVisible();
  });

  await test.step("stale (409) single review prompts a refetch", async () => {
    await page.goto(listUrl);
    await page.route(
      "**/api/admin/candidates/*/review",
      async (route) => {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "Candidate changed concurrently", reason: "stale", stale: true, status: "QUEUED" }),
        });
      },
      { times: 1 },
    );
    const row = page.locator("tr", { hasText: keyFragment(plain[4].provisionalKey) });
    await row.getByRole("button", { name: "Approve", exact: true }).click();
    const alert = page.getByRole("alert").filter({ hasText: /out of date/ });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("button", { name: "Refresh queue" })).toBeVisible();
  });

  await test.step("partial-batch outcome (mocked 200) surfaces applied/blocked/stale items", async () => {
    await page.goto(listUrl);
    await page.route(
      "**/api/admin/candidates/review",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            action: "approve",
            results: [
              { candidateId: plain[4].id, ok: true, outcome: "applied", fromStatus: "NEEDS_REVIEW", toStatus: "QUEUED", enqueued: true },
              { candidateId: plain[5].id, ok: false, reason: "stale", stale: true, status: "NEEDS_REVIEW" },
            ],
            summary: { total: 2, applied: 1, noop: 0, failed: 1 },
          }),
        });
      },
      { times: 1 },
    );
    for (const c of [plain[4], plain[5]]) {
      const row = page.locator("tr", { hasText: keyFragment(c.provisionalKey) });
      await row.locator('input[type="checkbox"]').check();
    }
    await page.getByRole("button", { name: /Approve 2/ }).click();
    await expect(page.getByText(/approve: 1 applied · 0 no-op · 1 failed/)).toBeVisible();
    await expect(page.getByText(/Changed concurrently/)).toBeVisible();
  });

  await test.step("keyboard: the first Details control is focusable", async () => {
    await page.goto(listUrl);
    const details = page.getByRole("button", { name: "Details" }).first();
    await details.focus();
    await expect(details).toBeFocused();
  });

  await test.step("compact mobile + dark theme render the queue", async () => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.goto(listUrl);
    await expect(page.getByRole("heading", { name: "Candidate review" })).toBeVisible();
    await expect(page.locator("table.admin-table")).toBeVisible();
  });

  // Cleanup: this spec's rows are NOT covered by the shared e2e DB reset.
  await prisma.canonicalConflict.deleteMany({ where: { providerKey: prefix } });
  await prisma.crawlCandidate.deleteMany({ where: { providerKey: prefix } });
  await prisma.discoverySource.deleteMany({ where: { providerKey: prefix } });
});
