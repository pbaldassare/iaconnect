import { ConnectorError } from "@ia-connect/core";

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /^\[?fe80:/i,
];

/**
 * Customer-supplied URLs are fetched from our servers: refuse anything that is not
 * http(s) or that points at a private/loopback host (basic SSRF guard; it does not
 * resolve DNS, so the network egress policy must still block private ranges).
 */
export function assertPublicHttpUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConnectorError(`${label}: indirizzo non valido`, { retryable: false, code: "invalid_url" });
  }
  const hostname = url.hostname;
  const isPrivate = PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
  if ((url.protocol !== "https:" && url.protocol !== "http:") || isPrivate || url.username || url.password) {
    throw new ConnectorError(`${label}: indirizzo non consentito`, { retryable: false, code: "invalid_url" });
  }
  return url;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
