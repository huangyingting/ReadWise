process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { mock, test } from "node:test";

let derivationError: Error | null = null;

class MockUrlIdentityError extends Error {
  readonly code = "invalid-url";
}

mock.module("@/lib/scraper/providers", {
  namedExports: {
    getProvider: () => null,
  },
});
mock.module("@/lib/scraper/url-identity", {
  namedExports: {
    UrlIdentityError: MockUrlIdentityError,
    deriveCanonicalIdentity: () => {
      if (derivationError) throw derivationError;
      return {
        identityVersion: "v1",
        key: "v1:synthetic",
        normalizedUrl: "https://synthetic.example/article",
        providerKey: "unregistered-provider",
      };
    },
  },
});

test("final identity routes a stale provider registration to review", async () => {
  const { resolveFinalIdentity } = await import("@/lib/scraper/incremental/final-identity");

  const result = resolveFinalIdentity({
    owningProviderKey: "owner",
    finalUrl: "https://synthetic.example/article",
  });

  assert.equal(result.decision, "route-to-review");
  assert.equal(result.decision === "route-to-review" && result.reason, "unknown-cross-domain-canonical");
  assert.equal(result.decision === "route-to-review" && result.targetProviderKey, null);
  assert.equal(result.decision === "route-to-review" && result.identity?.providerKey, "unregistered-provider");
});

test("final identity propagates unexpected derivation failures", async () => {
  const { resolveFinalIdentity } = await import("@/lib/scraper/incremental/final-identity");
  derivationError = new Error("unexpected invariant failure");

  assert.throws(
    () =>
      resolveFinalIdentity({
        owningProviderKey: "owner",
        finalUrl: "https://synthetic.example/article",
      }),
    /unexpected invariant failure/,
  );
});
