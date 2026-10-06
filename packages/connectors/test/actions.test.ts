import { ConnectorError } from "@ia-connect/core";
import { describe, expect, it } from "vitest";
import {
  computeFreeSlots,
  createImapSmtpConnector,
  crmRestConnector,
  gmailConnector,
  googleCalendarConnector,
  paymentStripeConnector,
  signatureLinkConnector,
  smsTwilioConnector,
  webhookInboundConnector,
  whatsappMetaConnector,
  whatsappWaWebApiConnector,
} from "../src/index.ts";
import { NOW, PHONE_NUMBER_ID, fakeFetch, json, makeContext } from "./helpers.ts";

async function failure(promise: Promise<unknown>): Promise<ConnectorError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectorError);
    return error as ConnectorError;
  }
  throw new Error("expected the call to fail");
}

const metaContext = (fetch: typeof globalThis.fetch) =>
  makeContext({
    connectorKey: "whatsapp_meta",
    config: { phoneNumberId: PHONE_NUMBER_ID, wabaId: "102290129340398" },
    secrets: { accessToken: "EAAG-secret-token" },
    fetch,
  });

describe("WhatsApp (Meta) sending", () => {
  it("sends an approved template with ordered body variables", async () => {
    const { fetch, calls } = fakeFetch(() => json({ messages: [{ id: "wamid.SENT1" }] }));
    const result = await whatsappMetaConnector.actions.sendTemplate!.execute(metaContext(fetch), {
      to: "333 123 4567",
      template: "preventivo_pronto",
      variables: ["Mario", "120,50 €"],
    });
    expect(result).toEqual({ externalId: "wamid.SENT1", status: "sent" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.authorization).toBe("Bearer EAAG-secret-token");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      messaging_product: "whatsapp",
      to: "393331234567",
      type: "template",
      template: {
        name: "preventivo_pronto",
        language: { code: "it" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Mario" },
              { type: "text", text: "120,50 €" },
            ],
          },
        ],
      },
    });
  });

  it("sends a template without variables with no components", async () => {
    const { fetch, calls } = fakeFetch(() => json({ messages: [{ id: "wamid.SENT2" }] }));
    await whatsappMetaConnector.actions.sendTemplate!.execute(metaContext(fetch), {
      to: "+393331234567",
      template: "benvenuto",
      language: "en_US",
    });
    expect(JSON.parse(calls[0]!.body!).template).toEqual({
      name: "benvenuto",
      language: { code: "en_US" },
      components: [],
    });
  });

  it("sends a free text message", async () => {
    const { fetch, calls } = fakeFetch(() => json({ messages: [{ id: "wamid.SENT3" }] }));
    const result = await whatsappMetaConnector.actions.sendText!.execute(metaContext(fetch), {
      to: "+39 333 1234567",
      text: "Grazie, a presto!",
    });
    expect(result.externalId).toBe("wamid.SENT3");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "393331234567",
      type: "text",
      text: { preview_url: false, body: "Grazie, a presto!" },
    });
  });

  it("rejects invalid input before calling the provider", async () => {
    const error = await failure(
      whatsappMetaConnector.actions.sendText!.execute(metaContext(fakeFetch(() => json({})).fetch), {
        to: "abc",
      }),
    );
    expect(error.retryable).toBe(false);
  });

  it("uses the Graph version from the environment when set", async () => {
    const { fetch, calls } = fakeFetch(() => json({ messages: [{ id: "x" }] }));
    const context = metaContext(fetch);
    context.env.META_GRAPH_VERSION = "v23.0";
    await whatsappMetaConnector.actions.sendText!.execute(context, { to: "+393331234567", text: "ciao" });
    expect(calls[0]!.url).toContain("/v23.0/");
  });
});

describe("error mapping", () => {
  const send = (fetch: typeof globalThis.fetch) =>
    whatsappMetaConnector.actions.sendText!.execute(metaContext(fetch), {
      to: "+393331234567",
      text: "ciao",
    });

  it("maps 429 and 5xx to retryable errors", async () => {
    for (const status of [429, 500, 503]) {
      const error = await failure(send(fakeFetch(() => json({ error: { message: "x" } }, status)).fetch));
      expect(error.retryable, String(status)).toBe(true);
      expect(error.options.status).toBe(status);
    }
  });

  it("maps 400 to a permanent error", async () => {
    const error = await failure(
      send(fakeFetch(() => json({ error: { message: "Invalid parameter", code: 100 } }, 400)).fetch),
    );
    expect(error.retryable).toBe(false);
    expect(error.options.status).toBe(400);
    expect(error.options.code).toBe("meta_100");
  });

  it("maps Meta's rate-limit error codes to retryable even on HTTP 400", async () => {
    const error = await failure(send(fakeFetch(() => json({ error: { code: 130429 } }, 400)).fetch));
    expect(error.retryable).toBe(true);
  });

  it("maps a network failure to a retryable error without leaking details", async () => {
    const fetch = (() =>
      Promise.reject(new Error("connect ECONNREFUSED EAAG-secret-token"))) as typeof globalThis.fetch;
    const error = await failure(send(fetch));
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain("EAAG");
  });

  it("never puts the token or the provider's response body in the error message", async () => {
    const body = { error: { message: "Bad token EAAG-secret-token for +393331234567", code: 100 } };
    const error = await failure(send(fakeFetch(() => json(body, 400)).fetch));
    expect(error.message).not.toContain("EAAG");
    expect(error.message).not.toContain("393331234567");
  });

  it("reports 401 and Meta's invalid-token code as `expired` on verify", async () => {
    const unauthorized = await whatsappMetaConnector.verify(
      metaContext(fakeFetch(() => json({}, 401)).fetch),
    );
    expect(unauthorized.status).toBe("expired");
    const code190 = await whatsappMetaConnector.verify(
      metaContext(fakeFetch(() => json({ error: { code: 190, type: "OAuthException" } }, 400)).fetch),
    );
    expect(code190.status).toBe("expired");
    const down = await whatsappMetaConnector.verify(metaContext(fakeFetch(() => json({}, 500)).fetch));
    expect(down.status).toBe("error");
    const ok = await whatsappMetaConnector.verify(metaContext(fakeFetch(() => json({ id: "1" })).fetch));
    expect(ok.status).toBe("active");
  });

  it("reports 401 as `expired` for Twilio, Stripe and the REST adapter too", async () => {
    const unauthorized = fakeFetch(() => json({}, 401)).fetch;
    const twilio = makeContext({
      connectorKey: "sms_twilio",
      config: { accountSid: `AC${"a".repeat(32)}`, sender: "IAConnect" },
      secrets: { authToken: "t" },
      fetch: unauthorized,
    });
    expect((await smsTwilioConnector.verify(twilio)).status).toBe("expired");
    const stripe = makeContext({
      connectorKey: "payment_stripe",
      secrets: { secretKey: "sk_test_x" },
      fetch: unauthorized,
    });
    expect((await paymentStripeConnector.verify(stripe)).status).toBe("expired");
    const crm = makeContext({
      connectorKey: "crm_rest",
      config: {
        baseUrl: "https://gestionale.example.com/api",
        resources: { clienti: { listPath: "/clienti" } },
      },
      secrets: { authHeaderValue: "Bearer k" },
      fetch: unauthorized,
    });
    expect((await crmRestConnector.verify(crm)).status).toBe("expired");
  });
});

describe("Gmail", () => {
  const env = { GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "client-secret" };
  const fresh = {
    accessToken: "ya29.fresh",
    refreshToken: "1//refresh",
    expiresAt: NOW.getTime() + 3_600_000,
  };

  function decodeRaw(raw: string): string {
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    return Buffer.from(raw, "base64url").toString("utf8");
  }

  it("sends a valid base64url RFC 822 message, with reply headers and thread id", async () => {
    const { fetch, calls } = fakeFetch(() => json({ id: "18c0ffee", threadId: "thread-9" }));
    const context = makeContext({
      connectorKey: "gmail",
      config: { email: "agenzia@example.com" },
      secrets: { ...fresh },
      fetch,
      env,
    });
    const result = await gmailConnector.actions.send!.execute(context, {
      to: "mario.rossi@example.com",
      subject: "Il tuo preventivo è pronto",
      text: "Buongiorno Mario,\nin allegato il preventivo.",
      html: "<p>Buongiorno <b>Mario</b></p>",
      inReplyTo: "<CAF123@mail.example.com>",
      threadId: "thread-9",
    });
    expect(result).toEqual({ externalId: "18c0ffee", status: "sent" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(calls[0]!.headers.authorization).toBe("Bearer ya29.fresh");
    const body = JSON.parse(calls[0]!.body!);
    expect(body.threadId).toBe("thread-9");

    const message = decodeRaw(body.raw);
    const [head, ...rest] = message.split("\r\n\r\n");
    const headers = head!.split("\r\n");
    expect(headers).toContain("From: agenzia@example.com");
    expect(headers).toContain("To: mario.rossi@example.com");
    expect(headers).toContain("MIME-Version: 1.0");
    expect(headers).toContain("In-Reply-To: <CAF123@mail.example.com>");
    expect(headers).toContain("References: <CAF123@mail.example.com>");
    // Non-ASCII subject is RFC 2047 encoded.
    const subject = headers.find((line) => line.startsWith("Subject: "))!;
    const encoded = /^Subject: =\?UTF-8\?B\?(.+)\?=$/.exec(subject);
    expect(Buffer.from(encoded![1]!, "base64").toString("utf8")).toBe("Il tuo preventivo è pronto");
    const boundary = /boundary="([^"]+)"/.exec(head!)![1]!;
    const parts = rest.join("\r\n\r\n").split(`--${boundary}`);
    expect(parts).toHaveLength(4);
    expect(parts[1]).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(Buffer.from(parts[1]!.split("\r\n\r\n")[1]!, "base64").toString("utf8")).toBe(
      "Buongiorno Mario,\nin allegato il preventivo.",
    );
    expect(parts[2]).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(parts[3]!.startsWith("--")).toBe(true);
    // Every line fits the 76 character limit of base64 bodies and headers stay ASCII.
    for (const line of message.split("\r\n")) expect(line.length).toBeLessThanOrEqual(78);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the message is pure ASCII
    expect(message).toMatch(/^[\x00-\x7f]*$/);
  });

  it("strips line breaks from header values (no header injection)", async () => {
    const { fetch, calls } = fakeFetch(() => json({ id: "1" }));
    const context = makeContext({
      connectorKey: "gmail",
      config: { email: "a@example.com" },
      secrets: { ...fresh },
      fetch,
      env,
    });
    await gmailConnector.actions.send!.execute(context, {
      to: "x@example.com\r\nBcc: spy@example.com",
      subject: "Ciao\r\nX-Injected: 1",
      text: "testo",
    });
    const head = decodeRaw(JSON.parse(calls[0]!.body!).raw).split("\r\n\r\n")[0]!;
    expect(head.split("\r\n").some((line) => /^(Bcc|X-Injected):/.test(line))).toBe(false);
    expect(JSON.parse(calls[0]!.body!).threadId).toBeUndefined();
  });

  it("refreshes an expired access token, persists the new secrets and uses the new token", async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.url === "https://oauth2.googleapis.com/token") {
        return json({ access_token: "ya29.new", expires_in: 3599, token_type: "Bearer" });
      }
      return json({ id: "sent-1" });
    });
    const context = makeContext({
      connectorKey: "gmail",
      config: { email: "agenzia@example.com" },
      secrets: { accessToken: "ya29.old", refreshToken: "1//refresh", expiresAt: NOW.getTime() - 1000 },
      fetch,
      env,
    });
    await gmailConnector.actions.send!.execute(context, {
      to: "x@example.com",
      subject: "Ciao",
      text: "testo",
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    ]);
    const form = new URLSearchParams(calls[0]!.body);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "1//refresh",
      client_id: "client-id",
      client_secret: "client-secret",
    });
    expect(calls[1]!.headers.authorization).toBe("Bearer ya29.new");
    // Google does not return a new refresh token: the old one is kept.
    expect(context.saved).toEqual([
      { accessToken: "ya29.new", refreshToken: "1//refresh", expiresAt: NOW.getTime() + 3_599_000 },
    ]);
    expect(context.secrets.accessToken).toBe("ya29.new");
    // Nothing secret reaches the logs.
    expect(JSON.stringify(context.logs)).not.toMatch(/ya29|refresh\b.*1\/\//);
  });

  it("refreshes once and retries when the provider answers 401 to a token that looked valid", async () => {
    let sends = 0;
    const { fetch, calls } = fakeFetch((call) => {
      if (call.url.includes("oauth2.googleapis.com"))
        return json({ access_token: "ya29.new", expires_in: 3600 });
      sends += 1;
      return sends === 1 ? json({}, 401) : json({ id: "sent-2" });
    });
    const context = makeContext({
      connectorKey: "gmail",
      config: { email: "a@example.com" },
      secrets: { ...fresh },
      fetch,
      env,
    });
    const result = await gmailConnector.actions.send!.execute(context, {
      to: "x@example.com",
      subject: "s",
      text: "t",
    });
    expect(result.externalId).toBe("sent-2");
    expect(calls).toHaveLength(3);
    expect(context.saved).toHaveLength(1);
  });

  it("reports a revoked refresh token as `expired` on verify", async () => {
    const { fetch } = fakeFetch(() => json({ error: "invalid_grant" }, 400));
    const context = makeContext({
      connectorKey: "gmail",
      secrets: { accessToken: "old", refreshToken: "revoked", expiresAt: 0 },
      fetch,
      env,
    });
    expect((await gmailConnector.verify(context)).status).toBe("expired");
    expect(context.saved).toEqual([]);
  });

  it("exchanges the authorization code on connect", async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.url.includes("oauth2.googleapis.com")) {
        return json({ access_token: "ya29.first", refresh_token: "1//first", expires_in: 3600 });
      }
      return json({ emailAddress: "agenzia@example.com", historyId: "1000" });
    });
    const result = await gmailConnector.connect(
      { code: "4/abc", redirectUri: "https://app.example.com/oauth/callback" },
      { fetch, env },
    );
    expect(result.config).toEqual({ email: "agenzia@example.com" });
    expect(result.externalAccountId).toBe("agenzia@example.com");
    expect(result.secrets).toMatchObject({ accessToken: "ya29.first", refreshToken: "1//first" });
    expect(new URLSearchParams(calls[0]!.body).get("code")).toBe("4/abc");
    // Secrets never end up in the non-secret configuration.
    expect(JSON.stringify(result.config)).not.toContain("ya29");
  });

  it("polls new inbox messages from the history cursor and emits mail.received", async () => {
    const text = Buffer.from("Vorrei un preventivo per la casa").toString("base64url");
    const { fetch } = fakeFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname.endsWith("/history")) {
        expect(url.searchParams.get("startHistoryId")).toBe("1000");
        return json({
          historyId: "1010",
          history: [
            { messagesAdded: [{ message: { id: "m1" } }] },
            { messagesAdded: [{ message: { id: "m1" } }] },
          ],
        });
      }
      if (url.pathname.endsWith("/messages/m1")) {
        return json({
          id: "m1",
          threadId: "t1",
          labelIds: ["INBOX", "UNREAD"],
          internalDate: "1791100800000",
          payload: {
            mimeType: "multipart/alternative",
            headers: [
              { name: "From", value: "Mario Rossi <mario@example.com>" },
              { name: "To", value: "agenzia@example.com" },
              { name: "Subject", value: "Richiesta" },
              { name: "Message-ID", value: "<abc@mail.example.com>" },
            ],
            parts: [{ mimeType: "text/plain", body: { data: text } }],
          },
        });
      }
      return json({}, 404);
    });
    const context = makeContext({
      connectorKey: "gmail",
      config: { email: "agenzia@example.com" },
      secrets: { ...fresh },
      fetch,
      env,
    });
    const result = await gmailConnector.poll!(context, { historyId: "1000" });
    expect(result.cursor).toEqual({ historyId: "1010", lastInternalDate: 1791100800000 });
    expect(result.events).toEqual([
      {
        type: "mail.received",
        occurredAt: "2026-10-04T08:00:00.000Z",
        dedupeKey: "gmail:m1",
        payload: {
          from: "mario@example.com",
          fromName: "Mario Rossi",
          to: "agenzia@example.com",
          subject: "Richiesta",
          text: "Vorrei un preventivo per la casa",
          messageId: "<abc@mail.example.com>",
          threadId: "t1",
          externalId: "m1",
          attachments: [],
        },
        contact: { name: "Mario Rossi", email: "mario@example.com" },
      },
    ]);
  });

  it("starts from the current history id on the first poll, without replaying old mail", async () => {
    const { fetch } = fakeFetch(() => json({ emailAddress: "a@example.com", historyId: "777" }));
    const context = makeContext({ connectorKey: "gmail", secrets: { ...fresh }, fetch, env });
    expect(await gmailConnector.poll!(context, undefined)).toEqual({
      events: [],
      cursor: { historyId: "777", lastInternalDate: NOW.getTime() },
    });
  });
});

describe("other connectors", () => {
  it("waWebApi sends the rendered text of a template", async () => {
    const { fetch, calls } = fakeFetch(() => json({ id: "msg-1" }));
    const context = makeContext({
      connectorKey: "whatsapp_wawebapi",
      config: { sessionId: "ia-test" },
      secrets: { apiKey: "gateway-key", webhookSecret: "w" },
      fetch,
      env: { WAWEBAPI_BASE_URL: "https://wa.example.com/" },
    });
    const result = await whatsappWaWebApiConnector.actions.sendTemplate!.execute(context, {
      to: "3331234567",
      template: "preventivo",
      renderedText: "Ciao Mario, il preventivo è pronto",
    });
    expect(result.externalId).toBe("msg-1");
    expect(calls[0]!.url).toBe("https://wa.example.com/sessions/ia-test/messages");
    expect(calls[0]!.headers["x-api-key"]).toBe("gateway-key");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      to: "393331234567",
      text: "Ciao Mario, il preventivo è pronto",
    });
  });

  it("Twilio sends a form-encoded message with basic auth", async () => {
    const sid = `AC${"a".repeat(32)}`;
    const { fetch, calls } = fakeFetch(() => json({ sid: "SM9", status: "queued" }, 201));
    const context = makeContext({
      connectorKey: "sms_twilio",
      config: { accountSid: sid, sender: "IAConnect" },
      secrets: { authToken: "tok" },
      fetch,
    });
    const result = await smsTwilioConnector.actions.send!.execute(context, {
      to: "333 1234567",
      text: "Ciao",
    });
    expect(result).toEqual({ externalId: "SM9", status: "queued" });
    expect(calls[0]!.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`);
    expect(calls[0]!.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from(`${sid}:tok`).toString("base64")}`);
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toEqual({
      To: "+393331234567",
      From: "IAConnect",
      Body: "Ciao",
    });
  });

  it("Stripe creates a payment link with the reference in metadata and an idempotency key", async () => {
    const { fetch, calls } = fakeFetch(() => json({ id: "plink_1", url: "https://buy.stripe.com/test_1" }));
    const context = makeContext({
      connectorKey: "payment_stripe",
      secrets: { secretKey: "sk_test_abc" },
      fetch,
    });
    const result = await paymentStripeConnector.actions.createLink!.execute(context, {
      amountCents: 12050,
      description: "Polizza casa",
      reference: "pr_42",
    });
    expect(result).toEqual({ externalId: "plink_1", url: "https://buy.stripe.com/test_1" });
    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/payment_links");
    expect(calls[0]!.headers.authorization).toBe("Bearer sk_test_abc");
    expect(calls[0]!.headers["idempotency-key"]).toContain("pr_42");
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toEqual({
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": "12050",
      "line_items[0][price_data][product_data][name]": "Polizza casa",
      "metadata[reference]": "pr_42",
      "payment_intent_data[metadata][reference]": "pr_42",
    });
  });

  it("Stripe registerWebhook stores the endpoint secret", async () => {
    const { fetch } = fakeFetch(() => json({ id: "we_1", secret: "whsec_new" }));
    const context = makeContext({
      connectorKey: "payment_stripe",
      secrets: { secretKey: "sk_test_abc" },
      fetch,
    });
    await paymentStripeConnector.actions.registerWebhook!.execute(context, {
      url: "https://proj.supabase.co/functions/v1/webhook/c/tok",
    });
    expect(context.saved).toEqual([
      { secretKey: "sk_test_abc", webhookSecret: "whsec_new", webhookEndpointId: "we_1" },
    ]);
  });

  it("the REST adapter reads with query parameters and writes with POST or PUT", async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === "GET") return json({ data: { items: [{ codice: 7, nome: "Rossi" }] } });
      return json({ codice: 8 });
    });
    const context = makeContext({
      connectorKey: "crm_rest",
      config: {
        baseUrl: "https://gestionale.example.com/api/",
        authHeaderName: "X-Api-Key",
        resources: {
          clienti: {
            listPath: "/clienti",
            createPath: "/clienti",
            updatePath: "/clienti/{id}",
            idField: "codice",
            recordsPath: "data.items",
          },
        },
      },
      secrets: { authHeaderValue: "key-123" },
      fetch,
    });
    const read = await crmRestConnector.actions.read!.execute(context, {
      resource: "clienti",
      query: { telefono: "+39333", attivo: true },
    });
    expect(read).toEqual({ records: [{ codice: 7, nome: "Rossi" }] });
    expect(calls[0]!.url).toBe("https://gestionale.example.com/api/clienti?telefono=%2B39333&attivo=true");
    expect(calls[0]!.headers["x-api-key"]).toBe("key-123");

    const created = await crmRestConnector.actions.write!.execute(context, {
      resource: "clienti",
      data: { nome: "Verdi" },
    });
    expect(created).toEqual({ id: "8" });
    expect(calls[1]!.method).toBe("POST");
    const updated = await crmRestConnector.actions.write!.execute(context, {
      resource: "clienti",
      id: "a/b",
      data: { nome: "Verdi" },
    });
    expect(updated).toEqual({ id: "8" });
    expect(calls[2]!.method).toBe("PUT");
    expect(calls[2]!.url).toBe("https://gestionale.example.com/api/clienti/a%2Fb");

    const unknown = await failure(crmRestConnector.actions.read!.execute(context, { resource: "polizze" }));
    expect(unknown.retryable).toBe(false);
  });

  it("the REST adapter refuses private addresses", async () => {
    for (const baseUrl of [
      "http://localhost:8080",
      "http://192.168.1.10/api",
      "http://169.254.169.254/",
      "ftp://x.example",
    ]) {
      const error = await failure(
        crmRestConnector.connect(
          { baseUrl, authHeaderValue: "k", resources: { a: { listPath: "/a" } } },
          { fetch: fakeFetch(() => json([])).fetch, env: {} },
        ),
      );
      expect(error.retryable, baseUrl).toBe(false);
    }
  });

  it("the REST adapter emits crm.record.created only for records that appear after the first poll", async () => {
    let records = [{ id: 1 }, { id: 2 }];
    const { fetch } = fakeFetch(() => json(records));
    const context = makeContext({
      connectorKey: "crm_rest",
      config: {
        baseUrl: "https://gestionale.example.com",
        resources: { ordini: { listPath: "/ordini", watch: true } },
      },
      secrets: { authHeaderValue: "k" },
      fetch,
    });
    const first = await crmRestConnector.poll!(context, undefined);
    expect(first.events).toEqual([]);
    records = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const second = await crmRestConnector.poll!(context, first.cursor);
    expect(second.events).toEqual([
      {
        type: "crm.record.created",
        dedupeKey: `crm_rest:${context.connection.id}:ordini:3`,
        payload: { resource: "ordini", id: "3", data: { id: 3 } },
      },
    ]);
    expect((await crmRestConnector.poll!(context, second.cursor)).events).toEqual([]);
  });

  it("the REST adapter can emit every record on the first poll, under another event type and with a contact hint", async () => {
    const policies = [
      {
        policyUID: "0198-a",
        plate: "FX456DE",
        client_name: "ANNA VERDI",
        phone: "3337654321",
        email: "Anna@Example.com",
      },
      {
        policyUID: "0198-b",
        plate: "GA123BC",
        client_name: "MARIO ROSSI",
        phone: "+39 333 1234567",
        email: "",
      },
    ];
    const { fetch, calls } = fakeFetch(() => json({ status: "success", policies }));
    const context = makeContext({
      connectorKey: "crm_rest",
      config: {
        baseUrl: "https://gestionale.example.com",
        resources: {
          policies: {
            listPath: "/api/policies/expiring_api",
            recordsPath: "policies",
            idField: "policyUID",
            query: { client_code: "AG01" },
            watch: true,
            initialPoll: "emit",
            eventType: "policy.expiring",
            contactFields: { name: "client_name", phone: "phone", email: "email" },
          },
        },
      },
      secrets: { authHeaderValue: "Bearer k" },
      fetch,
    });
    const first = await crmRestConnector.poll!(context, undefined);
    expect(calls[0]!.url).toBe("https://gestionale.example.com/api/policies/expiring_api?client_code=AG01");
    expect(first.events).toEqual([
      {
        type: "policy.expiring",
        dedupeKey: `crm_rest:${context.connection.id}:policies:0198-a`,
        payload: { resource: "policies", id: "0198-a", data: policies[0] },
        contact: { name: "ANNA VERDI", phone: "+393337654321", email: "anna@example.com" },
      },
      {
        type: "policy.expiring",
        dedupeKey: `crm_rest:${context.connection.id}:policies:0198-b`,
        payload: { resource: "policies", id: "0198-b", data: policies[1] },
        contact: { name: "MARIO ROSSI", phone: "+393331234567" },
      },
    ]);
    expect(first.cursor).toEqual({ seen: { policies: ["0198-a", "0198-b"] } });
    // The same list again: nothing new. A record that appears later: one event.
    expect((await crmRestConnector.poll!(context, first.cursor)).events).toEqual([]);
    policies.push({ policyUID: "0198-c", plate: "AB000CD", client_name: "LUCA NERI", phone: "", email: "" });
    const third = await crmRestConnector.poll!(context, first.cursor);
    expect(third.events.map((event) => event.payload.id)).toEqual(["0198-c"]);
    expect(third.events[0]!.contact).toEqual({ name: "LUCA NERI" });
  });

  it("the REST adapter rejects an unknown event type at connect time", async () => {
    const error = await failure(
      crmRestConnector.connect(
        {
          baseUrl: "https://gestionale.example.com",
          authHeaderValue: "k",
          resources: { a: { listPath: "/a", watch: true, eventType: "whatsapp.message.receivedX" } },
        },
        { fetch: fakeFetch(() => json([])).fetch, env: {} },
      ),
    );
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("eventType");
  });

  it("the REST adapter maps the management system's error codes without echoing the body", async () => {
    const answer = (status: number, body: unknown) =>
      makeContext({
        connectorKey: "crm_rest",
        config: {
          baseUrl: "https://gestionale.example.com",
          resources: { policies: { listPath: "/api/policies/expiring_api", watch: true } },
        },
        secrets: { authHeaderValue: "Bearer secret-token" },
        fetch: fakeFetch(() => json(body, status)).fetch,
      });

    const revoked = answer(401, { status: "error", error: "token_revoked", detail: "SECRET-DETAIL" });
    expect(await crmRestConnector.verify(revoked)).toEqual({
      status: "expired",
      message: "Accesso scaduto o revocato: ricollega l'account.",
    });
    const revokedPoll = await failure(crmRestConnector.poll!(revoked, undefined));
    expect(revokedPoll.options.code).toBe("auth_expired");
    expect(revokedPoll.message).not.toContain("SECRET-DETAIL");

    const scope = answer(403, { status: "error", error: "scope_not_allowed" });
    const scopeError = await failure(crmRestConnector.poll!(scope, undefined));
    expect(scopeError.retryable).toBe(false);
    expect(scopeError.options.code).toBe("scope_not_allowed");
    expect(scopeError.message).toBe(
      "Gestionale: il token API non ha il permesso di leggere questa risorsa (scope_not_allowed): va abilitato nel gestionale",
    );
    // A permission problem is not an expired access: verify says what is wrong instead.
    expect(await crmRestConnector.verify(scope)).toEqual({ status: "error", message: scopeError.message });

    const mismatch = await failure(
      crmRestConnector.poll!(answer(403, { code: "client_code_mismatch" }), undefined),
    );
    expect(mismatch.options.code).toBe("client_code_mismatch");
    expect(mismatch.message).toContain("codice cliente");

    // A bare 403 still counts as a revoked key on verify (same as before).
    expect((await crmRestConnector.verify(answer(403, {}))).status).toBe("expired");
  });

  it("the generic inbound webhook does not support read and write", async () => {
    const context = makeContext({ connectorKey: "webhook_inbound" });
    for (const key of ["read", "write"]) {
      const error = await failure(
        webhookInboundConnector.actions[key]!.execute(context, { resource: "x", data: {} }),
      );
      expect(error.retryable).toBe(false);
      expect(error.message).toContain("non supportato");
    }
    const connected = await webhookInboundConnector.connect(
      {},
      { fetch: fakeFetch(() => json({})).fetch, env: {} },
    );
    expect(connected.secrets.signingSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(connected.config)).not.toContain(String(connected.secrets.signingSecret));
  });

  it("the signature placeholder returns the document URL as the signing link", async () => {
    const context = makeContext({ connectorKey: "signature_link" });
    const result = await signatureLinkConnector.actions.createRequest!.execute(context, {
      documentUrl: "https://docs.example.com/contratto.pdf",
      title: "Contratto",
      signerName: "Mario Rossi",
      signerEmail: "mario@example.com",
      reference: "sr_1",
    });
    expect(result.url).toBe("https://docs.example.com/contratto.pdf");
    expect(result.externalId).toMatch(/^sig_[0-9a-f-]{36}$/);
  });

  it("Google Calendar proposes free slots inside working hours, in the calendar's time zone", async () => {
    const settings = {
      calendarId: "primary",
      timeZone: "Europe/Rome",
      workdayStartHour: 9,
      workdayEndHour: 18,
      workDays: [1, 2, 3, 4, 5],
      slotStepMinutes: 30,
    };
    // Monday 2026-10-05, Rome is UTC+2: the working day is 07:00–16:00 UTC.
    const slots = computeFreeSlots({
      from: Date.parse("2026-10-05T00:00:00Z"),
      to: Date.parse("2026-10-07T00:00:00Z"),
      durationMinutes: 60,
      max: 3,
      busy: [{ start: Date.parse("2026-10-05T07:00:00Z"), end: Date.parse("2026-10-05T08:15:00Z") }],
      settings,
    });
    expect(slots).toEqual([
      { start: "2026-10-05T08:30:00.000Z", end: "2026-10-05T09:30:00.000Z" },
      { start: "2026-10-05T09:00:00.000Z", end: "2026-10-05T10:00:00.000Z" },
      { start: "2026-10-05T09:30:00.000Z", end: "2026-10-05T10:30:00.000Z" },
    ]);
    // After the switch to winter time (UTC+1) 9:00 in Rome is 08:00 UTC; weekends are skipped.
    const winter = computeFreeSlots({
      from: Date.parse("2026-10-31T00:00:00Z"),
      to: Date.parse("2026-11-03T00:00:00Z"),
      durationMinutes: 30,
      max: 1,
      busy: [],
      settings,
    });
    expect(winter).toEqual([{ start: "2026-11-02T08:00:00.000Z", end: "2026-11-02T08:30:00.000Z" }]);
    // The last slot of the day ends at 18:00 local time.
    const late = computeFreeSlots({
      from: Date.parse("2026-10-05T15:10:00Z"),
      to: Date.parse("2026-10-05T23:00:00Z"),
      durationMinutes: 30,
      max: 5,
      busy: [],
      settings,
    });
    expect(late).toEqual([{ start: "2026-10-05T15:30:00.000Z", end: "2026-10-05T16:00:00.000Z" }]);
  });

  it("Google Calendar asks freeBusy and creates the event", async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.url.endsWith("/freeBusy")) return json({ calendars: { primary: { busy: [] } } });
      return json({ id: "evt1", htmlLink: "https://calendar.google.com/event?eid=1" });
    });
    const context = makeContext({
      connectorKey: "google_calendar",
      config: { email: "a@example.com" },
      secrets: { accessToken: "ya29.x", refreshToken: "r", expiresAt: NOW.getTime() + 3_600_000 },
      fetch,
    });
    const found = await googleCalendarConnector.actions.findSlots!.execute(context, {
      from: "2026-10-05T00:00:00Z",
      to: "2026-10-06T00:00:00Z",
      durationMinutes: 45,
    });
    // `now` is 08:00 UTC: earlier slots of the day are not proposed.
    expect(found.slots).toHaveLength(3);
    expect(found.slots[0]).toEqual({ start: "2026-10-05T08:00:00.000Z", end: "2026-10-05T08:45:00.000Z" });
    const created = await googleCalendarConnector.actions.createEvent!.execute(context, {
      title: "Appuntamento",
      start: "2026-10-05T10:00:00+02:00",
      end: "2026-10-05T10:45:00+02:00",
      attendeeEmail: "mario@example.com",
    });
    expect(created).toEqual({ externalEventId: "evt1", url: "https://calendar.google.com/event?eid=1" });
    expect(JSON.parse(calls[1]!.body!)).toEqual({
      summary: "Appuntamento",
      start: { dateTime: "2026-10-05T10:00:00+02:00", timeZone: "Europe/Rome" },
      end: { dateTime: "2026-10-05T10:45:00+02:00", timeZone: "Europe/Rome" },
      attendees: [{ email: "mario@example.com" }],
    });
  });

  it("IMAP/SMTP verifies both logins on connect and maps a refused login to `expired`", async () => {
    const opened: string[] = [];
    const connector = createImapSmtpConnector({
      createImapClient: (options) => ({
        mailbox: false,
        connect: async () => {
          opened.push(`imap:${options.host}:${options.port}`);
          if (options.auth.pass === "wrong")
            throw Object.assign(new Error("no"), { authenticationFailed: true });
        },
        logout: async () => undefined,
        getMailboxLock: async () => ({ release() {} }),
        fetch: async function* () {},
      }),
      createSmtpTransport: (options) => ({
        verify: async () => {
          opened.push(`smtp:${options.host}:${options.port}`);
        },
        sendMail: async () => ({ messageId: "<sent@example.com>" }),
        close() {},
      }),
      parseMessage: async () => ({}),
    });
    const input = {
      email: "info@example.com",
      username: "info@example.com",
      password: "app-password",
      imapHost: "imap.example.com",
      smtpHost: "smtp.example.com",
    };
    const result = await connector.connect(input, { fetch: fakeFetch(() => json({})).fetch, env: {} });
    expect(opened).toEqual(["imap:imap.example.com:993", "smtp:smtp.example.com:465"]);
    expect(result.secrets).toEqual({ password: "app-password" });
    expect(JSON.stringify(result.config)).not.toContain("app-password");

    const context = makeContext({
      connectorKey: "imap_smtp",
      config: result.config,
      secrets: { password: "wrong" },
    });
    const health = await connector.verify(context);
    expect(health.status).toBe("expired");
    expect(health.message).not.toContain("wrong");

    const sent = await connector.actions.send!.execute(
      makeContext({ connectorKey: "imap_smtp", config: result.config, secrets: result.secrets }),
      { to: "x@example.com", subject: "s", text: "t" },
    );
    expect(sent).toEqual({ externalId: "<sent@example.com>", status: "sent" });
  });

  it("IMAP polling starts from the newest UID and then emits only newer messages", async () => {
    const mails = new Map<number, string>([
      [11, "primo"],
      [12, "secondo"],
    ]);
    const connector = createImapSmtpConnector({
      createImapClient: () => ({
        mailbox: { uidValidity: 5n, uidNext: 13 },
        connect: async () => undefined,
        logout: async () => undefined,
        getMailboxLock: async () => ({ release() {} }),
        fetch: async function* (range: string) {
          const [from, to] = range.split(":").map(Number);
          for (const [uid, text] of mails) {
            if (uid >= from! && uid <= to!) yield { uid, source: new TextEncoder().encode(text) };
          }
        },
      }),
      createSmtpTransport: () => ({ verify: async () => true, sendMail: async () => ({}), close() {} }),
      parseMessage: async (source) => {
        const text = new TextDecoder().decode(source);
        return {
          from: { value: [{ address: "mario@example.com", name: "Mario" }] },
          subject: text,
          text,
          messageId: `<${text}@example.com>`,
        };
      },
    });
    const context = makeContext({
      connectorKey: "imap_smtp",
      config: {
        imapHost: "imap.example.com",
        smtpHost: "smtp.example.com",
        username: "u",
        email: "u@example.com",
      },
      secrets: { password: "p" },
    });
    expect(await connector.poll!(context, undefined)).toEqual({
      events: [],
      cursor: { uidValidity: "5", lastUid: 12 },
    });
    const result = await connector.poll!(context, { uidValidity: "5", lastUid: 10 });
    expect(result.cursor).toEqual({ uidValidity: "5", lastUid: 12 });
    expect(result.events.map((event) => event.payload.subject)).toEqual(["primo", "secondo"]);
    expect(result.events[0]!.dedupeKey).toBe(`imap:${context.connection.id}:<primo@example.com>`);
  });
});
