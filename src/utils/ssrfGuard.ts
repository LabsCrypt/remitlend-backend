import dns from "node:dns/promises";
import net from "node:net";

/**
 * SSRF guard for outbound webhook callback URLs.
 *
 * See docs/webhook-url-policy.md for the full allowed/blocked policy.
 *
 * Blocks callback URLs that:
 *  - use a scheme other than http/https
 *  - resolve to loopback, link-local, RFC1918 (private), or other reserved
 *    IP ranges (e.g. cloud metadata at 169.254.169.254).
 */

export class SsrfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfValidationError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Returns true when the given IP literal falls inside a blocked range.
 * Covers loopback, link-local, RFC1918, and other reserved/non-routable space
 * for both IPv4 and IPv6 (including IPv4-mapped IPv6 addresses).
 */
export function isBlockedIp(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 4) {
    return isBlockedIpv4(ip);
  }
  if (type === 6) {
    return isBlockedIpv6(ip);
  }
  // Not a valid IP literal — treat as blocked to be safe.
  return true;
}

function isBlockedIpv4(ip: string): boolean {
  const octets = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o))) {
    return true;
  }
  const [a, b] = octets as [number, number, number, number];

  // 0.0.0.0/8 — "this" network
  if (a === 0) return true;
  // 10.0.0.0/8 — RFC1918 private
  if (a === 10) return true;
  // 100.64.0.0/10 — carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local (incl. 169.254.169.254 metadata)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — RFC1918 private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 & 192.0.2.0/24 — IETF protocol assignments / TEST-NET-1
  if (a === 192 && b === 0) return true;
  // 192.168.0.0/16 — RFC1918 private
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 — benchmarking
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved (incl. 255.255.255.255)
  if (a >= 224) return true;

  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split("%")[0] ?? "";

  // Unspecified ::
  if (normalized === "::") return true;
  // Loopback ::1
  if (normalized === "::1") return true;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — re-check as IPv4.
  const mapped = normalized.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) {
    return isBlockedIpv4(mapped[1]);
  }
  // Unique local addresses fc00::/7
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  // Link-local fe80::/10
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }

  return false;
}

/**
 * Parses and validates the callback URL scheme/shape only.
 * Throws SsrfValidationError on an invalid or disallowed URL.
 */
export function parseCallbackUrl(callbackUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    throw new SsrfValidationError("callbackUrl must be a valid URL");
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new SsrfValidationError("callbackUrl must use http or https");
  }

  return parsed;
}

/**
 * Fully validates a callback URL: scheme check, then DNS resolution with a
 * block on any resolved address in a reserved/private range.
 *
 * Call this both at registration time and immediately before delivery
 * (the delivery-time call defends against DNS rebinding).
 *
 * Throws SsrfValidationError when the URL or any resolved address is disallowed.
 */
export async function assertCallbackUrlAllowed(
  callbackUrl: string,
): Promise<void> {
  const parsed = parseCallbackUrl(callbackUrl);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  // If the host is already an IP literal, validate it directly.
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new SsrfValidationError(
        "callbackUrl resolves to a blocked (private/reserved) address",
      );
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new SsrfValidationError("callbackUrl host could not be resolved");
  }

  if (addresses.length === 0) {
    throw new SsrfValidationError("callbackUrl host could not be resolved");
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new SsrfValidationError(
        "callbackUrl resolves to a blocked (private/reserved) address",
      );
    }
  }
}
