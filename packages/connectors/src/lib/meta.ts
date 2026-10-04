import { ConnectorError, type WebhookRequest, type WebhookResult } from "@ia-connect/core";
import { timingSafeEqual } from "./crypto.ts";
import { AUTH_EXPIRED, type HttpOptions, errorFromStatus, readJson, send } from "./http.ts";
import { type Json, asRecord } from "./values.ts";
import { header, parseJson, verifySha256Signature } from "./webhook.ts";

/** Graph API version used when `META_GRAPH_VERSION` is not set. */
export const META_GRAPH_DEFAULT_VERSION = "v21.0";

/** Graph error codes that mean "slow down". */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80007, 130429, 131048, 131056]);
/** Graph error codes that mean the token is no longer valid. */
const AUTH_CODES = new Set([102, 190]);

export function graphUrl(env: Record<string, string | undefined>, path: string): string {
  const version = env.META_GRAPH_VERSION || META_GRAPH_DEFAULT_VERSION;
  return `https://graph.facebook.com/${version}/${path.replace(/^\/+/, "")}`;
}

/** Graph API call with a bearer token. Graph reports expired tokens as HTTP 400 + code 190. */
export async function graphRequest(
  deps: { fetch: typeof fetch; env: Record<string, string | undefined> },
  service: string,
  accessToken: string,
  path: string,
  options: HttpOptions = {},
): Promise<Json> {
  const response = await send(deps.fetch, service, graphUrl(deps.env, path), {
    ...options,
    headers: { ...options.headers, authorization: `Bearer ${accessToken}` },
  });
  const json = asRecord(await readJson(response));
  if (response.ok) return json;
  const code = Number(asRecord(json.error).code);
  if (response.status === 401 || AUTH_CODES.has(code)) {
    throw new ConnectorError(`${service}: accesso scaduto o non valido`, {
      retryable: false,
      code: AUTH_EXPIRED,
      status: 401,
    });
  }
  if (RATE_LIMIT_CODES.has(code)) {
    throw new ConnectorError(`${service}: troppe richieste, riprovare più tardi`, {
      retryable: true,
      code: "rate_limited",
      status: 429,
    });
  }
  throw errorFromStatus(service, response.status, Number.isFinite(code) ? `meta_${code}` : undefined);
}

/** `X-Hub-Signature-256: sha256=<hmac of the raw body with the app secret>`. */
export function verifyMetaSignature(
  request: WebhookRequest,
  env: Record<string, string | undefined>,
): Promise<boolean> {
  return verifySha256Signature(env.META_APP_SECRET, request.rawBody, header(request, "x-hub-signature-256"));
}

type ProviderWebhookOutcome = {
  verified: boolean;
  accountIds: string[];
  response?: WebhookResult["response"];
};

/**
 * Shared provider-level entry point for Meta products: answers the GET subscription
 * handshake and verifies the signature of POST deliveries.
 */
export async function receiveMetaWebhook(
  request: WebhookRequest,
  env: Record<string, string | undefined>,
  accountIdsOf: (body: Json) => string[],
): Promise<ProviderWebhookOutcome> {
  if (request.method.toUpperCase() === "GET") {
    const expected = env.META_WEBHOOK_VERIFY_TOKEN;
    const provided = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];
    const ok =
      request.query["hub.mode"] === "subscribe" &&
      !!expected &&
      typeof provided === "string" &&
      typeof challenge === "string" &&
      timingSafeEqual(expected, provided);
    if (!ok) return { verified: false, accountIds: [] };
    return {
      verified: true,
      accountIds: [],
      response: { status: 200, body: challenge, contentType: "text/plain" },
    };
  }
  if (!(await verifyMetaSignature(request, env))) return { verified: false, accountIds: [] };
  return { verified: true, accountIds: accountIdsOf(asRecord(parseJson(request.rawBody))) };
}
