/**
 * Where the platform's servers may connect on behalf of a customer (SSRF guard).
 * One classifier for every place that takes an address from a customer or from a page:
 * connectors with a customer-supplied URL or host, the worker's scraping browser.
 * Web-standard code only (it also runs in the Deno edge function): the DNS lookup is
 * injected by the caller as a `HostResolver`.
 */

/** Resolves a host name to every address it has (A and AAAA). Throws or returns [] when it has none. */
export type HostResolver = (hostname: string) => Promise<string[]>;

/** Parses a dotted IPv4 address into its four bytes; undefined when it is not one. */
function parseIpv4(text: string): number[] | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!match) return undefined;
  const bytes = match.slice(1).map(Number);
  return bytes.every((byte) => byte <= 255) ? bytes : undefined;
}

/** Parses an IPv6 address (with `::` and an optional dotted IPv4 tail) into 16 bytes. */
function parseIpv6(text: string): number[] | undefined {
  let source = text.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!source.includes(":")) return undefined;
  const tail = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(source);
  if (tail) {
    const v4 = parseIpv4(tail[2]!);
    if (!v4) return undefined;
    source = `${tail[1]}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return undefined;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = groups(halves[0]!);
  const rest = halves.length === 2 ? groups(halves[1]!) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  const bytes: number[] = [];
  for (const group of all) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return undefined;
    const value = Number.parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes.length === 16 ? bytes : undefined;
}

function isPublicIpv4(bytes: number[]): boolean {
  const [a, b, c] = bytes as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false; // "this network", private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT 100.64.0.0/10
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false; // documentation
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // documentation
  if (a === 203 && b === 0 && c === 113) return false; // documentation
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function isPublicIpv6(bytes: number[]): boolean {
  const zeroUntil = (end: number) => bytes.slice(0, end).every((byte) => byte === 0);
  const embedded = (offset: number) => isPublicIpv4(bytes.slice(offset, offset + 4));
  // ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d
  if (zeroUntil(12)) return false;
  // IPv4-mapped ::ffff:a.b.c.d
  if (zeroUntil(10) && bytes[10] === 0xff && bytes[11] === 0xff) return embedded(12);
  // NAT64 64:ff9b::/96 (and the local-use 64:ff9b:1::/48)
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return bytes.slice(4, 12).every((byte) => byte === 0) ? embedded(12) : false;
  }
  // 6to4 2002:a.b.c.d::/48
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return embedded(2);
  // Teredo 2001:0000::/32 and documentation 2001:db8::/32
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false;
  if ((bytes[0]! & 0xfe) === 0xfc) return false; // unique local fc00::/7
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return false; // link-local fe80::/10
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0) return false; // site-local fec0::/10 (deprecated)
  if (bytes[0] === 0xff) return false; // multicast
  return true;
}

/** True when the text is an IPv4 or IPv6 address (brackets allowed). */
export function isIpAddress(text: string): boolean {
  return Boolean(parseIpv4(text) ?? parseIpv6(text));
}

/**
 * True only for an address on the public internet. Private, loopback, link-local,
 * carrier-grade NAT, unique-local, IPv4-mapped/embedded private, unspecified, multicast,
 * reserved and documentation ranges are not public. Anything that is not an address is not public.
 */
export function isPublicAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4) return isPublicIpv4(v4);
  const v6 = parseIpv6(address);
  return v6 ? isPublicIpv6(v6) : false;
}

const INTERNAL_NAMES = new Set([
  "localhost",
  "host.docker.internal",
  "gateway.docker.internal",
  "kubernetes.docker.internal",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "kubernetes",
  "kubernetes.default",
  "kubernetes.default.svc",
]);
const INTERNAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".home.arpa",
  ".svc",
  ".cluster.local",
];

/**
 * String-level check of a host taken from a URL or from a form: false for an address that is
 * not public and for names that only resolve inside a private network (localhost, *.local,
 * *.internal, Docker and cloud metadata names, single-label names).
 * A name that passes can still resolve to a private address: see `assertPublicHost`.
 */
export function isPublicHostname(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!host) return false;
  if (isIpAddress(host)) return isPublicAddress(host);
  // Forms the URL parser would turn into an address (decimal, hex, short dotted): never a name.
  if (/^[\d.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return false;
  if (INTERNAL_NAMES.has(host)) return false;
  if (INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  // A single label ("intranet", "db") only exists on the local network.
  return host.includes(".");
}

/** Thrown by `assertPublicHost`. `reason`: "hostname" (the name itself), "dns" (what it resolves to). */
export class PrivateHostError extends Error {
  constructor(
    public readonly hostname: string,
    public readonly reason: "hostname" | "dns" | "unresolved",
  ) {
    super(`host not allowed: ${reason}`);
    this.name = "PrivateHostError";
  }
}

/**
 * Checks a host before connecting to it: the name itself, then — when a resolver is given —
 * every address it resolves to (one private address among several is enough to refuse).
 * Returns the vetted addresses (empty without a resolver).
 *
 * Residual risk: the connection that follows resolves the name again, so a DNS answer that
 * changes between the check and the connection (DNS rebinding) is not caught here. Run the
 * worker with egress to private ranges blocked at the network level.
 */
export async function assertPublicHost(hostname: string, resolve?: HostResolver): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (!isPublicHostname(host)) throw new PrivateHostError(host, "hostname");
  if (isIpAddress(host)) return [host];
  if (!resolve) return [];
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new PrivateHostError(host, "unresolved");
  }
  if (addresses.length === 0) throw new PrivateHostError(host, "unresolved");
  if (!addresses.every(isPublicAddress)) throw new PrivateHostError(host, "dns");
  return addresses;
}
