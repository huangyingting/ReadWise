import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideIncrementalPublication,
  resolveProviderTrust,
  resolveSourceOwnershipOk,
  type CandidateTrustView,
  type PublicationDecisionInput,
  type ProviderPublicationTrust,
  type RequiredCheckResults,
} from "@/lib/processing/publication-policy";

const ALL_CHECKS_OK: RequiredCheckResults = {
  bodyQualityOk: true,
  contentSafetyOk: true,
  sourceOwnershipOk: true,
  mandatoryMetadataOk: true,
};

const TRUSTED: ProviderPublicationTrust = {
  autoPublishTrusted: true,
  canRepublishPublicly: true,
};

function decide(overrides: Partial<PublicationDecisionInput> = {}) {
  const base: PublicationDecisionInput = {
    trust: TRUSTED,
    checks: ALL_CHECKS_OK,
    requiredEnrichmentComplete: true,
  };
  return decideIncrementalPublication({ ...base, ...overrides });
}

test("auto-publishes only when trusted + republish + all checks + required enrichment", () => {
  const decision = decide();
  assert.equal(decision.action, "auto-publish");
  assert.equal(decision.reason, "all-required-checks-passed");
});

test("untrusted provider ALWAYS leaves the draft in review, regardless of checks", () => {
  // AC1: an untrusted provider cannot gain auto-publication even with all
  // checks passing and full republication permission.
  const decision = decide({
    trust: { autoPublishTrusted: false, canRepublishPublicly: true },
  });
  assert.equal(decision.action, "leave-in-review");
  assert.equal(decision.reason, "provider-not-auto-publish-trusted");
});

test("authenticated-fetch WITHOUT republication permission can never auto-publish", () => {
  // AC3: even a trusted provider cannot auto-publish content it has no public
  // republication rights to (authenticated access alone never publishes).
  const decision = decide({
    trust: { autoPublishTrusted: true, canRepublishPublicly: false },
  });
  assert.equal(decision.action, "leave-in-review");
  assert.equal(decision.reason, "public-republication-not-permitted");
});

test("each failed required check leaves the draft in review with its reason", () => {
  const cases: Array<[keyof RequiredCheckResults, string]> = [
    ["bodyQualityOk", "required-check-failed:body-quality"],
    ["contentSafetyOk", "required-check-failed:content-safety"],
    ["sourceOwnershipOk", "required-check-failed:source-ownership"],
    ["mandatoryMetadataOk", "required-check-failed:mandatory-metadata"],
  ];
  for (const [key, reason] of cases) {
    const decision = decide({ checks: { ...ALL_CHECKS_OK, [key]: false } });
    assert.equal(decision.action, "leave-in-review", `${key} should block`);
    assert.equal(decision.reason, reason);
  }
});

test("incomplete required enrichment leaves the draft in review", () => {
  const decision = decide({ requiredEnrichmentComplete: false });
  assert.equal(decision.action, "leave-in-review");
  assert.equal(decision.reason, "required-enrichment-incomplete");
});

test("trust is evaluated before checks (most-significant blocker wins)", () => {
  // Untrusted AND failing checks → the trust reason is reported first.
  const decision = decide({
    trust: { autoPublishTrusted: false, canRepublishPublicly: false },
    checks: { ...ALL_CHECKS_OK, bodyQualityOk: false },
    requiredEnrichmentComplete: false,
  });
  assert.equal(decision.reason, "provider-not-auto-publish-trusted");
});

test("full policy matrix: only the all-true row auto-publishes", () => {
  const bools = [false, true];
  let autoPublishCount = 0;
  for (const autoPublishTrusted of bools) {
    for (const canRepublishPublicly of bools) {
      for (const bodyQualityOk of bools) {
        for (const contentSafetyOk of bools) {
          for (const sourceOwnershipOk of bools) {
            for (const mandatoryMetadataOk of bools) {
              for (const requiredEnrichmentComplete of bools) {
                const decision = decideIncrementalPublication({
                  trust: { autoPublishTrusted, canRepublishPublicly },
                  checks: {
                    bodyQualityOk,
                    contentSafetyOk,
                    sourceOwnershipOk,
                    mandatoryMetadataOk,
                  },
                  requiredEnrichmentComplete,
                });
                const allTrue =
                  autoPublishTrusted &&
                  canRepublishPublicly &&
                  bodyQualityOk &&
                  contentSafetyOk &&
                  sourceOwnershipOk &&
                  mandatoryMetadataOk &&
                  requiredEnrichmentComplete;
                if (allTrue) {
                  autoPublishCount += 1;
                  assert.equal(decision.action, "auto-publish");
                } else {
                  assert.equal(decision.action, "leave-in-review");
                }
              }
            }
          }
        }
      }
    }
  }
  // Exactly one combination (all flags true) may auto-publish.
  assert.equal(autoPublishCount, 1);
});

function candidate(overrides: Partial<CandidateTrustView> = {}): CandidateTrustView {
  return {
    providerKey: "provider-a",
    source: {
      providerKey: "provider-a",
      autoPublishTrusted: true,
      canRepublishPublicly: true,
    },
    ...overrides,
  };
}

test("resolveProviderTrust: no candidates ⇒ untrusted (non-incremental default)", () => {
  assert.deepEqual(resolveProviderTrust([]), {
    autoPublishTrusted: false,
    canRepublishPublicly: false,
  });
});

test("resolveProviderTrust: a single untrusted/orphaned candidate withholds the grant", () => {
  assert.deepEqual(
    resolveProviderTrust([candidate(), candidate({ source: null })]),
    { autoPublishTrusted: false, canRepublishPublicly: false },
  );
  assert.deepEqual(
    resolveProviderTrust([
      candidate(),
      candidate({
        source: { providerKey: "provider-b", autoPublishTrusted: false, canRepublishPublicly: true },
      }),
    ]),
    { autoPublishTrusted: false, canRepublishPublicly: true },
  );
});

test("resolveProviderTrust: all-trusted candidates grant both permissions", () => {
  assert.deepEqual(resolveProviderTrust([candidate(), candidate()]), {
    autoPublishTrusted: true,
    canRepublishPublicly: true,
  });
});

test("resolveSourceOwnershipOk: intact chain passes, orphan/mismatch fails", () => {
  assert.equal(resolveSourceOwnershipOk([]), false);
  assert.equal(resolveSourceOwnershipOk([candidate()]), true);
  assert.equal(resolveSourceOwnershipOk([candidate({ source: null })]), false);
  assert.equal(
    resolveSourceOwnershipOk([
      candidate({
        providerKey: "provider-a",
        source: { providerKey: "provider-b", autoPublishTrusted: true, canRepublishPublicly: true },
      }),
    ]),
    false,
  );
});
