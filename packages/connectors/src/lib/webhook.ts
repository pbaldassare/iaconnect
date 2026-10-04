import type { WebhookRequest, WebhookResult } from "@ia-connect/core";
import { hmacSha256Hex, timingSafeEqual } from "./crypto.ts";

/**
 * Header set by `handleInboundWebhook` with the public URL the provider called.
 * `WebhookRequest` has no `url` field and Twilio signs the URL, so it travels here.
 * Any value sent by the caller is overwritten.
 */
export const REQUEST_URL_HEADER = "x-ia-request-url";

/** Signature header of our own webhooks (generic inbound, signature placeholder). */
export const IA_SIGNATURE_HEADER = "x-ia-signature";

export const UNVERIFIED: WebhookResult = { verified: false, events: [] };

export function header(request: WebhookRequest, name: string): string | undefined {
  const wanted = name.toLowerCase();
  const direct = request.headers[wanted];
  if (direct !== undefined) return direct;
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

export function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    return undefined;
  }
}

/** Verifies a `sha256=<hex>` HMAC of the raw body. */
export async function verifySha256Signature(
  secret: string | undefined,
  rawBody: string,
  signatureHeader: string | undefined,
): Promise<boolean> {
  if (!secret || !signatureHeader) return false;
  const provided = signatureHeader
    .trim()
    .replace(/^sha256=/i, "")
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  return timingSafeEqual(await hmacSha256Hex(secret, rawBody), provided);
}

export function jsonResponse(status: number, body: unknown): NonNullable<WebhookResult["response"]> {
  return { status, body: JSON.stringify(body), contentType: "application/json" };
}
