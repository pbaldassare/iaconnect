import {
  ConnectorError,
  type HostResolver,
  PrivateHostError,
  assertPublicHost,
  isPublicHostname,
} from "@ia-connect/core";

function refused(label: string, code = "invalid_url"): ConnectorError {
  return new ConnectorError(`${label}: indirizzo non consentito`, { retryable: false, code });
}

/**
 * Customer-supplied URLs are fetched from our servers: refuse anything that is not http(s),
 * that carries credentials or that points at a private, loopback or otherwise internal host
 * (the shared classifier of packages/core: private ranges, carrier-grade NAT, IPv4-mapped
 * IPv6, `*.internal`, `*.local`, Docker and cloud metadata names…).
 * String-level only: what the name resolves to is checked by `assertPublicTarget`.
 */
export function assertPublicHttpUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConnectorError(`${label}: indirizzo non valido`, { retryable: false, code: "invalid_url" });
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    !isPublicHostname(url.hostname)
  ) {
    throw refused(label);
  }
  return url;
}

/**
 * Host check before a connection: the name, then every address it resolves to when the
 * runtime provides a resolver (`ConnectorContext.resolveHost`: the worker and the web server
 * do, the edge function cannot). Returns the vetted addresses (empty without a resolver).
 */
export async function assertPublicTarget(
  hostname: string,
  label: string,
  resolveHost?: HostResolver,
): Promise<string[]> {
  try {
    return await assertPublicHost(hostname, resolveHost);
  } catch (error) {
    if (!(error instanceof PrivateHostError)) throw error;
    if (error.reason === "unresolved") {
      // The name may simply be mistyped, or the DNS briefly unavailable.
      throw new ConnectorError(`${label}: indirizzo non raggiungibile (nome non risolto)`, {
        retryable: true,
        code: "network",
      });
    }
    throw refused(label, "private_host");
  }
}

const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Headers that may follow a redirect to another origin: nothing that authenticates. */
const PORTABLE_HEADERS = new Set(["accept", "accept-language", "user-agent"]);

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
}

/**
 * A `fetch` for addresses chosen by a customer. Every hop is checked (name and, with a
 * resolver, DNS) and redirects are followed by hand, at most five times: the first URL
 * being public says nothing about where it redirects. Only GET and HEAD follow a redirect,
 * and credentials headers are not carried to another origin.
 *
 * Residual risk: `fetch` resolves the name again after the check (DNS rebinding); the
 * network egress policy must still block private ranges.
 */
export function guardedFetch(fetchFn: typeof fetch, label: string, resolveHost?: HostResolver): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    let url = urlOf(input);
    let headers = new Headers(init.headers);
    const method = (init.method ?? "GET").toUpperCase();
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = assertPublicHttpUrl(url, label);
      await assertPublicTarget(target.hostname, label, resolveHost);
      const response = await fetchFn(target.toString(), { ...init, headers, redirect: "manual" });
      const location = REDIRECTS.has(response.status) ? response.headers.get("location") : null;
      if (!location) return response;
      await response.body?.cancel().catch(() => undefined);
      if (method !== "GET" && method !== "HEAD") {
        throw new ConnectorError(`${label}: reindirizzamento non consentito per questa richiesta`, {
          retryable: false,
          code: "redirect",
        });
      }
      let next: URL;
      try {
        next = new URL(location, target);
      } catch {
        throw refused(label, "redirect");
      }
      if (next.origin !== target.origin) {
        const portable = new Headers();
        headers.forEach((value, name) => {
          if (PORTABLE_HEADERS.has(name.toLowerCase())) portable.set(name, value);
        });
        headers = portable;
      }
      url = next.toString();
    }
    throw new ConnectorError(`${label}: troppi reindirizzamenti`, { retryable: false, code: "redirect" });
  }) as typeof fetch;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
