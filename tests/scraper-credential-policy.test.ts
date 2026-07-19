import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideAuthenticatedActivation,
  isStableSecretFreeIdentity,
  parseAuthIdentityKind,
  pauseCategoryForCredentialFailure,
  type CredentialActivationInput,
} from "@/lib/scraper/incremental/credential-policy";
// AC4 is owned by the #1096 publication policy; reuse it here to prove that
// authenticated-fetch permission alone can NEVER make an Article public. This is
// a TEST-only cross-module import (src code respects the one-way boundary).
import { decideIncrementalPublication } from "@/lib/processing/publication-policy";

function activation(overrides: Partial<CredentialActivationInput> = {}) {
  const base: CredentialActivationInput = {
    canFetchAuthenticated: true,
    credentialRef: "PROVIDER_TOKEN_REF",
    authIdentityKind: "stable-provider-id",
  };
  return decideAuthenticatedActivation({ ...base, ...overrides });
}

// ---------------------------------------------------------------------------
// Activation eligibility (AC3)
// ---------------------------------------------------------------------------

test("public (non-authenticated) sources are always activation-eligible here", () => {
  // A public source's correctness gates live elsewhere; the credential gate is
  // a no-op and must NOT special-case it.
  const decision = activation({
    canFetchAuthenticated: false,
    credentialRef: null,
    authIdentityKind: null,
  });
  assert.equal(decision.eligible, true);
  assert.equal(decision.reason, "not-authenticated-source");
});

test("AC3: a signed-URL-only identity can NEVER be activated", () => {
  const decision = activation({ authIdentityKind: "signed-url-only" });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "signed-url-only-identity");
});

test("AC3: signed-URL-only is refused even WITH a credentialRef", () => {
  const decision = activation({
    authIdentityKind: "signed-url-only",
    credentialRef: "PROVIDER_TOKEN_REF",
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "signed-url-only-identity");
});

test("an authenticated source with no declared identity kind is refused conservatively", () => {
  const decision = activation({ authIdentityKind: null });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "identity-kind-unspecified");
});

test("an authenticated source with a stable identity but no credentialRef is refused", () => {
  const decision = activation({ credentialRef: null });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "credential-ref-missing");

  const empty = activation({ credentialRef: "" });
  assert.equal(empty.eligible, false);
  assert.equal(empty.reason, "credential-ref-missing");
});

test("a stable-identity authenticated source with a credentialRef is eligible", () => {
  for (const kind of ["stable-provider-id", "canonical-url"] as const) {
    const decision = activation({ authIdentityKind: kind });
    assert.equal(decision.eligible, true, kind);
    assert.equal(decision.reason, "eligible");
  }
});

// ---------------------------------------------------------------------------
// Identity-kind helpers
// ---------------------------------------------------------------------------

test("isStableSecretFreeIdentity accepts stable kinds and rejects signed-url/unknown", () => {
  assert.equal(isStableSecretFreeIdentity("stable-provider-id"), true);
  assert.equal(isStableSecretFreeIdentity("canonical-url"), true);
  assert.equal(isStableSecretFreeIdentity("signed-url-only"), false);
  assert.equal(isStableSecretFreeIdentity(null), false);
});

test("parseAuthIdentityKind narrows known values and rejects everything else", () => {
  assert.equal(parseAuthIdentityKind("stable-provider-id"), "stable-provider-id");
  assert.equal(parseAuthIdentityKind("canonical-url"), "canonical-url");
  assert.equal(parseAuthIdentityKind("signed-url-only"), "signed-url-only");
  assert.equal(parseAuthIdentityKind(null), null);
  assert.equal(parseAuthIdentityKind(undefined), null);
  assert.equal(parseAuthIdentityKind("https://provider.example/x?token=abc"), null);
  assert.equal(parseAuthIdentityKind(""), null);
});

// ---------------------------------------------------------------------------
// Pause categories (requirement 6) — sanitized labels only
// ---------------------------------------------------------------------------

test("pauseCategoryForCredentialFailure maps each status to a sanitized label", () => {
  assert.equal(pauseCategoryForCredentialFailure("missing"), "credential-missing");
  assert.equal(pauseCategoryForCredentialFailure("expired"), "credential-expired");
  assert.equal(pauseCategoryForCredentialFailure("rotated"), "credential-rotated");
});

// ---------------------------------------------------------------------------
// AC4 — authenticated fetch permission NEVER makes an Article public
// ---------------------------------------------------------------------------

test("AC4: authenticated fetch WITHOUT republication permission stays in review", () => {
  // Model a trusted provider that may auto-publish and passes every check, but
  // holds NO public-republication right. Even though it is authenticated to
  // fetch, the publication gate must keep the draft in review — fetch permission
  // is a separate grant and never publishes on its own.
  const decision = decideIncrementalPublication({
    trust: { autoPublishTrusted: true, canRepublishPublicly: false },
    checks: {
      bodyQualityOk: true,
      contentSafetyOk: true,
      sourceOwnershipOk: true,
      mandatoryMetadataOk: true,
    },
    requiredEnrichmentComplete: true,
  });
  assert.equal(decision.action, "leave-in-review");
  assert.equal(decision.reason, "public-republication-not-permitted");
});
