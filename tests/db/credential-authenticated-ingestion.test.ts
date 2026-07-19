/**
 * credentialRef-based authenticated provider ingestion integration tests
 * (#1099, Phase 2.9).
 *
 * Engine-agnostic like `publication-gate.test.ts` / `candidate-ingest-enqueue.test.ts`:
 * runs on SQLite by default under `npm run test:db` and PostgreSQL in CI, guarded
 * by `enabled` (RUN_DB_INTEGRATION=1). Proves against the LIVE database:
 *
 *   - credentialRef / authIdentityKind default NULL, are secret-free, and persist.
 *   - AC1: after an authenticated flow, NO credential/token/signed URL appears in
 *     DiscoverySource / candidate / alias / observation / Job / CrawlRun rows,
 *     Job payloads, or captured logs — only the credentialRef NAME + sanitized
 *     categories persist.
 *   - AC2: rotating the secret behind a FIXED credentialRef rewrites NO candidate
 *     or Job and lets the paused source resume cleanly.
 *   - AC3: a source whose identity is only a signed URL cannot be ACTIVATED.
 *   - Requirement 6: a credential failure PAUSES ONLY the affected source with a
 *     sanitized category, leaving candidates/observations and other sources
 *     untouched.
 */
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import {
  CrawlCandidateStatus,
  DiscoverySourceLifecycleMode,
  JobStatus,
  JobType,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  CANDIDATE_INGEST_PROCESSING_VERSION,
  buildCandidateIngestPayload,
  candidateIngestDedupeKey,
} from "@/lib/jobs/candidate-ingest";
import { applyLifecycleAction } from "@/lib/scraper/incremental/lifecycle-actions";
import {
  pauseSourceForCredentialFailure,
  prepareAuthenticatedFetch,
} from "@/lib/scraper/incremental/credential-fetch";
import {
  buildAuthorizationHeaderValue,
  type CredentialResolver,
  type ResolvedCredential,
} from "@/lib/scraper/credential-resolver";

import { enabled } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";
import { createCrawlCandidate, createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const { SHADOW, ACTIVE, PAUSED } = DiscoverySourceLifecycleMode;
const LEASE = "worker-1099";

// A sentinel secret that must NEVER appear on any persisted or logged surface.
const SENTINEL = "s3nt1nel-SECRET-TOKEN-1099-do-not-leak";

// Job ids created here are keyed on the candidate cuid (not the PREFIX), so the
// shared sweep cannot reach them — track + delete explicitly (a known pollution
// trap for candidate-ingest dedupe keys).
const createdJobIds = new Set<string>();

afterEach(async () => {
  if (!enabled) return;
  const jobIds = [...createdJobIds];
  if (jobIds.length > 0) {
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    createdJobIds.clear();
  }
});

class FakeResolver implements CredentialResolver {
  secrets: Map<string, ResolvedCredential>;

  constructor(initial: Record<string, ResolvedCredential> = {}) {
    this.secrets = new Map(Object.entries(initial));
  }

  resolve(credentialRef: string): ResolvedCredential {
    return this.secrets.get(credentialRef) ?? { ok: false, status: "missing" };
  }
}

function headerResult(secret: string): ResolvedCredential {
  return {
    ok: true,
    kind: "header",
    headerName: "authorization",
    headerValue: buildAuthorizationHeaderValue(secret),
  };
}

function captureConsole(t: { mock: typeof mock }): string[] {
  const lines: string[] = [];
  const push = (message?: unknown) => lines.push(String(message ?? ""));
  t.mock.method(console, "log", push);
  t.mock.method(console, "warn", push);
  t.mock.method(console, "error", push);
  return lines;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

test("credentialRef + authIdentityKind default null and persist secret-free", { skip: !enabled }, async () => {
  const plain = await createDiscoverySource();
  assert.equal(plain.credentialRef, null);
  assert.equal(plain.authIdentityKind, null);

  const configured = await createDiscoverySource({
    canFetchAuthenticated: true,
    credentialRef: "PROVIDER_TOKEN_REF",
    authIdentityKind: "stable-provider-id",
  });
  const reloaded = await prisma.discoverySource.findUniqueOrThrow({ where: { id: configured.id } });
  assert.equal(reloaded.credentialRef, "PROVIDER_TOKEN_REF");
  assert.equal(reloaded.authIdentityKind, "stable-provider-id");
  // The stored ref is a NAME, never the secret value.
  assert.ok(!reloaded.credentialRef!.includes(SENTINEL));
});

// ---------------------------------------------------------------------------
// AC3 — activation eligibility
// ---------------------------------------------------------------------------

test("AC3: a signed-URL-only authenticated source cannot be activated", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    lifecycleMode: SHADOW,
    baselineCompletedAt: new Date("2024-01-01T00:00:00.000Z"),
    canFetchAuthenticated: true,
    credentialRef: "PROVIDER_TOKEN_REF",
    authIdentityKind: "signed-url-only",
  });

  const result = await applyLifecycleAction(source.id, "activate");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "auth-identity-ineligible");
  assert.equal(result.credentialEligibility, "signed-url-only-identity");

  const row = await prisma.discoverySource.findUniqueOrThrow({ where: { id: source.id } });
  assert.equal(row.lifecycleMode, SHADOW, "source must remain shadowed");
});

test("a stable-identity authenticated source WITH a credentialRef activates", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    lifecycleMode: SHADOW,
    baselineCompletedAt: new Date("2024-01-01T00:00:00.000Z"),
    canFetchAuthenticated: true,
    credentialRef: "PROVIDER_TOKEN_REF",
    authIdentityKind: "canonical-url",
  });

  const result = await applyLifecycleAction(source.id, "activate");
  assert.equal(result.ok, true);

  const row = await prisma.discoverySource.findUniqueOrThrow({ where: { id: source.id } });
  assert.equal(row.lifecycleMode, ACTIVE);
});

// ---------------------------------------------------------------------------
// Requirement 6 — pause ONLY the affected source, sanitized category
// ---------------------------------------------------------------------------

test("credential failure pauses ONLY the affected source, preserving candidates + peers", { skip: !enabled }, async () => {
  const affected = await createDiscoverySource({
    lifecycleMode: ACTIVE,
    leaseOwner: LEASE,
    canFetchAuthenticated: true,
    credentialRef: "AFFECTED_REF",
    authIdentityKind: "stable-provider-id",
  });
  const peer = await createDiscoverySource({
    lifecycleMode: ACTIVE,
    leaseOwner: "worker-peer",
    canFetchAuthenticated: true,
    credentialRef: "PEER_REF",
    authIdentityKind: "stable-provider-id",
  });
  const candidate = await createCrawlCandidate({
    providerKey: affected.providerKey,
    discoverySourceId: affected.id,
    status: CrawlCandidateStatus.QUEUED,
  });

  const resolver = new FakeResolver({ AFFECTED_REF: { ok: false, status: "expired" } });
  const prep = prepareAuthenticatedFetch(
    { canFetchAuthenticated: affected.canFetchAuthenticated, credentialRef: affected.credentialRef },
    resolver,
  );
  assert.deepEqual(prep, { authorized: false, pauseCategory: "credential-expired" });
  if (prep.authorized) return;

  const paused = await pauseSourceForCredentialFailure({
    sourceId: affected.id,
    leaseOwner: LEASE,
    definitionVersion: affected.definitionVersion,
    category: prep.pauseCategory,
  });
  assert.deepEqual(paused, { paused: true, category: "credential-expired" });

  const affectedRow = await prisma.discoverySource.findUniqueOrThrow({ where: { id: affected.id } });
  assert.equal(affectedRow.lifecycleMode, PAUSED);
  assert.equal(affectedRow.leaseOwner, null);
  assert.equal(affectedRow.nextRunAt, null);
  assert.equal(affectedRow.lastError, "credential-expired");
  // The credentialRef NAME is retained (the secret behind it changes, not this).
  assert.equal(affectedRow.credentialRef, "AFFECTED_REF");

  // Peer source is UNTOUCHED (only the affected source paused).
  const peerRow = await prisma.discoverySource.findUniqueOrThrow({ where: { id: peer.id } });
  assert.equal(peerRow.lifecycleMode, ACTIVE);
  assert.equal(peerRow.leaseOwner, "worker-peer");

  // The candidate is preserved: not marked absent / policy-rejected.
  const candRow = await prisma.crawlCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
  assert.equal(candRow.status, CrawlCandidateStatus.QUEUED);
  assert.equal(candRow.terminalReason, null);
});

// ---------------------------------------------------------------------------
// AC2 — rotation requires no candidate/job rewrite + clean resume
// ---------------------------------------------------------------------------

test("AC2: rotating the secret behind a fixed credentialRef rewrites nothing and resumes cleanly", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    lifecycleMode: PAUSED,
    leaseOwner: null,
    nextRunAt: null,
    baselineCompletedAt: new Date("2024-01-01T00:00:00.000Z"),
    canFetchAuthenticated: true,
    credentialRef: "ROTATION_REF",
    authIdentityKind: "stable-provider-id",
    lastError: "credential-expired",
  });
  const candidate = await createCrawlCandidate({
    providerKey: source.providerKey,
    discoverySourceId: source.id,
    status: CrawlCandidateStatus.QUEUED,
  });
  const dedupeKey = candidateIngestDedupeKey(candidate.id, CANDIDATE_INGEST_PROCESSING_VERSION);
  const job = await prisma.job.create({
    data: {
      type: JobType.ARTICLE_INGEST,
      status: JobStatus.PENDING,
      payload: buildCandidateIngestPayload(candidate.id),
      errorHistory: [],
      dedupeKey,
    },
  });
  createdJobIds.add(job.id);

  // Rotate the SECRET behind the SAME credentialRef (the ref string is unchanged).
  const resolver = new FakeResolver({ ROTATION_REF: { ok: false, status: "rotated" } });
  assert.deepEqual(
    prepareAuthenticatedFetch(
      { canFetchAuthenticated: true, credentialRef: source.credentialRef },
      resolver,
    ),
    { authorized: false, pauseCategory: "credential-rotated" },
  );
  resolver.secrets.set("ROTATION_REF", headerResult(SENTINEL));
  const afterRotation = prepareAuthenticatedFetch(
    { canFetchAuthenticated: true, credentialRef: source.credentialRef },
    resolver,
  );
  assert.equal(afterRotation.authorized, true);

  // Resume the paused source — no rewrite of the credentialRef required.
  const resumed = await applyLifecycleAction(source.id, "resume");
  assert.equal(resumed.ok, true);
  const row = await prisma.discoverySource.findUniqueOrThrow({ where: { id: source.id } });
  assert.equal(row.lifecycleMode, SHADOW);
  assert.equal(row.credentialRef, "ROTATION_REF");
  assert.equal(row.authIdentityKind, "stable-provider-id");

  // The candidate + job are NOT rewritten by the rotation/resume.
  const candRow = await prisma.crawlCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
  assert.equal(candRow.id, candidate.id);
  assert.equal(candRow.status, CrawlCandidateStatus.QUEUED);
  assert.equal(candRow.provisionalKey, candidate.provisionalKey);
  assert.equal(candRow.updatedAt.getTime(), candidate.updatedAt.getTime());

  const jobRow = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(jobRow.dedupeKey, dedupeKey);
  assert.equal(jobRow.status, JobStatus.PENDING);

  const jobCountForCandidate = await prisma.job.count({ where: { dedupeKey } });
  assert.equal(jobCountForCandidate, 1, "no new/rewritten job for the candidate");
});

// ---------------------------------------------------------------------------
// AC1 — secret scan across every persisted + logged surface
// ---------------------------------------------------------------------------

test("AC1: no secret/token/signed URL appears in any row, Job payload, or log", { skip: !enabled }, async (t) => {
  const logs = captureConsole(t);

  const source = await createDiscoverySource({
    lifecycleMode: ACTIVE,
    leaseOwner: LEASE,
    canFetchAuthenticated: true,
    credentialRef: "SCAN_REF",
    authIdentityKind: "stable-provider-id",
  });
  const candidate = await createCrawlCandidate({
    providerKey: source.providerKey,
    discoverySourceId: source.id,
    status: CrawlCandidateStatus.QUEUED,
  });
  const dedupeKey = candidateIngestDedupeKey(candidate.id, CANDIDATE_INGEST_PROCESSING_VERSION);
  const job = await prisma.job.create({
    data: {
      type: JobType.ARTICLE_INGEST,
      status: JobStatus.PENDING,
      payload: buildCandidateIngestPayload(candidate.id),
      errorHistory: [],
      dedupeKey,
    },
  });
  createdJobIds.add(job.id);

  // A SUCCESSFUL authenticated resolution: the sentinel secret + signed URL exist
  // ONLY in memory here; they must never be persisted or logged.
  const signedUrl = `https://provider.example/media/42?token=${SENTINEL}&sig=xyz`;
  const resolver = new FakeResolver({
    SCAN_REF: { ok: true, kind: "signed-url", signedUrl },
  });
  const prep = prepareAuthenticatedFetch(
    { canFetchAuthenticated: true, credentialRef: source.credentialRef },
    resolver,
  );
  assert.equal(prep.authorized, true);

  // A FAILING resolution → pause (records a sanitized category, never the secret).
  const failing = new FakeResolver({ SCAN_REF: { ok: false, status: "rotated" } });
  const failPrep = prepareAuthenticatedFetch(
    { canFetchAuthenticated: true, credentialRef: source.credentialRef },
    failing,
  );
  if (!failPrep.authorized) {
    await pauseSourceForCredentialFailure({
      sourceId: source.id,
      leaseOwner: LEASE,
      definitionVersion: source.definitionVersion,
      category: failPrep.pauseCategory,
    });
  }

  // Serialize every persisted surface for the PREFIX-scoped rows.
  const [sources, candidates, aliases, observations, jobs, runs] = await Promise.all([
    prisma.discoverySource.findMany({ where: { providerKey: { startsWith: "dbit_" } } }),
    prisma.crawlCandidate.findMany({ where: { providerKey: { startsWith: "dbit_" } } }),
    prisma.urlAlias.findMany({ where: { providerKey: { startsWith: "dbit_" } } }),
    prisma.discoveryObservation.findMany({ where: { discoverySourceId: source.id } }),
    prisma.job.findMany({ where: { id: { in: [...createdJobIds] } } }),
    prisma.crawlRun.findMany({ where: { providerKey: { startsWith: "dbit_" } } }),
  ]);

  const persisted = JSON.stringify({ sources, candidates, aliases, observations, jobs, runs });
  const logged = logs.join("\n");
  const surfaces = persisted + "\n" + logged;

  assert.ok(!surfaces.includes(SENTINEL), "sentinel secret must not appear anywhere");
  assert.ok(!surfaces.includes("Bearer "), "no Authorization header value anywhere");
  assert.ok(!surfaces.includes("token="), "no signed-URL token query anywhere");
  assert.ok(!surfaces.includes("sig=xyz"), "no signed-URL signature anywhere");
  assert.ok(!surfaces.includes("provider.example"), "no fetchable URL host anywhere");

  // Positive proof: only the credentialRef NAME + sanitized category persist.
  assert.ok(persisted.includes("SCAN_REF"), "the credentialRef NAME does persist");
  assert.ok(persisted.includes("credential-rotated"), "the sanitized pause category persists");
});
