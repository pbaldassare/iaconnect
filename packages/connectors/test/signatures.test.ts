import type { WebhookRequest } from "@ia-connect/core";
import { describe, expect, it } from "vitest";
import {
  IA_SIGNATURE_HEADER,
  REQUEST_URL_HEADER,
  paymentStripeConnector,
  smsTwilioConnector,
  webhookInboundConnector,
  whatsappMetaConnector,
} from "../src/index.ts";
import { verifyStripeSignature } from "../src/payment-stripe.ts";
import { twilioSignature } from "../src/sms-twilio.ts";
import {
  NOW,
  PHONE_NUMBER_ID,
  hmacHex,
  hmacSha1Base64,
  makeContext,
  whatsappInboundPayload,
} from "./helpers.ts";

function post(rawBody: string, headers: Record<string, string>): WebhookRequest {
  return { method: "POST", headers, query: {}, rawBody };
}

describe("Meta signature (X-Hub-Signature-256)", () => {
  const env = { META_APP_SECRET: "meta-app-secret", META_WEBHOOK_VERIFY_TOKEN: "verify-me" };
  const rawBody = JSON.stringify(whatsappInboundPayload);

  it("accepts a body signed with the app secret and lists the phone number ids", async () => {
    const request = post(rawBody, { "x-hub-signature-256": `sha256=${hmacHex("meta-app-secret", rawBody)}` });
    const result = await whatsappMetaConnector.receiveProviderWebhook!(request, env);
    expect(result).toEqual({ verified: true, accountIds: [PHONE_NUMBER_ID] });
  });

  it("rejects a wrong secret, a tampered body, a missing header and a missing app secret", async () => {
    const good = `sha256=${hmacHex("meta-app-secret", rawBody)}`;
    const receive = whatsappMetaConnector.receiveProviderWebhook!;
    const wrongSecret = post(rawBody, { "x-hub-signature-256": `sha256=${hmacHex("other", rawBody)}` });
    expect((await receive(wrongSecret, env)).verified).toBe(false);
    expect((await receive(post(`${rawBody} `, { "x-hub-signature-256": good }), env)).verified).toBe(false);
    expect((await receive(post(rawBody, {}), env)).verified).toBe(false);
    expect((await receive(post(rawBody, { "x-hub-signature-256": good }), {})).verified).toBe(false);
  });

  it("verifies again inside handleWebhook, so the per-connection route cannot be used to skip it", async () => {
    const context = makeContext({
      connectorKey: "whatsapp_meta",
      config: { phoneNumberId: PHONE_NUMBER_ID },
      env,
    });
    const unsigned = await whatsappMetaConnector.handleWebhook!(context, post(rawBody, {}));
    expect(unsigned).toEqual({ verified: false, events: [] });
  });

  it("answers the GET handshake only with the right verify token", async () => {
    const receive = whatsappMetaConnector.receiveProviderWebhook!;
    const query = { "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "1158201444" };
    const ok = await receive({ method: "GET", headers: {}, query, rawBody: "" }, env);
    expect(ok.verified).toBe(true);
    expect(ok.response).toEqual({ status: 200, body: "1158201444", contentType: "text/plain" });
    const bad = await receive(
      { method: "GET", headers: {}, query: { ...query, "hub.verify_token": "guess" }, rawBody: "" },
      env,
    );
    expect(bad).toEqual({ verified: false, accountIds: [] });
  });
});

describe("Twilio signature (X-Twilio-Signature)", () => {
  const authToken = "twilio-auth-token";
  const accountSid = `AC${"a".repeat(32)}`;
  const url = "https://proj.supabase.co/functions/v1/webhook/c/tok123";
  const params = new URLSearchParams({
    ToCountry: "IT",
    MessageSid: "SM1234567890abcdef1234567890abcdef",
    AccountSid: accountSid,
    From: "+393331234567",
    To: "+390212345678",
    Body: "Sì, confermo l'appuntamento",
    NumMedia: "0",
  });
  // Reference: URL + parameters sorted by name, each as name immediately followed by value.
  const reference = [
    url,
    `AccountSid${accountSid}`,
    "BodySì, confermo l'appuntamento",
    "From+393331234567",
    "MessageSidSM1234567890abcdef1234567890abcdef",
    "NumMedia0",
    "To+390212345678",
    "ToCountryIT",
  ].join("");
  const signature = hmacSha1Base64(authToken, reference);
  const context = () =>
    makeContext({ connectorKey: "sms_twilio", config: { accountSid }, secrets: { authToken } });

  it("computes the documented signature", async () => {
    expect(await twilioSignature(authToken, url, params)).toBe(signature);
  });

  it("accepts a correctly signed request", async () => {
    const request = post(params.toString(), { "x-twilio-signature": signature, [REQUEST_URL_HEADER]: url });
    const result = await smsTwilioConnector.handleWebhook!(context(), request);
    expect(result.verified).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.response?.contentType).toBe("text/xml");
  });

  it("rejects a wrong signature, a different URL, a changed parameter and another account", async () => {
    const handle = smsTwilioConnector.handleWebhook!;
    const body = params.toString();
    const wrong = post(body, { "x-twilio-signature": "AAAA", [REQUEST_URL_HEADER]: url });
    expect((await handle(context(), wrong)).verified).toBe(false);
    const otherUrl = post(body, { "x-twilio-signature": signature, [REQUEST_URL_HEADER]: `${url}x` });
    expect((await handle(context(), otherUrl)).verified).toBe(false);
    const tampered = new URLSearchParams(params);
    tampered.set("Body", "altro testo");
    const changed = post(tampered.toString(), { "x-twilio-signature": signature, [REQUEST_URL_HEADER]: url });
    expect((await handle(context(), changed)).verified).toBe(false);
    expect((await handle(context(), post(body, { [REQUEST_URL_HEADER]: url }))).verified).toBe(false);

    const otherAccount = makeContext({
      connectorKey: "sms_twilio",
      config: { accountSid: `AC${"b".repeat(32)}` },
      secrets: { authToken },
    });
    const valid = post(body, { "x-twilio-signature": signature, [REQUEST_URL_HEADER]: url });
    expect((await handle(otherAccount, valid)).verified).toBe(false);
  });
});

describe("Stripe signature (Stripe-Signature)", () => {
  const secret = "whsec_test_secret";
  const rawBody = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: {} } });
  const t = Math.floor(NOW.getTime() / 1000);
  const sign = (timestamp: number, key = secret) =>
    `t=${timestamp},v1=${hmacHex(key, `${timestamp}.${rawBody}`)}`;

  it("accepts a fresh, correctly signed event (also during a secret rotation)", async () => {
    expect(await verifyStripeSignature(post(rawBody, { "stripe-signature": sign(t) }), secret, NOW)).toBe(
      true,
    );
    const rotated = `t=${t},v1=${"0".repeat(64)},v1=${hmacHex(secret, `${t}.${rawBody}`)},v0=ignored`;
    expect(await verifyStripeSignature(post(rawBody, { "stripe-signature": rotated }), secret, NOW)).toBe(
      true,
    );
  });

  it("rejects a wrong secret, a tampered body, an old timestamp and a missing secret", async () => {
    const verify = (request: WebhookRequest, key: string | undefined = secret) =>
      verifyStripeSignature(request, key, NOW);
    expect(await verify(post(rawBody, { "stripe-signature": sign(t, "whsec_other") }))).toBe(false);
    expect(await verify(post(`${rawBody}\n`, { "stripe-signature": sign(t) }))).toBe(false);
    expect(await verify(post(rawBody, { "stripe-signature": sign(t - 3600) }))).toBe(false);
    expect(await verify(post(rawBody, {}))).toBe(false);
    expect(await verifyStripeSignature(post(rawBody, { "stripe-signature": sign(t) }), undefined, NOW)).toBe(
      false,
    );
  });

  it("is enforced by the connector's handleWebhook", async () => {
    const context = makeContext({ connectorKey: "payment_stripe", secrets: { webhookSecret: secret } });
    const handle = paymentStripeConnector.handleWebhook!;
    expect((await handle(context, post(rawBody, { "stripe-signature": sign(t) }))).verified).toBe(true);
    expect((await handle(context, post(rawBody, { "stripe-signature": sign(t, "x") }))).verified).toBe(false);
  });
});

describe("generic inbound webhook signature (x-ia-signature)", () => {
  const signingSecret = "s".repeat(64);
  const context = () => makeContext({ connectorKey: "webhook_inbound", secrets: { signingSecret } });
  const rawBody = JSON.stringify({
    type: "quote.requested",
    dedupeKey: "form-8841",
    payload: { name: "Lucia Bianchi", product: "RC auto", source: "sito" },
    contact: { name: "Lucia Bianchi", email: "lucia@example.com" },
  });

  it("accepts a signed body and emits the declared event", async () => {
    const request = post(rawBody, { [IA_SIGNATURE_HEADER]: `sha256=${hmacHex(signingSecret, rawBody)}` });
    const result = await webhookInboundConnector.handleWebhook!(context(), request);
    expect(result.verified).toBe(true);
    expect(result.events).toEqual([
      {
        type: "quote.requested",
        dedupeKey: "webhook_inbound:form-8841",
        payload: { name: "Lucia Bianchi", product: "RC auto", source: "sito" },
        contact: { name: "Lucia Bianchi", email: "lucia@example.com" },
      },
    ]);
  });

  it("rejects wrong, malformed and missing signatures", async () => {
    const handle = webhookInboundConnector.handleWebhook!;
    for (const value of [
      `sha256=${hmacHex("wrong", rawBody)}`,
      "sha256=zz",
      "",
      hmacHex(signingSecret, "x"),
    ]) {
      const headers: Record<string, string> = value ? { [IA_SIGNATURE_HEADER]: value } : {};
      expect(await handle(context(), post(rawBody, headers))).toEqual({ verified: false, events: [] });
    }
    const noSecret = makeContext({ connectorKey: "webhook_inbound", secrets: {} });
    const signed = post(rawBody, { [IA_SIGNATURE_HEADER]: `sha256=${hmacHex(signingSecret, rawBody)}` });
    expect((await handle(noSecret, signed)).verified).toBe(false);
  });

  it("derives a stable dedupe key from the body when none is given, and accepts custom types", async () => {
    const body = JSON.stringify({ type: "custom.cart.abandoned", payload: { cart: 12 } });
    const request = post(body, { [IA_SIGNATURE_HEADER]: `sha256=${hmacHex(signingSecret, body)}` });
    const first = await webhookInboundConnector.handleWebhook!(context(), request);
    const second = await webhookInboundConnector.handleWebhook!(context(), request);
    expect(first.events[0]?.type).toBe("custom.cart.abandoned");
    expect(first.events[0]?.dedupeKey).toMatch(/^webhook_inbound:[0-9a-f]{64}$/);
    expect(second.events[0]?.dedupeKey).toBe(first.events[0]?.dedupeKey);
  });

  it("answers 400 and stores nothing for an unknown event type or a malformed body", async () => {
    for (const body of [
      JSON.stringify({ type: "not.a.type", payload: {} }),
      "not json",
      JSON.stringify({}),
    ]) {
      const request = post(body, { [IA_SIGNATURE_HEADER]: `sha256=${hmacHex(signingSecret, body)}` });
      const result = await webhookInboundConnector.handleWebhook!(context(), request);
      expect(result.verified).toBe(true);
      expect(result.events).toEqual([]);
      expect(result.response?.status).toBe(400);
    }
  });
});
