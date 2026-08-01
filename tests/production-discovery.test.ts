process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import type { DiscoveryFetch } from "@/lib/scraper/fetch";
import type { DiscoverySource } from "@prisma/client";

function source(providerKey: string, sourceKey: string): DiscoverySource {
  return {
    providerKey,
    sourceKey,
  } as DiscoverySource;
}

test("production discovery routes a registered source and forwards cancellation", async () => {
  const { createProductionDiscoveryFetcher } = await import(
    "@/lib/scraper/incremental/production-discovery"
  );
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const fetchResponse: DiscoveryFetch = async (_url, init) => {
    receivedSignal = init?.signal;
    return {
      outcome: "ok",
      status: 200,
      finalUrl: "https://theconversation.com/articles.atom",
      body: "<feed><entry><link href=\"https://theconversation.com/example\"/><published>2026-07-30T00:00:00Z</published></entry></feed>",
      notModified: false,
      validators: {},
      headers: {},
    };
  };
  const fetchPage = createProductionDiscoveryFetcher({ fetchResponse });

  const page = await fetchPage({
    source: source("theconversation", "canary-rss"),
    signal: controller.signal,
  });

  assert.equal(receivedSignal, controller.signal);
  assert.equal(page.boundaryReached, true);
  assert.ok(Array.isArray(page.items));
});

test("production discovery fails closed for an unregistered source", async () => {
  const { createProductionDiscoveryFetcher } = await import(
    "@/lib/scraper/incremental/production-discovery"
  );
  const fetchPage = createProductionDiscoveryFetcher({
    fetchResponse: async () => { throw new Error("must not fetch"); },
  });

  await assert.rejects(
    () => fetchPage({ source: source("unknown-provider", "unknown-source") }),
    { message: "no production discovery adapter registered for source" },
  );
});
