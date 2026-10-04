import { ConnectorError, type HealthStatus } from "@ia-connect/core";
import type { z } from "zod";
import { type Json, asRecord } from "./values.ts";

/** Code used by every connector when the provider rejects the stored access. */
export const AUTH_EXPIRED = "auth_expired";

const REQUEST_TIMEOUT_MS = 30_000;

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  /** JSON body. */
  json?: unknown;
  /** Form-encoded body. */
  form?: URLSearchParams | Record<string, string>;
  query?: Record<string, string | undefined>;
}

export function withQuery(url: string, query?: Record<string, string | undefined>): string {
  if (!query) return url;
  const target = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) target.searchParams.set(key, value);
  }
  return target.toString();
}

/** Maps an HTTP status to a ConnectorError. The message never contains the response body. */
export function errorFromStatus(service: string, status: number, code?: string): ConnectorError {
  if (status === 401) {
    return new ConnectorError(`${service}: accesso scaduto o non valido (HTTP 401)`, {
      retryable: false,
      code: code ?? AUTH_EXPIRED,
      status,
    });
  }
  const retryable = status === 429 || status === 408 || status >= 500;
  return new ConnectorError(`${service}: richiesta non riuscita (HTTP ${status})`, {
    retryable,
    code: code ?? `http_${status}`,
    status,
  });
}

export function authExpired(service: string): ConnectorError {
  return new ConnectorError(`${service}: accesso scaduto o non valido`, {
    retryable: false,
    code: AUTH_EXPIRED,
    status: 401,
  });
}

/** Sends a request and returns the raw response, whatever the status. Network failures are retryable. */
export async function send(
  fetchFn: typeof fetch,
  service: string,
  url: string,
  options: HttpOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json", ...options.headers };
  let body: string | undefined;
  if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.form !== undefined) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(options.form).toString();
  }
  try {
    return await fetchFn(withQuery(url, options.query), {
      method: options.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // The original error may contain the URL or headers: never propagate it.
    throw new ConnectorError(`${service}: servizio non raggiungibile`, { retryable: true, code: "network" });
  }
}

/** Sends a request and throws a mapped ConnectorError on a non-2xx status. */
export async function request(
  fetchFn: typeof fetch,
  service: string,
  url: string,
  options: HttpOptions = {},
): Promise<Response> {
  const response = await send(fetchFn, service, url, options);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw errorFromStatus(service, response.status);
  }
  return response;
}

/** Throws the mapped ConnectorError when the response is not 2xx. */
export async function ensureOk(service: string, response: Response): Promise<void> {
  if (response.ok) return;
  await response.body?.cancel().catch(() => undefined);
  throw errorFromStatus(service, response.status);
}

export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function requestJson(
  fetchFn: typeof fetch,
  service: string,
  url: string,
  options: HttpOptions = {},
): Promise<Json> {
  return asRecord(await readJson(await request(fetchFn, service, url, options)));
}

export function isAuthExpired(error: unknown): boolean {
  return (
    error instanceof ConnectorError && (error.options.code === AUTH_EXPIRED || error.options.status === 401)
  );
}

/** Turns a failed health check into the connection status shown to the customer. */
export function healthFromError(error: unknown): HealthStatus {
  if (isAuthExpired(error)) {
    return { status: "expired", message: "Accesso scaduto o revocato: ricollega l'account." };
  }
  if (error instanceof ConnectorError) return { status: "error", message: error.message };
  return { status: "error", message: "Controllo non riuscito." };
}

export const HEALTHY: HealthStatus = { status: "active", message: "Collegamento attivo." };

/** Validates input coming from the guided procedure; the error lists field names only, never values. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "(radice)"))];
  throw new ConnectorError(`Dati non validi: ${fields.join(", ")}`, {
    retryable: false,
    code: "invalid_input",
  });
}

export function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value) {
    throw new ConnectorError(`Configurazione della piattaforma mancante: ${name}`, {
      retryable: false,
      code: "missing_env",
    });
  }
  return value;
}

export function requireString(source: Record<string, unknown>, key: string, service: string): string {
  const value = source[key];
  if (typeof value !== "string" || !value) {
    throw new ConnectorError(`${service}: collegamento incompleto (${key})`, {
      retryable: false,
      code: "invalid_connection",
    });
  }
  return value;
}
