/**
 * Rate-governor CONFIG assembly + worker wiring (#1094, Phase 2.4).
 *
 * The thin adapter between the runtime-config knobs (`runtime-config/scraper.ts`)
 * and the PURE governor (`rate-governor.ts`) / thin persistence
 * (`rate-governor-commit.ts`). Kept out of both so the pure module reads no env
 * and the persistence module takes explicit config. Also resolves the opaque
 * hostname KEY the shared budget is keyed on and derives in-flight concurrency
 * from currently-leased sources (self-healing across restart).
 *
 * PRIVACY: `hostKey` is a bare hostname (or providerKey fallback) — never a URL,
 * query string, or secret.
 */
import type { DiscoverySource } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getProvider } from "@/lib/scraper/providers";
import {
  scraperHostConcurrency,
  scraperHostMinIntervalMs,
  scraperHostDailyCeiling,
  scraperProviderDailyQuota,
  scraperDiscoveryDailyBudget,
  scraperBodyDailyBudget,
  scraperAiDailyBudget,
  scraperIncrementalReservedSlots,
  scraperBacklogCapacityThreshold,
  scraperHostErrorPauseThreshold,
  scraperHostPauseBaseMs,
  scraperHostPauseMaxMs,
} from "@/lib/runtime-config/scraper";

import type {
  BacklogConfig,
  BackoffConfig,
  HostnameBudgetConfig,
  ReservationConfig,
} from "./rate-governor";
import { reserveHostnameRequest } from "./rate-governor-commit";
import type { DiscoveryGovernorGate } from "./discovery-run";

/** Assembles the shared per-hostname budget config from the runtime knobs. */
export function hostnameBudgetConfigFromEnv(): HostnameBudgetConfig {
  return {
    maxConcurrency: scraperHostConcurrency(),
    minIntervalMs: scraperHostMinIntervalMs(),
    dailyCeiling: scraperHostDailyCeiling(),
  };
}

/** Assembles the incremental reserved-slot config from the runtime knobs. */
export function reservationConfigFromEnv(): ReservationConfig {
  return { incrementalReservedSlots: scraperIncrementalReservedSlots() };
}

/** Assembles the hostname auto-pause/backoff config from the runtime knobs. */
export function backoffConfigFromEnv(): BackoffConfig {
  return {
    errorThreshold: scraperHostErrorPauseThreshold(),
    basePauseMs: scraperHostPauseBaseMs(),
    maxPauseMs: scraperHostPauseMaxMs(),
  };
}

/** Assembles the backlog-throttle config from the runtime knobs. */
export function backlogConfigFromEnv(): BacklogConfig {
  return { capacityThreshold: scraperBacklogCapacityThreshold() };
}

/** The three per-UTC-day cost budgets from the runtime knobs. */
export function costBudgetsFromEnv(): { discovery: number; body: number; ai: number } {
  return {
    discovery: scraperDiscoveryDailyBudget(),
    body: scraperBodyDailyBudget(),
    ai: scraperAiDailyBudget(),
  };
}

/** The per-provider daily quota from the runtime knobs. */
export function providerDailyQuotaFromEnv(): number {
  return scraperProviderDailyQuota();
}

/**
 * Resolves the opaque hostname KEY the shared budget is keyed on for a provider.
 * A provider owns one or more hostnames; the first is the canonical shared-budget
 * key so discovery (RSS/sitemap) and body fetches to that publication draw from
 * ONE budget. Falls back to the providerKey when no provider is registered.
 */
export function resolveHostKey(providerKey: string): string {
  const provider = getProvider(providerKey);
  return provider?.hostnames[0] ?? providerKey;
}

/**
 * Derives the SHARED in-flight request count for a provider's hostname from
 * currently-leased discovery sources (ephemeral, self-healing across worker
 * restart), EXCLUDING `selfSourceId` (the source about to fetch). Body-fetch
 * in-flight is added by the #1095 pipeline when it lands.
 */
export async function deriveHostnameInFlight(params: {
  providerKey: string;
  selfSourceId: string;
  now: Date;
}): Promise<number> {
  const { providerKey, selfSourceId, now } = params;
  const leased = await prisma.discoverySource.count({
    where: {
      providerKey,
      leaseOwner: { not: null },
      leaseExpiresAt: { gt: now },
      id: { not: selfSourceId },
    },
  });
  return leased;
}

/**
 * Builds the real {@link DiscoveryGovernorGate} the worker injects into the
 * discovery run. It resolves the hostKey, derives shared in-flight from leased
 * sources, and reserves ONE shared hostname request slot at the discovery
 * (real-time incremental) priority tier. Discovery is always the `incremental`
 * tier here; historical backfill (a future #1080 concern) uses the `backfill`
 * tier so it can only draw on the non-reserved slots.
 */
export function makeDiscoveryGovernorGate(): DiscoveryGovernorGate {
  const config = hostnameBudgetConfigFromEnv();
  const reservation = reservationConfigFromEnv();
  return {
    reserve: async ({ source, now }: { source: DiscoverySource; now: Date }) => {
      const hostKey = resolveHostKey(source.providerKey);
      const inFlight = await deriveHostnameInFlight({
        providerKey: source.providerKey,
        selfSourceId: source.id,
        now,
      });
      return reserveHostnameRequest({
        hostKey,
        inFlight,
        requestClass: "discovery",
        priorityTier: "incremental",
        config,
        reservation,
        now,
      });
    },
  };
}
