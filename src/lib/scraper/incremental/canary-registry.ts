/** Idempotent persistence sync for the checked-in discovery canary registry. */
import { prisma } from "@/lib/prisma";
import {
  assertNoCanaryAutoActivates,
  CANARIES,
  type CanaryDefinition,
} from "@/lib/scraper/incremental/canaries";

export type CanaryRegistrySyncResult = {
  synced: number;
};

async function syncCanary(canary: CanaryDefinition): Promise<void> {
  const codeOwnedConfig = {
    role: canary.role,
    automationPolicy: canary.automationPolicy,
    pollIntervalSeconds: canary.pollIntervalSeconds,
    discoveryBudgetPerRun: canary.discoveryBudgetPerRun,
  };

  await prisma.discoverySource.upsert({
    where: {
      providerKey_sourceKey_definitionVersion: {
        providerKey: canary.providerKey,
        sourceKey: canary.sourceKey,
        definitionVersion: canary.definitionVersion,
      },
    },
    create: {
      providerKey: canary.providerKey,
      sourceKey: canary.sourceKey,
      definitionVersion: canary.definitionVersion,
      lifecycleMode: canary.seedLifecycleMode,
      ...codeOwnedConfig,
    },
    update: codeOwnedConfig,
  });
}

/**
 * Makes every checked-in canary visible to operators. Existing runtime state is
 * preserved: only code-owned schedule/config fields are refreshed, and a new
 * row always starts DISABLED so startup can never activate network work.
 */
export async function syncCanaryDiscoverySources(
  canaries: readonly CanaryDefinition[] = CANARIES,
): Promise<CanaryRegistrySyncResult> {
  assertNoCanaryAutoActivates(canaries);
  await Promise.all(canaries.map(syncCanary));
  return { synced: canaries.length };
}
