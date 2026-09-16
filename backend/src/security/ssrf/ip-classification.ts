import net from 'node:net';

/**
 * IPv4 ranges that must never be reachable from a server-side fetch: this
 * host's own loopback, RFC1918 private space, and link-local
 * (includes cloud metadata endpoints at 169.254.169.254).
 */
const IPV4_PRIVATE_RANGES: ReadonlyArray<readonly [base: string, prefixLength: number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
];

function ipv4ToInt(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isIpv4InCidr(ip: string, base: string, prefixLength: number): boolean {
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

export function isIpv4Private(ip: string): boolean {
  return IPV4_PRIVATE_RANGES.some(([base, prefixLength]) => isIpv4InCidr(ip, base, prefixLength));
}

const IPV4_MAPPED_IPV6 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/;
/** fe80::/10 — link-local. */
const IPV6_LINK_LOCAL = /^fe[89ab][0-9a-f]:/;
/** fc00::/7 — unique local (the IPv6 analogue of RFC1918 private space). */
const IPV6_UNIQUE_LOCAL = /^f[cd][0-9a-f]{2}:/;

export function isIpv6Private(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (normalized === '::1' || normalized === '::') return true;

  const mappedMatch = normalized.match(IPV4_MAPPED_IPV6);
  if (mappedMatch) return isIpv4Private(mappedMatch[1]!);

  return IPV6_LINK_LOCAL.test(normalized) || IPV6_UNIQUE_LOCAL.test(normalized);
}

/** True for loopback/private/link-local/reserved addresses, in either family. */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isIpv4Private(ip);
  if (net.isIPv6(ip)) return isIpv6Private(ip);
  // Not a recognizable IP literal at all — fail closed rather than let
  // something unexpected through.
  return true;
}
