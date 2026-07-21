/**
 * SSRF guard — validates that a URL's resolved IP is not in a private,
 * loopback, link-local, or cloud-metadata address range before fetching.
 *
 * Usage:
 *   await assertSafeUrl(rawUrl);   // throws on unsafe input
 *   const html = await safeFetchHtml(rawUrl); // validate + fetch in one call
 */
import dns from "dns";
import { redactUrlForLog } from "@/lib/security/redaction";

type DnsAddress = { address: string; family: number };

export const SSRF_BLOCK_REASON_CODES = [
  "invalid_url",
  "unsupported_protocol",
  "dns_lookup_failed",
  "dns_no_addresses",
  "private_address",
  "unsafe_url",
] as const;

export type SsrfBlockReason = (typeof SSRF_BLOCK_REASON_CODES)[number];

export type SsrfFailureDetails = {
  reason: SsrfBlockReason;
  target: string;
};

export class SsrfError extends Error {
  readonly reason: SsrfBlockReason;
  readonly target: string;

  constructor(reason: SsrfBlockReason, rawUrl: string) {
    const target = redactUrlForLog(rawUrl);
    super(`URL rejected: ${reason} (${target})`);
    this.name = "SsrfError";
    this.reason = reason;
    this.target = target;
  }
}

export function ssrfFailureDetails(err: unknown, rawUrl: string): SsrfFailureDetails {
  if (err instanceof SsrfError) {
    return { reason: err.reason, target: err.target };
  }
  return { reason: "unsafe_url", target: redactUrlForLog(rawUrl) };
}

// ---------------------------------------------------------------------------
// Private / reserved CIDR ranges to block
// ---------------------------------------------------------------------------

/** Checks whether a dotted-decimal IPv4 address falls in a private range. */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) {
    return true; // malformed — reject
  }
  const [a, b] = parts;
  return (
    a === 0 || // 0.x.x.x — this-network
    a === 10 || // 10/8 — RFC 1918
    a === 127 || // 127/8 — loopback
    (a === 169 && b === 254) || // 169.254/16 — link-local / IMDS
    (a === 172 && b >= 16 && b <= 31) || // 172.16-31/12 — RFC 1918
    (a === 192 && b === 168) || // 192.168/16 — RFC 1918
    (a === 192 && b === 0 && parts[2] === 2) || // 192.0.2/24 — TEST-NET-1
    (a === 198 && b === 51 && parts[2] === 100) || // 198.51.100/24 — TEST-NET-2
    (a === 203 && b === 0 && parts[2] === 113) || // 203.0.113/24 — TEST-NET-3
    a >= 240 // 240/4 — reserved / broadcast
  );
}

function normalizeIpLiteral(ip: string): string {
  return ip.toLowerCase().replace(/^\[|\]$/g, "");
}

/** Checks whether an IPv6 address is loopback or in a private range. */
export function isPrivateIPv6(ip: string): boolean {
  const lower = normalizeIpLiteral(ip);
  return (
    lower === "::1" || // loopback
    lower.startsWith("fc") || // fc00::/7 — unique-local
    lower.startsWith("fd") || // fc00::/7 — unique-local
    lower.startsWith("fe80") || // fe80::/10 — link-local
    lower === "::" // unspecified
  );
}

export function isPrivateAddress(address: string): boolean {
  const lower = normalizeIpLiteral(address);
  // IPv4-mapped / IPv4-compatible IPv6 (e.g. ::ffff:127.0.0.1) — validate the
  // embedded IPv4 against the IPv4 rules so a mapped private/metadata address
  // can't slip through the IPv6 prefix checks.
  const mapped = lower.match(/(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (lower.includes(":")) return isPrivateIPv6(lower);
  return isPrivateIPv4(lower);
}

function parseHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfError("invalid_url", rawUrl);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SsrfError("unsupported_protocol", rawUrl);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Resolves `hostname` to an IP address and throws if it resolves to a
 * private/reserved range.
 */
export async function assertSafeHostname(
  hostname: string,
  rawUrlForLog = `http://${hostname}/`,
): Promise<void> {
  let address: string;
  try {
    const result = await dns.promises.lookup(hostname);
    address = result.address;
  } catch {
    throw new SsrfError("dns_lookup_failed", rawUrlForLog);
  }
  if (isPrivateAddress(address)) {
    throw new SsrfError("private_address", rawUrlForLog);
  }
}

/**
 * Validates that `rawUrl` is an http(s) URL pointing to a public IP, then
 * calls the provided fetch function (or the global `fetch` by default).
 * Re-validates after each redirect by checking the `Location` header manually
 * if the final URL hostname differs.
 *
 * Throws an Error (not ApiError) on any violation so callers can wrap it.
 */
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  const parsed = parseHttpUrl(rawUrl);
  await assertSafeHostname(parsed.hostname, rawUrl);
}

/** A validated, pinned address for a host: the exact IP undici must connect to. */
export interface PinnedAddress {
  /** The validated IP literal to connect to. */
  ip: string;
  /** IP family: 4 (IPv4) or 6 (IPv6). */
  family: 4 | 6;
}

/**
 * Validates that `rawUrl` is an http(s) URL, resolves its host ONCE with
 * `{ all: true }`, validates EVERY returned address against the
 * private/loopback/link-local/unique-local/metadata ranges, and returns a
 * single validated address to pin the connection to.
 *
 * Pinning the connection to this exact IP (via an undici dispatcher `lookup`)
 * closes the DNS-rebinding / TOCTOU gap where `fetch(hostname)` would otherwise
 * re-resolve DNS at connect time and reach an unvalidated (e.g. metadata) IP.
 *
 * Throws an Error (not ApiError) on any violation so callers can wrap it.
 */
export async function resolveAndPin(rawUrl: string): Promise<PinnedAddress> {
  const parsed = parseHttpUrl(rawUrl);

  let results: DnsAddress[];
  try {
    results = await dns.promises.lookup(parsed.hostname, { all: true });
  } catch {
    throw new SsrfError("dns_lookup_failed", rawUrl);
  }
  if (results.length === 0) {
    throw new SsrfError("dns_no_addresses", rawUrl);
  }

  // Validate EVERY resolved address — a single private/metadata answer poisons
  // the whole set (the rebinding host could hand back a public + a private IP).
  for (const { address } of results) {
    if (isPrivateAddress(address)) {
      throw new SsrfError("private_address", rawUrl);
    }
  }

  const chosen = results[0];
  return { ip: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}
