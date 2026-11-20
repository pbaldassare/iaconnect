/**
 * Platform read API. Pure: the route and the tests share it.
 * The database functions in `api_*` are the security boundary; this layer
 * only parses the request and never puts the raw key into a query or a log.
 */

export type PlatformApiCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_query"
  | "method_not_allowed"
  | "unavailable"
  | "internal";

const STATUS: Record<PlatformApiCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_query: 400,
  method_not_allowed: 405,
  unavailable: 503,
  internal: 500,
};

export class PlatformApiError extends Error {
  readonly code: PlatformApiCode;
  constructor(code: PlatformApiCode) {
    super(code);
    this.name = "PlatformApiError";
    this.code = code;
  }
}

/** The server has no service key, so the read functions cannot run. */
export class PlatformApiUnavailable extends Error {
  constructor() {
    super("unavailable");
    this.name = "PlatformApiUnavailable";
  }
}

export interface ApiOrganization {
  id: string;
  name: string;
  sector: string;
  status: string;
  created_at: string;
}

export interface ApiConversation {
  id: string;
  contact_id: string;
  contact_name: string;
  channel: string;
  status: string;
  last_message_at: string | null;
  unread_count: number;
  created_at: string;
}

export interface ApiMessage {
  id: string;
  direction: string;
  channel: string;
  content: string;
  delivery_status: string;
  external_id: string | null;
  created_at: string;
}

export interface PlatformApiStore {
  organizations(keyHash: string): Promise<ApiOrganization[]>;
  conversations(
    keyHash: string,
    organizationId: string,
    limit: number,
    before: string | null,
  ): Promise<ApiConversation[]>;
  messages(
    keyHash: string,
    organizationId: string,
    conversationId: string,
    limit: number,
    before: string | null,
  ): Promise<ApiMessage[]>;
}

export interface PlatformApiResult {
  status: number;
  body: { data: unknown[] } | { error: PlatformApiCode };
}

const KEY = /^iac_[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 hex of the raw key. This is the only form that reaches the database. */
export async function hashApiKey(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return hex(new Uint8Array(digest));
}

/** A new key. `prefix` is the first 12 characters, safe to show in the admin list. */
export async function newApiKey(): Promise<{ raw: string; prefix: string; hash: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = `iac_${hex(bytes)}`;
  return { raw, prefix: raw.slice(0, 12), hash: await hashApiKey(raw) };
}

/** The raw key from `Authorization: Bearer`, or null when the header is not one of ours. */
export function readBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header.trim());
  const token = match?.[1];
  return token && KEY.test(token) ? token : null;
}

export type ApiRoute =
  | { kind: "organizations" }
  | { kind: "conversations"; organizationId: string }
  | { kind: "messages"; organizationId: string; conversationId: string };

export function matchApiRoute(pathname: string): ApiRoute | null {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const parts = path.split("/");
  if (parts[1] !== "api" || parts[2] !== "v1" || parts[3] !== "organizations") return null;
  if (parts.length === 4) return { kind: "organizations" };
  if (parts.length === 6 && parts[5] === "conversations" && UUID.test(parts[4] ?? "")) {
    return { kind: "conversations", organizationId: parts[4]!.toLowerCase() };
  }
  if (
    parts.length === 8 &&
    parts[5] === "conversations" &&
    parts[7] === "messages" &&
    UUID.test(parts[4] ?? "") &&
    UUID.test(parts[6] ?? "")
  ) {
    return {
      kind: "messages",
      organizationId: parts[4]!.toLowerCase(),
      conversationId: parts[6]!.toLowerCase(),
    };
  }
  return null;
}

/** Maps a Postgres error from the api_* functions. Anything else stays unmapped. */
export function platformApiErrorFrom(error: {
  code?: string | null;
  message?: string | null;
}): PlatformApiError | null {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "28000" || message === "unauthorized") return new PlatformApiError("unauthorized");
  if (code === "42501" || message === "forbidden") return new PlatformApiError("forbidden");
  if (code === "P0002" || code === "02000" || message === "not found" || message === "unknown organization") {
    return new PlatformApiError("not_found");
  }
  if (code === "22023" || message === "invalid limit" || message.startsWith("invalid ")) {
    return new PlatformApiError("invalid_query");
  }
  return null;
}

function parseLimit(value: string | null): number | PlatformApiError {
  if (value === null || value === "") return 50;
  if (!/^[1-9][0-9]{0,2}$/.test(value)) return new PlatformApiError("invalid_query");
  const parsed = Number(value);
  if (parsed > 100) return new PlatformApiError("invalid_query");
  return parsed;
}

function parseBefore(value: string | null): string | null | PlatformApiError {
  if (value === null || value === "") return null;
  if (value.length > 40) return new PlatformApiError("invalid_query");
  const time = Date.parse(value);
  if (Number.isNaN(time)) return new PlatformApiError("invalid_query");
  return new Date(time).toISOString();
}

function fail(code: PlatformApiCode): PlatformApiResult {
  return { status: STATUS[code], body: { error: code } };
}

export async function handlePlatformApi(input: {
  method: string;
  pathname: string;
  authorization: string | null;
  search: URLSearchParams;
  store: PlatformApiStore;
}): Promise<PlatformApiResult> {
  const route = matchApiRoute(input.pathname);
  if (!route) return fail("not_found");
  if (input.method !== "GET") return fail("method_not_allowed");
  const raw = readBearer(input.authorization);
  if (!raw) return fail("unauthorized");
  const limit = parseLimit(input.search.get("limit"));
  if (limit instanceof PlatformApiError) return fail(limit.code);
  const before = parseBefore(input.search.get("before"));
  if (before instanceof PlatformApiError) return fail(before.code);
  const keyHash = await hashApiKey(raw);
  try {
    const data =
      route.kind === "organizations"
        ? await input.store.organizations(keyHash)
        : route.kind === "conversations"
          ? await input.store.conversations(keyHash, route.organizationId, limit, before)
          : await input.store.messages(keyHash, route.organizationId, route.conversationId, limit, before);
    return { status: 200, body: { data } };
  } catch (error) {
    if (error instanceof PlatformApiError) return fail(error.code);
    if (error instanceof PlatformApiUnavailable) return fail("unavailable");
    return fail("internal");
  }
}
