/**
 * Tests for the SSRF guard / IP-pinning helper (src/lib/scraper/ssrf.ts).
 * The DNS resolver is mocked so no real network/DNS is touched. Covers the
 * private/loopback/link-local/unique-local/metadata range checks (IPv4, IPv6
 * and IPv4-mapped IPv6) plus `resolveAndPin` validating EVERY resolved address
 * and rejecting a host that resolves to a private IP.
 */
process.env.LOG_LEVEL = "error";
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mutable mocked resolver --------------------------------------------
let lookupResult: { address: string; family: number }[] = [];
let lookupThrows = false;

before(() => {
  const fakeDns = {
    promises: {
      lookup: async (_host: string, opts?: { all?: boolean }) => {
        if (lookupThrows) throw new Error("ENOTFOUND");
        // `{ all: true }` (resolveAndPin) expects an array; the single form
        // (assertSafeHostname) expects one `{ address, family }` record.
        if (opts && opts.all) return lookupResult;
        return lookupResult[0] ?? { address: "0.0.0.0", family: 4 };
      },
    },
  };
  mock.module("node:dns", { defaultExport: fakeDns, namedExports: fakeDns });
});

beforeEach(() => {
  lookupResult = [];
  lookupThrows = false;
});

test("isPrivateIPv4 flags private/loopback/link-local/metadata ranges", async () => {
  const { isPrivateIPv4 } = await import("@/lib/scraper/ssrf");
  for (const ip of [
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254", // cloud metadata
    "172.16.5.4",
    "172.31.255.255",
    "192.168.1.1",
    "192.0.2.5",
    "198.51.100.9",
    "203.0.113.7",
    "240.0.0.1",
    "not-an-ip",
  ]) {
    assert.equal(isPrivateIPv4(ip), true, `${ip} should be private`);
  }
  for (const ip of ["8.8.8.8", "93.184.216.34", "1.1.1.1", "172.15.0.1", "172.32.0.1"]) {
    assert.equal(isPrivateIPv4(ip), false, `${ip} should be public`);
  }
});

test("isPrivateIPv6 flags loopback/unique-local/link-local", async () => {
  const { isPrivateIPv6 } = await import("@/lib/scraper/ssrf");
  for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1"]) {
    assert.equal(isPrivateIPv6(ip), true, `${ip} should be private`);
  }
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPrivateIPv6(ip), false, `${ip} should be public`);
  }
});

test("isPrivateAddress catches IPv4-mapped IPv6 metadata/loopback", async () => {
  const { isPrivateAddress } = await import("@/lib/scraper/ssrf");
  assert.equal(isPrivateAddress("::ffff:169.254.169.254"), true);
  assert.equal(isPrivateAddress("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false);
  assert.equal(isPrivateAddress("[::1]"), true);
});

test("resolveAndPin returns a validated address for a public host", async () => {
  const { resolveAndPin } = await import("@/lib/scraper/ssrf");
  lookupResult = [{ address: "93.184.216.34", family: 4 }];
  const pin = await resolveAndPin("https://example.com/article");
  assert.deepEqual(pin, { ip: "93.184.216.34", family: 4 });
});

test("resolveAndPin rejects a host that resolves to a private IP (rebinding)", async () => {
  const { resolveAndPin } = await import("@/lib/scraper/ssrf");
  lookupResult = [{ address: "169.254.169.254", family: 4 }];
  await assert.rejects(resolveAndPin("https://rebind.example/"), /private\/internal addresses/);
});

test("resolveAndPin rejects if ANY of multiple addresses is private", async () => {
  const { resolveAndPin } = await import("@/lib/scraper/ssrf");
  lookupResult = [
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ];
  await assert.rejects(resolveAndPin("https://mixed.example/"), /private\/internal addresses/);
});

test("resolveAndPin pins the first validated address when all are public", async () => {
  const { resolveAndPin } = await import("@/lib/scraper/ssrf");
  lookupResult = [
    { address: "93.184.216.34", family: 4 },
    { address: "8.8.8.8", family: 4 },
  ];
  const pin = await resolveAndPin("https://multi.example/");
  assert.equal(pin.ip, "93.184.216.34");
  assert.equal(pin.family, 4);
});

test("resolveAndPin rejects non-http(s) schemes", async () => {
  const { resolveAndPin } = await import("@/lib/scraper/ssrf");
  await assert.rejects(resolveAndPin("file:///etc/passwd"), /Only http\(s\)/);
});

test("resolveAndPin throws when DNS resolution fails", async () => {
  const { resolveAndPin } = await import("@/lib/scraper/ssrf");
  lookupThrows = true;
  await assert.rejects(resolveAndPin("https://nxdomain.example/"), /DNS lookup failed/);
});

test("assertSafeUrl rejects non-http(s) protocols", async () => {
  const { assertSafeUrl } = await import("@/lib/scraper/ssrf");
  for (const url of [
    "file:///etc/passwd",
    "ftp://example.com/x",
    "gopher://example.com/",
    "data:text/html,<script>alert(1)</script>",
  ]) {
    await assert.rejects(assertSafeUrl(url), /Only http\(s\)/, `${url} should be rejected`);
  }
});

test("assertSafeUrl rejects a malformed URL", async () => {
  const { assertSafeUrl } = await import("@/lib/scraper/ssrf");
  await assert.rejects(assertSafeUrl("http://"), /Invalid URL/);
});

test("assertSafeUrl rejects a host resolving to a private/metadata IP", async () => {
  const { assertSafeUrl } = await import("@/lib/scraper/ssrf");
  lookupResult = [{ address: "169.254.169.254", family: 4 }];
  await assert.rejects(assertSafeUrl("https://rebind.example/"), /private\/internal addresses/);
});

test("assertSafeUrl resolves a public host without throwing", async () => {
  const { assertSafeUrl } = await import("@/lib/scraper/ssrf");
  lookupResult = [{ address: "93.184.216.34", family: 4 }];
  await assert.doesNotReject(assertSafeUrl("https://example.com/article"));
});
