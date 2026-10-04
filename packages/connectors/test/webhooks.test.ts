import type { ConnectionRecord, NormalizedEventInput } from "@ia-connect/core";
import { describe, expect, it } from "vitest";
import { IA_SIGNATURE_HEADER } from "../src/lib/webhook.ts";
import { MAX_WEBHOOK_BODY_BYTES, type WebhookDeps, handleInboundWebhook } from "../src/webhooks.ts";
import {
  PHONE_NUMBER_ID,
  hmacHex,
  hmacSha1Base64,
  whatsappInboundPayload,
  whatsappStatusPayload,
} from "./helpers.ts";

const BASE = "https://proj.supabase.co/functions/v1/webhook";
const ENV = { META_APP_SECRET: "meta-app-secret", META_WEBHOOK_VERIFY_TOKEN: "verify-me" };

interface Stored {
  connectionId: string;
  organizationId: string;
  event: NormalizedEventInput;
}

function connection(
  id: string,
  org: string,
  connectorKey: string,
  extra: Partial<ConnectionRecord> = {},
): ConnectionRecord {
  return { id, organizationId: org, connectorKey, status: "active", config: {}, ...extra };
}

/** In-memory stand-in for the database, with the same dedupe rule as ia_connect.events. */
function fakeDeps(options: {
  tokens?: Record<string, ConnectionRecord>;
  accounts?: Record<string, ConnectionRecord[]>;
  secrets?: Record<string, Record<string, unknown>>;
  env?: Record<string, string | undefined>;
}) {
  const stored: Stored[] = [];
  const lookups: string[] = [];
  const deps: WebhookDeps = {
    env: options.env ?? ENV,
    fetch: (() => {
      throw new Error("unexpected network call");
    }) as typeof fetch,
    async findConnectionByToken(token) {
      lookups.push(`token:${token}`);
      return options.tokens?.[token] ?? null;
    },
    async findConnectionsByAccount(connectorKey, accountId) {
      lookups.push(`account:${connectorKey}:${accountId}`);
      return options.accounts?.[`${connectorKey}:${accountId}`] ?? [];
    },
    async readSecrets(connectionId) {
      return options.secrets?.[connectionId] ?? {};
    },
    async saveSecrets() {},
    async insertEvents(target, events) {
      for (const event of events) {
        const duplicate = stored.some(
          (row) => row.organizationId === target.organizationId && row.event.dedupeKey === event.dedupeKey,
        );
        if (!duplicate)
          stored.push({ connectionId: target.id, organizationId: target.organizationId, event });
      }
    },
    now: () => new Date("2026-10-05T08:00:00.000Z"),
  };
  return { deps, stored, lookups };
}

function metaPost(body: unknown, secret = "meta-app-secret", path = "/p/whatsapp_meta"): Request {
  const rawBody = JSON.stringify(body);
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Hub-Signature-256": `sha256=${hmacHex(secret, rawBody)}`,
    },
    body: rawBody,
  });
}

describe("handleInboundWebhook: provider route (/p/<connector_key>)", () => {
  const acme = connection("conn-acme", "org-acme", "whatsapp_meta", {
    config: { phoneNumberId: PHONE_NUMBER_ID },
  });
  const accounts = { [`whatsapp_meta:${PHONE_NUMBER_ID}`]: [acme] };
  // Every connection the server completed has its secrets in the Vault.
  const secrets = { "conn-acme": { accessToken: "EAAG-acme" } };

  it("answers Meta's GET handshake with the challenge", async () => {
    const { deps, stored } = fakeDeps({ accounts, secrets });
    const url = `${BASE}/p/whatsapp_meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1158201444`;
    const response = await handleInboundWebhook(new Request(url), deps);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("1158201444");
    expect(stored).toEqual([]);
  });

  it("refuses the handshake with a wrong verify token, with no detail", async () => {
    const { deps } = fakeDeps({ accounts, secrets });
    const url = `${BASE}/p/whatsapp_meta?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1158201444`;
    const response = await handleInboundWebhook(new Request(url), deps);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
  });

  it("stores the events of a signed delivery for the connection that owns the number", async () => {
    const { deps, stored } = fakeDeps({ accounts, secrets });
    const response = await handleInboundWebhook(metaPost(whatsappInboundPayload), deps);
    expect(response.status).toBe(200);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      connectionId: "conn-acme",
      organizationId: "org-acme",
      event: {
        type: "whatsapp.message.received",
        dedupeKey: "whatsapp_meta:msg:wamid.HBgMMzkzMzMxMjM0NTY3FQIAEhgUM0EwQjQ1",
        payload: { from: "+393331234567", text: "Buongiorno, vorrei un preventivo" },
      },
    });
  });

  it("stores nothing and looks nothing up when the signature is rejected", async () => {
    const { deps, stored, lookups } = fakeDeps({ accounts, secrets });
    const response = await handleInboundWebhook(metaPost(whatsappInboundPayload, "attacker-secret"), deps);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(stored).toEqual([]);
    expect(lookups).toEqual([]);
  });

  it("keeps dedupe keys stable across redelivery, so nothing is stored twice", async () => {
    const { deps, stored } = fakeDeps({ accounts, secrets });
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await handleInboundWebhook(metaPost(whatsappInboundPayload), deps)).status).toBe(200);
      expect((await handleInboundWebhook(metaPost(whatsappStatusPayload), deps)).status).toBe(200);
    }
    expect(stored.map((row) => row.event.dedupeKey)).toEqual([
      "whatsapp_meta:msg:wamid.HBgMMzkzMzMxMjM0NTY3FQIAEhgUM0EwQjQ1",
      "whatsapp_meta:status:wamid.OUT1:delivered",
      "whatsapp_meta:status:wamid.OUT2:failed",
    ]);
  });

  it("skips connections that are not active or belong to another connector", async () => {
    const expired = connection("conn-old", "org-old", "whatsapp_meta", {
      status: "expired",
      config: { phoneNumberId: PHONE_NUMBER_ID },
    });
    const foreign = connection("conn-x", "org-x", "sms_twilio", {
      config: { phoneNumberId: PHONE_NUMBER_ID },
    });
    const { deps, stored } = fakeDeps({
      accounts: { [`whatsapp_meta:${PHONE_NUMBER_ID}`]: [expired, foreign] },
    });
    const response = await handleInboundWebhook(metaPost(whatsappInboundPayload), deps);
    expect(response.status).toBe(200);
    expect(stored).toEqual([]);
  });

  it("answers 200 and stores nothing when no customer owns the number", async () => {
    const { deps, stored } = fakeDeps({});
    expect((await handleInboundWebhook(metaPost(whatsappInboundPayload), deps)).status).toBe(200);
    expect(stored).toEqual([]);
  });

  it("answers 500 without detail when storing fails, so the provider redelivers", async () => {
    const { deps } = fakeDeps({ accounts, secrets });
    deps.insertEvents = async () => {
      throw new Error("database down: secret detail");
    };
    const response = await handleInboundWebhook(metaPost(whatsappInboundPayload), deps);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
  });

  it("never delivers to a connection without stored secrets, whatever account id it carries", async () => {
    // What a manager could insert by hand before connections became server-written: the
    // victim's phone number id, no token (none is needed to receive).
    const squatter = connection("conn-squatter", "org-attacker", "whatsapp_meta", {
      config: { phoneNumberId: PHONE_NUMBER_ID },
    });
    const { deps, stored } = fakeDeps({
      accounts: { [`whatsapp_meta:${PHONE_NUMBER_ID}`]: [squatter, acme] },
      secrets,
    });
    const response = await handleInboundWebhook(metaPost(whatsappInboundPayload), deps);
    expect(response.status).toBe(200);
    expect(stored.map((row) => row.organizationId)).toEqual(["org-acme"]);
  });

  it("serves the other connections and answers 200 when one connection's handler fails", async () => {
    const pageId = "112233445566778";
    const body = {
      object: "page",
      entry: [
        {
          id: pageId,
          time: 1759651200000,
          messaging: [
            {
              sender: { id: "5551234" },
              recipient: { id: pageId },
              timestamp: 1759651200000,
              message: { mid: "m_abc", text: "Buongiorno" },
            },
          ],
        },
      ],
    };
    // Broken: secrets exist but the page id is missing from the configuration, so the handler throws.
    const broken = connection("conn-broken", "org-broken", "meta_social", { config: {} });
    const good = connection("conn-good", "org-good", "meta_social", { config: { pageId } });
    const { deps, stored } = fakeDeps({
      accounts: { [`meta_social:${pageId}`]: [broken, good] },
      secrets: {
        "conn-broken": { pageAccessToken: "EAAG-broken" },
        "conn-good": { pageAccessToken: "EAAG-good" },
      },
    });
    const response = await handleInboundWebhook(metaPost(body, "meta-app-secret", "/p/meta_social"), deps);
    expect(response.status).toBe(200);
    expect(stored.map((row) => [row.connectionId, row.event.type])).toEqual([
      ["conn-good", "social.message.received"],
    ]);
  });

  it("answers 404 for unknown connectors and for connectors without a provider-level webhook", async () => {
    const { deps } = fakeDeps({ accounts, secrets });
    for (const path of [
      "/p/unknown",
      "/p/webhook_inbound",
      "/p/imap_smtp",
      "/p/constructor",
      "/x/whatsapp_meta",
      "/",
    ]) {
      const response = await handleInboundWebhook(
        metaPost(whatsappInboundPayload, "meta-app-secret", path),
        deps,
      );
      expect(response.status, path).toBe(404);
      expect(await response.text()).toBe("");
    }
  });
});

describe("handleInboundWebhook: connection route (/c/<webhook_token>)", () => {
  const secret = "k".repeat(64);
  const site = connection("conn-site", "org-acme", "webhook_inbound");
  const options = { tokens: { tok123: site }, secrets: { "conn-site": { signingSecret: secret } } };
  const body = JSON.stringify({
    type: "order.created",
    dedupeKey: "order-1001",
    payload: {
      orderNumber: "1001",
      name: "Mario Rossi",
      total: 59.9,
      currency: "EUR",
      items: [],
      status: "paid",
    },
    contact: { name: "Mario Rossi", phone: "+393331234567" },
  });
  const signedPost = (token: string, rawBody = body, key = secret) =>
    new Request(`${BASE}/c/${token}`, {
      method: "POST",
      headers: { [IA_SIGNATURE_HEADER]: `sha256=${hmacHex(key, rawBody)}` },
      body: rawBody,
    });

  it("stores a signed event once, however many times it is delivered", async () => {
    const { deps, stored } = fakeDeps(options);
    expect((await handleInboundWebhook(signedPost("tok123"), deps)).status).toBe(200);
    expect((await handleInboundWebhook(signedPost("tok123"), deps)).status).toBe(200);
    expect(stored).toEqual([
      {
        connectionId: "conn-site",
        organizationId: "org-acme",
        event: {
          type: "order.created",
          dedupeKey: "webhook_inbound:order-1001",
          payload: {
            orderNumber: "1001",
            name: "Mario Rossi",
            total: 59.9,
            currency: "EUR",
            items: [],
            status: "paid",
          },
          contact: { name: "Mario Rossi", phone: "+393331234567" },
        },
      },
    ]);
  });

  it("answers 404 for an unknown token and 401 for a bad signature, storing nothing", async () => {
    const { deps, stored } = fakeDeps(options);
    const unknown = await handleInboundWebhook(signedPost("nope"), deps);
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe("");
    const forged = await handleInboundWebhook(signedPost("tok123", body, "wrong-secret"), deps);
    expect(forged.status).toBe(401);
    expect(await forged.text()).toBe("");
    const unsigned = await handleInboundWebhook(
      new Request(`${BASE}/c/tok123`, { method: "POST", body }),
      deps,
    );
    expect(unsigned.status).toBe(401);
    expect(stored).toEqual([]);
  });

  it("refuses disconnected connections and connectors without webhooks", async () => {
    const { deps, stored } = fakeDeps({
      tokens: {
        gone: { ...site, status: "disconnected" },
        mail: connection("conn-mail", "org-acme", "gmail"),
      },
      secrets: options.secrets,
    });
    expect((await handleInboundWebhook(signedPost("gone"), deps)).status).toBe(404);
    expect((await handleInboundWebhook(signedPost("mail"), deps)).status).toBe(404);
    expect(stored).toEqual([]);
  });

  it("answers 400 for a signed body that is not a valid event", async () => {
    const { deps, stored } = fakeDeps(options);
    const invalid = JSON.stringify({ type: "whatever", payload: {} });
    const response = await handleInboundWebhook(signedPost("tok123", invalid), deps);
    expect(response.status).toBe(400);
    expect(stored).toEqual([]);
  });

  it("rejects bodies over the size limit before any lookup", async () => {
    const { deps, lookups } = fakeDeps(options);
    const huge = "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1);
    const response = await handleInboundWebhook(signedPost("tok123", huge), deps);
    expect(response.status).toBe(413);
    expect(lookups).toEqual([]);
  });

  it("only accepts GET and POST", async () => {
    const { deps } = fakeDeps(options);
    const response = await handleInboundWebhook(new Request(`${BASE}/c/tok123`, { method: "DELETE" }), deps);
    expect(response.status).toBe(405);
  });

  it("verifies Twilio against the public URL, ignoring a caller-supplied URL header", async () => {
    const accountSid = `AC${"a".repeat(32)}`;
    const authToken = "twilio-auth-token";
    const sms = connection("conn-sms", "org-acme", "sms_twilio", { config: { accountSid } });
    const params = new URLSearchParams({
      AccountSid: accountSid,
      Body: "Ciao",
      From: "+393331234567",
      MessageSid: "SM1",
    });
    const publicUrl = "https://hooks.example.com/webhook/c/smstok";
    const signature = hmacSha1Base64(
      authToken,
      `${publicUrl}AccountSid${accountSid}BodyCiaoFrom+393331234567MessageSidSM1`,
    );
    const { deps, stored } = fakeDeps({
      tokens: { smstok: sms },
      secrets: { "conn-sms": { authToken } },
      env: { WEBHOOK_PUBLIC_URL: "https://hooks.example.com/webhook/" },
    });
    const request = (headers: Record<string, string>) =>
      new Request("http://edge-runtime.internal/webhook/c/smstok", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
        body: params.toString(),
      });

    const ok = await handleInboundWebhook(request({ "X-Twilio-Signature": signature }), deps);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("text/xml");
    expect(stored.map((row) => row.event.type)).toEqual(["sms.received"]);

    // A signature computed for a URL chosen by the caller must not pass.
    const forgedUrl = "https://attacker.example/c/smstok";
    const forged = hmacSha1Base64(
      "guess",
      `${forgedUrl}AccountSid${accountSid}BodyCiaoFrom+393331234567MessageSidSM1`,
    );
    const bad = await handleInboundWebhook(
      request({ "X-Twilio-Signature": forged, "x-ia-request-url": forgedUrl }),
      deps,
    );
    expect(bad.status).toBe(401);
    expect(stored).toHaveLength(1);
  });
});
