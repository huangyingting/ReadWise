/**
 * Focused factories for the incremental discovery ledger (#1081).
 *
 * These builders create DiscoverySource / CrawlCandidate / UrlAlias /
 * DiscoveryObservation / CanonicalConflict rows with sane defaults so tests can
 * exercise creation, uniqueness collisions, and the deletion-safe candidate
 * invariant without repeating boilerplate. Every row is created under the
 * integration PREFIX (via `id()`) so the shared cleanup sweep removes it.
 *
 * METADATA ONLY: identity keys are opaque sanitized strings, never raw URLs.
 * Overrides are typed against the Prisma "unchecked" create inputs so scalar
 * foreign keys (`candidateId`, `discoverySourceId`, `articleId`) can be set
 * directly.
 */
import {
  type Prisma,
  CandidateDateProvenance,
  CanonicalConflictStatus,
  CrawlCandidateStatus,
  DiscoveryAutomationPolicy,
  DiscoveryGapState,
  DiscoverySourceHealth,
  DiscoverySourceLifecycleMode,
  DiscoverySourceRole,
  UrlAliasKind,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { id } from "./db-helpers";

/** A PREFIX-scoped provider key so ledger rows are swept by cleanup. */
export function providerKey(label = "provider"): string {
  return id(label);
}

export async function createDiscoverySource(
  overrides: Partial<Prisma.DiscoverySourceUncheckedCreateInput> = {},
) {
  return prisma.discoverySource.create({
    data: {
      id: id("discovery_source"),
      providerKey: providerKey(),
      sourceKey: "primary",
      definitionVersion: 1,
      role: DiscoverySourceRole.PRIMARY_FEED,
      lifecycleMode: DiscoverySourceLifecycleMode.DISABLED,
      automationPolicy: DiscoveryAutomationPolicy.MANUAL,
      health: DiscoverySourceHealth.UNKNOWN,
      gapState: DiscoveryGapState.NONE,
      ...overrides,
    },
  });
}

export async function createCrawlCandidate(
  overrides: Partial<Prisma.CrawlCandidateUncheckedCreateInput> = {},
) {
  return prisma.crawlCandidate.create({
    data: {
      id: id("crawl_candidate"),
      providerKey: overrides.providerKey ?? providerKey(),
      identityVersion: 1,
      provisionalKey: id("provisional"),
      status: CrawlCandidateStatus.DISCOVERED,
      observedInBaseline: false,
      dateProvenance: CandidateDateProvenance.UNKNOWN,
      ...overrides,
    },
  });
}

export async function createUrlAlias(
  candidateId: string,
  provider: string,
  overrides: Partial<Prisma.UrlAliasUncheckedCreateInput> = {},
) {
  return prisma.urlAlias.create({
    data: {
      id: id("url_alias"),
      candidateId,
      providerKey: provider,
      identityVersion: 1,
      aliasKey: id("alias"),
      kind: UrlAliasKind.PROVISIONAL,
      ...overrides,
    },
  });
}

export async function createDiscoveryObservation(
  discoverySourceId: string,
  overrides: Partial<Prisma.DiscoveryObservationUncheckedCreateInput> = {},
) {
  return prisma.discoveryObservation.create({
    data: {
      id: id("discovery_observation"),
      discoverySourceId,
      identityVersion: 1,
      observationKey: id("observation"),
      ...overrides,
    },
  });
}

export async function createCanonicalConflict(
  provider: string,
  overrides: Partial<Prisma.CanonicalConflictUncheckedCreateInput> = {},
) {
  return prisma.canonicalConflict.create({
    data: {
      id: id("canonical_conflict"),
      providerKey: provider,
      identityVersion: 1,
      canonicalKey: id("canonical"),
      challengerKey: id("challenger"),
      status: CanonicalConflictStatus.OPEN,
      ...overrides,
    },
  });
}
