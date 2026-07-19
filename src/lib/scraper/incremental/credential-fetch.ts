/**
 * Authenticated body-fetch resolver seam (issue #1099, Phase 2.9).
 *
 * The body-fetch integration point between a source's secret-free authentication
 * metadata (`canFetchAuthenticated` + `credentialRef`) and the SSRF-safe fetch
 * layer. It consults the injectable {@link CredentialResolver} at request time
 * and returns, IN MEMORY, either:
 *   - the auth material to attach to the outbound request (an Authorization
 *     header or a signed URL), which the caller applies and immediately discards,
 *     never persisting or logging it; or
 *   - a sanitized {@link CredentialPauseCategory} instructing the worker to PAUSE
 *     ONLY the affected source (via {@link pauseSourceForCredentialFailure}).
 *
 * HONEST SCOPE: per #1095 the production body-fetch runner (`runIngestAttempt`)
 * is OFF by default (the ledger stores hashed identity keys, not fetchable URLs),
 * so this is a TESTED RESOLVER SEAM + its guards, awaiting the production
 * body-fetch wiring — it does NOT perform end-to-end body ingestion.
 */
import {
  DiscoverySourceHealth,
  DiscoverySourceLifecycleMode,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";

import type { CredentialResolver } from "../credential-resolver";
import {
  pauseCategoryForCredentialFailure,
  type CredentialPauseCategory,
} from "./credential-policy";

const log = createLogger("discovery-credential");

/**
 * The outcome of preparing an authenticated request. `authorized: true` carries
 * the in-memory auth material (or `kind: "none"` for a public source). The
 * material is NEVER persisted/logged by this seam; the caller attaches it to the
 * outbound request and discards it. `authorized: false` carries only a sanitized
 * pause category (never a secret / URL / header).
 */
export type AuthenticatedFetchPreparation =
  | { authorized: true; kind: "none" }
  | { authorized: true; kind: "header"; headerName: "authorization"; headerValue: string }
  | { authorized: true; kind: "signed-url"; signedUrl: string }
  | { authorized: false; pauseCategory: CredentialPauseCategory };

/** The secret-free source fields this seam reads (never selects a secret). */
export type AuthenticatedSource = {
  canFetchAuthenticated: boolean;
  credentialRef: string | null;
};

/**
 * Resolves the auth material for a source's body fetch, IN MEMORY, using the
 * injected resolver. A public source (`canFetchAuthenticated === false`) needs no
 * auth. An authenticated source with no persisted `credentialRef` is treated as a
 * `credential-missing` failure (there is nothing to resolve). Otherwise the
 * resolver is consulted; a failure maps to a sanitized pause category via the
 * pure policy, and a success returns the header/signed URL for this request only.
 *
 * NEVER logs or returns the secret, header value, or signed URL on the failure
 * path; the success path returns the material to the caller but does not persist
 * or log it here.
 */
export function prepareAuthenticatedFetch(
  source: AuthenticatedSource,
  resolver: CredentialResolver,
): AuthenticatedFetchPreparation {
  if (!source.canFetchAuthenticated) {
    return { authorized: true, kind: "none" };
  }
  if (source.credentialRef == null || source.credentialRef.length === 0) {
    return { authorized: false, pauseCategory: "credential-missing" };
  }

  const resolved = resolver.resolve(source.credentialRef);
  if (!resolved.ok) {
    return {
      authorized: false,
      pauseCategory: pauseCategoryForCredentialFailure(resolved.status),
    };
  }
  if (resolved.kind === "header") {
    return {
      authorized: true,
      kind: "header",
      headerName: resolved.headerName,
      headerValue: resolved.headerValue,
    };
  }
  return { authorized: true, kind: "signed-url", signedUrl: resolved.signedUrl };
}

/** Result of the guarded credential-failure pause. */
export type CredentialPauseResult =
  | { paused: false; reason: "lease-lost" }
  | { paused: true; category: CredentialPauseCategory };

/**
 * PAUSES ONLY the affected source after a credential resolution failure, under
 * the SAME guarded (lease + definitionVersion) update the discovery run uses to
 * release its lease. It flips `lifecycleMode` to PAUSED, clears `nextRunAt` (so
 * the claim predicate never re-picks it) and the lease, marks health FAILING,
 * and records the SANITIZED category in `lastError`. It touches NOTHING else:
 * candidates, aliases, observations, Jobs, and other sources are untouched (so an
 * article is never marked absent/policy-rejected, and no other source is paused).
 * A zero-row guarded update (lease lost/stolen) pauses nothing.
 *
 * The `category` is a controlled label; no secret, URL, token, signed URL, or
 * header is ever written or logged.
 */
export async function pauseSourceForCredentialFailure(params: {
  sourceId: string;
  leaseOwner: string | null;
  definitionVersion: number;
  category: CredentialPauseCategory;
  now?: Date;
}): Promise<CredentialPauseResult> {
  const now = params.now ?? new Date();
  const updated = await prisma.discoverySource.updateMany({
    where: {
      id: params.sourceId,
      leaseOwner: params.leaseOwner,
      definitionVersion: params.definitionVersion,
    },
    data: {
      lifecycleMode: DiscoverySourceLifecycleMode.PAUSED,
      health: DiscoverySourceHealth.FAILING,
      nextRunAt: null,
      leaseOwner: null,
      leaseAcquiredAt: null,
      leaseExpiresAt: null,
      lastError: params.category,
      updatedAt: now,
    },
  });
  if (updated.count === 0) return { paused: false, reason: "lease-lost" };
  log.warn("discovery source paused for credential failure", {
    sourceId: params.sourceId,
    category: params.category,
  });
  return { paused: true, category: params.category };
}
