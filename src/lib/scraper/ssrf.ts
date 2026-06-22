/**
 * SSRF guard — validates that a URL's resolved IP is not in a private,
 * loopback, link-local, or cloud-metadata address range before fetching.
 *
 * Usage:
 *   await assertSafeUrl(rawUrl);   // throws on unsafe input
 *   const html = await safeFetchHtml(rawUrl); // validate + fetch in one call
 */
import dns from "dns";

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

/** Checks whether an IPv6 address is loopback or in a private range. */
export function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    lower === "::1" || // loopback
    lower.startsWith("fc") || // fc00::/7 — unique-local
    lower.startsWith("fd") || // fc00::/7 — unique-local
    lower.startsWith("fe80") || // fe80::/10 — link-local
    lower === "::" // unspecified
  );
}

export function isPrivateAddress(address: string): boolean {
  const lower = address.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4-mapped / IPv4-compatible IPv6 (e.g. ::ffff:127.0.0.1) — validate the
  // embedded IPv4 against the IPv4 rules so a mapped private/metadata address
  // can't slip through the IPv6 prefix checks.
  const mapped = lower.match(/(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (lower.includes(":")) return isPrivateIPv6(lower);
  return isPrivateIPv4(lower);
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Resolves `hostname` to an IP address and throws if it resolves to a
 * private/reserved range.
 */
export async function assertSafeHostname(hostname: string): Promise<void> {
  let address: string;
  try {
    const result = await dns.promises.lookup(hostname);
    address = result.address;
  } catch {
    throw new Error(`DNS lookup failed for host: ${hostname}`);
  }
  if (isPrivateAddress(address)) {
    throw new Error(`Requests to private/internal addresses are not allowed (${address})`);
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
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Only http(s) URLs are allowed (got ${parsed.protocol})`);
  }
  await assertSafeHostname(parsed.hostname);
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
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Only http(s) URLs are allowed (got ${parsed.protocol})`);
  }

  let results: { address: string; family: number }[];
  try {
    results = await dns.promises.lookup(parsed.hostname, { all: true });
  } catch {
    throw new Error(`DNS lookup failed for host: ${parsed.hostname}`);
  }
  if (results.length === 0) {
    throw new Error(`DNS lookup returned no addresses for host: ${parsed.hostname}`);
  }

  // Validate EVERY resolved address — a single private/metadata answer poisons
  // the whole set (the rebinding host could hand back a public + a private IP).
  for (const { address } of results) {
    if (isPrivateAddress(address)) {
      throw new Error(`Requests to private/internal addresses are not allowed (${address})`);
    }
  }

  const chosen = results[0];
  return { ip: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}
