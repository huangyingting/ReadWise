process.env.LOG_LEVEL = "error";

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns";

const originalLookup = dns.promises.lookup;

afterEach(() => {
  dns.promises.lookup = originalLookup;
});

test("SSRF hostname and pinning helpers report DNS and URL validation failures", async () => {
  const { assertSafeHostname, resolveAndPin } = await import("@/lib/scraper/ssrf");

  dns.promises.lookup = (async () => {
    throw new Error("dns down");
  }) as typeof dns.promises.lookup;
  await assert.rejects(() => assertSafeHostname("missing.example"), /dns_lookup_failed/);
  await assert.rejects(() => resolveAndPin("https://missing.example"), /dns_lookup_failed/);
  await assert.rejects(() => resolveAndPin("not a url"), /invalid_url/);

  dns.promises.lookup = (async () => []) as unknown as typeof dns.promises.lookup;
  await assert.rejects(() => resolveAndPin("https://empty.example"), /dns_no_addresses/);
});
