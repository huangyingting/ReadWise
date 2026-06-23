/**
 * Trusted-proxy aware client IP extraction (RW-027). Pure functions — no DB,
 * no network, no mocks; the trusted-proxy model is toggled via TRUSTED_PROXY_*
 * env vars per test.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIp,
  parseForwardedFor,
  ipInCidr,
  isTrustedProxyIp,
  resolveClientIp,
  clientIp,
  clientIpKey,
} from "@/lib/client-ip";

const TRUSTED_ENV = [
  "TRUSTED_PROXY_HOPS",
  "TRUSTED_PROXY_LIST",
  "TRUSTED_PROXY_HEADER",
] as const;

function clearTrustedEnv(): void {
  for (const key of TRUSTED_ENV) delete process.env[key];
}

beforeEach(clearTrustedEnv);

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://test/api/x", { headers });
}

// ---- normalizeIp ----------------------------------------------------------

test("normalizeIp accepts valid IPv4 and trims whitespace", () => {
  assert.equal(normalizeIp(" 203.0.113.7 "), "203.0.113.7");
});

test("normalizeIp rejects malformed addresses", () => {
  assert.equal(normalizeIp("not-an-ip"), null);
  assert.equal(normalizeIp("999.1.1.1"), null);
  assert.equal(normalizeIp("1.2.3"), null);
  assert.equal(normalizeIp(""), null);
  assert.equal(normalizeIp(undefined), null);
});

test("normalizeIp strips an IPv4 port but never truncates IPv6", () => {
  assert.equal(normalizeIp("203.0.113.7:54321"), "203.0.113.7");
  assert.equal(normalizeIp("2001:db8::1"), "2001:db8::1");
});

test("normalizeIp handles bracketed IPv6 with a port and lower-cases it", () => {
  assert.equal(normalizeIp("[2001:DB8::1]:443"), "2001:db8::1");
  assert.equal(normalizeIp("[::1]"), "::1");
});

test("normalizeIp collapses IPv4-mapped IPv6 to bare IPv4", () => {
  assert.equal(normalizeIp("::ffff:192.168.0.1"), "192.168.0.1");
  assert.equal(normalizeIp("::FFFF:203.0.113.9"), "203.0.113.9");
});

// ---- parseForwardedFor ----------------------------------------------------

test("parseForwardedFor splits, normalizes, and drops malformed entries", () => {
  assert.deepEqual(
    parseForwardedFor("203.0.113.1, garbage, 198.51.100.2 , 999.9.9.9"),
    ["203.0.113.1", "198.51.100.2"],
  );
  assert.deepEqual(parseForwardedFor(null), []);
  assert.deepEqual(parseForwardedFor(""), []);
});

// ---- ipInCidr / isTrustedProxyIp ------------------------------------------

test("ipInCidr matches IPv4 CIDR ranges and exact IPs", () => {
  assert.equal(ipInCidr("10.1.2.3", "10.0.0.0/8"), true);
  assert.equal(ipInCidr("11.0.0.1", "10.0.0.0/8"), false);
  assert.equal(ipInCidr("192.168.1.5", "192.168.1.0/24"), true);
  assert.equal(ipInCidr("192.168.2.5", "192.168.1.0/24"), false);
  assert.equal(ipInCidr("203.0.113.7", "203.0.113.7"), true);
  assert.equal(ipInCidr("203.0.113.8", "203.0.113.7"), false);
});

test("ipInCidr matches IPv6 CIDR ranges and never crosses families", () => {
  assert.equal(ipInCidr("2001:db8::1", "2001:db8::/32"), true);
  assert.equal(ipInCidr("2001:db9::1", "2001:db8::/32"), false);
  assert.equal(ipInCidr("2001:db8::1", "10.0.0.0/8"), false);
  assert.equal(ipInCidr("10.0.0.1", "2001:db8::/32"), false);
});

test("isTrustedProxyIp returns true when any list entry matches", () => {
  const list = ["10.0.0.0/8", "203.0.113.5"];
  assert.equal(isTrustedProxyIp("10.9.9.9", list), true);
  assert.equal(isTrustedProxyIp("203.0.113.5", list), true);
  assert.equal(isTrustedProxyIp("198.51.100.1", list), false);
});

// ---- resolveClientIp: unconfigured (soft best-effort) ---------------------

test("unconfigured: returns the leftmost X-Forwarded-For entry (soft)", () => {
  const res = resolveClientIp(reqWith({ "x-forwarded-for": "203.0.113.1, 70.0.0.2" }));
  assert.deepEqual(res, { ip: "203.0.113.1", source: "forwarded-leftmost" });
});

test("unconfigured: malformed XFF entries are skipped, leftmost valid wins", () => {
  const res = resolveClientIp(reqWith({ "x-forwarded-for": "garbage, 203.0.113.4" }));
  assert.equal(res.ip, "203.0.113.4");
});

test("unconfigured: falls back to a platform header, then null", () => {
  assert.equal(clientIp(reqWith({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
  assert.equal(clientIp(reqWith({})), null);
  assert.equal(clientIpKey(reqWith({})), "ip:unknown");
});

// ---- resolveClientIp: trusted hop count -----------------------------------

test("hops: picks the entry left of the trusted proxy hops (counted from right)", () => {
  process.env.TRUSTED_PROXY_HOPS = "1";
  // Chain: client, CDN  → app peer is the LB (not in XFF). 1 trusted hop (CDN).
  const res = resolveClientIp(reqWith({ "x-forwarded-for": "203.0.113.1, 70.0.0.2" }));
  assert.deepEqual(res, { ip: "203.0.113.1", source: "hop-count" });
});

test("hops: a spoofed extra LEFT hop is ignored", () => {
  process.env.TRUSTED_PROXY_HOPS = "1";
  // Attacker injects a fake leftmost IP; the real client is appended by the CDN.
  const res = resolveClientIp(
    reqWith({ "x-forwarded-for": "1.1.1.1, 203.0.113.1, 70.0.0.2" }),
  );
  assert.equal(res.ip, "203.0.113.1");
  assert.notEqual(res.ip, "1.1.1.1");
});

test("hops=0: trusts only the rightmost XFF entry (single load balancer)", () => {
  process.env.TRUSTED_PROXY_HOPS = "0";
  const res = resolveClientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }));
  assert.equal(res.ip, "203.0.113.9");
});

test("hops: clamps to the leftmost entry when the chain is shorter than expected", () => {
  process.env.TRUSTED_PROXY_HOPS = "3";
  const res = resolveClientIp(reqWith({ "x-forwarded-for": "203.0.113.1" }));
  assert.equal(res.ip, "203.0.113.1");
});

// ---- resolveClientIp: trusted CIDR list -----------------------------------

test("list: returns the rightmost untrusted hop, skipping trusted proxies", () => {
  process.env.TRUSTED_PROXY_LIST = "10.0.0.0/8, 70.0.0.2";
  const res = resolveClientIp(
    reqWith({ "x-forwarded-for": "203.0.113.1, 10.1.1.1, 70.0.0.2" }),
  );
  assert.deepEqual(res, { ip: "203.0.113.1", source: "cidr-walk" });
});

test("list: a spoofed untrusted hop on the right is NOT trusted", () => {
  process.env.TRUSTED_PROXY_LIST = "10.0.0.0/8";
  // Only the real proxy (10.x) is trusted; the injected 1.1.1.1 to the left is
  // never reached because the walk stops at the first untrusted hop from the
  // right — here the rightmost untrusted entry is the real client.
  const res = resolveClientIp(
    reqWith({ "x-forwarded-for": "1.1.1.1, 203.0.113.1, 10.0.0.5" }),
  );
  assert.equal(res.ip, "203.0.113.1");
});

// ---- resolveClientIp: trusted platform header -----------------------------

test("header: trusts the configured platform header directly", () => {
  process.env.TRUSTED_PROXY_HEADER = "cf-connecting-ip";
  const res = resolveClientIp(
    reqWith({
      "cf-connecting-ip": "203.0.113.50",
      "x-forwarded-for": "1.1.1.1, 2.2.2.2",
    }),
  );
  assert.deepEqual(res, { ip: "203.0.113.50", source: "trusted-header" });
});

test("header: falls through to XFF when the trusted header is absent", () => {
  process.env.TRUSTED_PROXY_HEADER = "cf-connecting-ip";
  const res = resolveClientIp(reqWith({ "x-forwarded-for": "203.0.113.1" }));
  assert.equal(res.ip, "203.0.113.1");
});

// ---- clientIpKey ----------------------------------------------------------

test("clientIpKey returns ip:<normalized> and normalizes mapped IPv6", () => {
  assert.equal(clientIpKey(reqWith({ "x-forwarded-for": "::ffff:203.0.113.7" })), "ip:203.0.113.7");
});
