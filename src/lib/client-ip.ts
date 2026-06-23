/**
 * Trusted-proxy aware client IP extraction (RW-027).
 *
 * Client IP is used for soft per-IP rate limiting and for audit / security
 * logging. Raw `X-Forwarded-For` is CLIENT-CONTROLLED and trivially spoofable
 * unless the deployment sits behind a reverse proxy that sets it correctly.
 *
 * This module resolves a trustworthy client IP from forwarding headers using a
 * configurable {@link trustedProxyConfig} model (see `docs/security.md`):
 *
 *   - `TRUSTED_PROXY_LIST`   — trusted proxy IPs/CIDRs. Walk the XFF chain from
 *                              the RIGHT, returning the first hop NOT in the set.
 *   - `TRUSTED_PROXY_HOPS`   — fixed number of trusted hops appended to XFF;
 *                              take the entry `len - 1 - hops` (counted from the
 *                              right) so spoofed extra LEFT hops are ignored.
 *   - `TRUSTED_PROXY_HEADER` — a single platform header (e.g. cf-connecting-ip)
 *                              the edge guarantees; trust it directly.
 *   - nothing configured     — SOFT best-effort: the leftmost XFF entry (current
 *                              behavior). Documented as spoofable.
 *
 * All extracted values are validated + normalized (IPv4, IPv6, IPv4-mapped
 * IPv6); malformed entries are dropped. This is the single source of truth for
 * "who is the client" — rate limiting and audit logging both consume it.
 */
import net from "node:net";
import { trustedProxyConfig } from "@/lib/config";

/** Platform single-value client-IP headers, in best-effort fallback order. */
const PLATFORM_HEADERS = ["cf-connecting-ip", "true-client-ip", "x-real-ip"] as const;

/** How the resolved client IP was derived (useful for security diagnostics). */
export type ClientIpSource =
  | "trusted-header"
  | "cidr-walk"
  | "hop-count"
  | "forwarded-leftmost"
  | "platform-header"
  | "none";

export type ResolvedClientIp = {
  /** The normalized client IP, or null when none could be determined. */
  ip: string | null;
  /** Which strategy produced the value. */
  source: ClientIpSource;
};

// ---------------------------------------------------------------------------
// Validation + normalization
// ---------------------------------------------------------------------------

/**
 * Validate + normalize a raw IP candidate. Strips surrounding brackets and any
 * appended port, collapses IPv4-mapped IPv6 (`::ffff:1.2.3.4`) to bare IPv4,
 * lower-cases IPv6, and returns null for anything that is not a valid IP.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;

  // Bracketed IPv6, optionally with a port: "[::1]" / "[::1]:443".
  const bracket = value.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket) {
    value = bracket[1].trim();
  } else if (value.includes(".") && value.includes(":") && !value.includes("::")) {
    // "1.2.3.4:5678" — strip the port only when the left side is valid IPv4 so
    // we never truncate a real IPv6 address (which legitimately contains ":").
    const left = value.slice(0, value.indexOf(":"));
    if (net.isIPv4(left)) value = left;
  }
  value = value.trim();

  // IPv4-mapped IPv6 → bare IPv4 so a mapped address keys identically.
  const mapped = value.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mapped && net.isIPv4(mapped[1])) return mapped[1];

  const family = net.isIP(value);
  if (family === 4) return value;
  if (family === 6) return value.toLowerCase();
  return null;
}

/**
 * Parse an `X-Forwarded-For` header value into an ordered list of normalized
 * IPs (left = originating client, right = nearest proxy). Malformed entries are
 * dropped so a client cannot inject garbage to shift hop positions.
 */
export function parseForwardedFor(value: string | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const part of value.split(",")) {
    const ip = normalizeIp(part);
    if (ip) out.push(ip);
  }
  return out;
}

// ---------------------------------------------------------------------------
// CIDR matching (IPv4 + IPv6)
// ---------------------------------------------------------------------------

function ipv4ToBytes(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

function ipv6ToBytes(ip: string): number[] | null {
  let str = ip.toLowerCase();

  // Embedded IPv4 tail (e.g. "::ffff:1.2.3.4") → two trailing hextets.
  const tail = str.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (tail) {
    const v4 = ipv4ToBytes(tail[2]);
    if (!v4) return null;
    const hex = `${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
    str = tail[1] + hex;
  }

  const halves = str.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tailGroups = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];

  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - (head.length + tailGroups.length);
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tailGroups];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const n = parseInt(group, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

function ipToBytes(ip: string): number[] | null {
  const family = net.isIP(ip);
  if (family === 4) return ipv4ToBytes(ip);
  if (family === 6) return ipv6ToBytes(ip);
  return null;
}

/**
 * Whether `ip` is inside `cidr`. `cidr` may be a bare IP (exact match) or
 * `network/prefix`. IPv4 and IPv6 never match across families.
 */
export function ipInCidr(ip: string, cidr: string): boolean {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) return false;

  const slash = cidr.indexOf("/");
  if (slash === -1) {
    return normalizedIp === normalizeIp(cidr);
  }

  const network = normalizeIp(cidr.slice(0, slash));
  const prefix = Number(cidr.slice(slash + 1));
  if (!network || !Number.isInteger(prefix) || prefix < 0) return false;

  const ipBytes = ipToBytes(normalizedIp);
  const netBytes = ipToBytes(network);
  if (!ipBytes || !netBytes || ipBytes.length !== netBytes.length) return false;
  if (prefix > ipBytes.length * 8) return false;

  let bitsLeft = prefix;
  for (let i = 0; i < ipBytes.length; i++) {
    if (bitsLeft <= 0) break;
    const take = Math.min(8, bitsLeft);
    const mask = take === 0 ? 0 : (0xff << (8 - take)) & 0xff;
    if ((ipBytes[i] & mask) !== (netBytes[i] & mask)) return false;
    bitsLeft -= take;
  }
  return true;
}

/** Whether `ip` matches any trusted proxy IP/CIDR in `list`. */
export function isTrustedProxyIp(ip: string, list: string[]): boolean {
  return list.some((entry) => ipInCidr(ip, entry));
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the client IP from a request using the configured trusted-proxy
 * model. Returns the normalized IP plus the strategy that produced it.
 */
export function resolveClientIp(req: Request): ResolvedClientIp {
  const cfg = trustedProxyConfig();
  const xff = parseForwardedFor(req.headers.get("x-forwarded-for"));

  // 1) Explicit trusted platform header (most specific) — trust it directly.
  if (cfg.header) {
    const direct = normalizeIp(req.headers.get(cfg.header));
    if (direct) return { ip: direct, source: "trusted-header" };
  }

  // 2) Trusted CIDR list — walk right→left, return the first untrusted hop.
  if (cfg.list.length > 0 && xff.length > 0) {
    for (let i = xff.length - 1; i >= 0; i--) {
      if (!isTrustedProxyIp(xff[i], cfg.list)) {
        return { ip: xff[i], source: "cidr-walk" };
      }
    }
    // Every hop was a trusted proxy → the leftmost entry is the client.
    return { ip: xff[0], source: "cidr-walk" };
  }

  // 3) Fixed trusted hop count — entry `len - 1 - hops`, clamped at the left.
  if (cfg.hops !== null && xff.length > 0) {
    const index = xff.length - 1 - cfg.hops;
    return { ip: xff[index < 0 ? 0 : index], source: "hop-count" };
  }

  // 4) Unconfigured: SOFT best-effort. Prefer the leftmost XFF entry (current
  //    behavior), then any platform header, else nothing.
  if (xff.length > 0) return { ip: xff[0], source: "forwarded-leftmost" };
  for (const header of PLATFORM_HEADERS) {
    const value = normalizeIp(req.headers.get(header));
    if (value) return { ip: value, source: "platform-header" };
  }
  return { ip: null, source: "none" };
}

/** The resolved client IP for a request, or null when none is determinable. */
export function clientIp(req: Request): string | null {
  return resolveClientIp(req).ip;
}

/**
 * A stable rate-limit / dedup key derived from the client IP. Returns
 * `ip:<normalized>` or `ip:unknown` so the limiter degrades gracefully rather
 * than skipping when no IP can be determined.
 */
export function clientIpKey(req: Request): string {
  const ip = clientIp(req);
  return ip ? `ip:${ip}` : "ip:unknown";
}
