process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { mock, test } from "node:test";

const syntheticProvider = {
  key: "synthetic",
  urlIdentity: {
    canonicalHost: "www.example.com",
    amp: {
      hosts: ["www.example.com"],
      pathPrefixes: ["amp"],
      pathSuffixes: ["amp"],
    },
    trailingSlash: "add",
  },
};

mock.module("@/lib/scraper/providers", {
  namedExports: {
    providerForUrl: () => syntheticProvider,
    getProvider: () => syntheticProvider,
  },
});

test("provider identity policy folds AMP host, prefix, and added trailing slash", async () => {
  const { deriveProvisionalIdentity } = await import("@/lib/scraper/url-identity");

  assert.equal(
    deriveProvisionalIdentity("https://m.example.com/amp/story").normalizedUrl,
    "https://www.example.com/story/",
  );
  assert.equal(
    deriveProvisionalIdentity("https://m.example.com/amp").normalizedUrl,
    "https://www.example.com/",
  );
});

test("provider identity policy folds AMP suffixes with and without a trailing slash", async () => {
  const { deriveProvisionalIdentity } = await import("@/lib/scraper/url-identity");

  const canonical = deriveProvisionalIdentity("https://www.example.com/story");
  assert.equal(
    deriveProvisionalIdentity("https://www.example.com/story/amp").key,
    canonical.key,
  );
  assert.equal(
    deriveProvisionalIdentity("https://www.example.com/story/amp/").key,
    canonical.key,
  );
});
