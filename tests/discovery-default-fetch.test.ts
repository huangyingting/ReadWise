process.env.LOG_LEVEL = "error";

import { before, mock, test } from "node:test";
import assert from "node:assert/strict";

before(() => {
  mock.module("@/lib/scraper/fetch", {
    namedExports: {
      fetchHtml: async () => "html-payload",
      fetchText: async () => "text-payload",
    },
  });
  mock.module("@/lib/scraper/sources", {
    namedExports: {
      isProviderEnabled: async () => true,
    },
  });
  mock.module("@/lib/scraper/robots", {
    namedExports: {
      isUrlAllowed: async () => true,
    },
  });
  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => ({ warn: () => {}, info: () => {}, error: () => {} }),
    },
  });
});

test("discovery default extractor fetch uses fetchText for non-GET and fetchHtml for GET", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/discovery");
  const provider = {
    key: "default-fetch",
    name: "Default Fetch",
    hostnames: ["demo.example"],
    seeds: [],
    articleUrlPattern: /^https:\/\/demo\.example\/article\/[a-z]+$/i,
    defaultCategory: "science",
    urlExtractor: async ({ fetch }: { fetch: (url: string, init?: { method?: string }) => Promise<string> }) => {
      assert.equal(await fetch("https://demo.example/api", { method: "POST" }), "text-payload");
      assert.equal(await fetch("https://demo.example/page"), "html-payload");
      return ["https://demo.example/article/one"];
    },
  };

  assert.deepEqual(await discoverProviderUrls(provider, 2), [
    "https://demo.example/article/one",
  ]);
});

test("seed discovery stops a seed when the page fetch fails", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/discovery");
  const provider = {
    key: "seed-fail",
    name: "Seed Fail",
    hostnames: ["demo.example"],
    seeds: ["https://demo.example/seed"],
    articleUrlPattern: /^https:\/\/demo\.example\/article\/[a-z]+$/i,
    defaultCategory: "science",
  };

  assert.deepEqual(
    await discoverProviderUrls(provider, 2, {
      fetchHtml: async () => {
        throw new Error("seed fetch failed");
      },
    }),
    [],
  );
});
