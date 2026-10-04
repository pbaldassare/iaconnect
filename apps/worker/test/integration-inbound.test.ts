import { afterEach, describe, expect, it } from "vitest";
import { drain } from "../src/worker.ts";
import { ENV, type Integration, createIntegration, jsonResponse, leaks } from "./integration-helpers.ts";

/**
 * Event shapes of the other connectors that emit inbound messages: what they write must be
 * what the worker's inbound processing reads (sender, name, text, message id, thread,
 * platform), and the answer must go back through the same connector.
 * WhatsApp (Meta), Gmail, Twilio and Messenger are covered by the pilot and actions suites.
 */

let t: Integration;
afterEach(async () => {
  expect(t?.net.unmatched ?? []).toEqual([]);
  await t?.db.close().catch(() => undefined);
});

const post = (token: string, headers: Record<string, string>, body: unknown) =>
  new Request(`${ENV.WEBHOOK_PUBLIC_URL}/c/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

async function inboundRow(it: Integration) {
  return it.one(
    `select m.content, m.external_id, m.meta, v.channel, v.connection_id, v.external_thread_id, v.window_expires_at,
            c.full_name, c.phones, c.emails, c.external_ids, c.consents
     from ia_connect.messages m join ia_connect.conversations v on v.id = m.conversation_id
     join ia_connect.contacts c on c.id = v.contact_id where m.direction = 'in'`,
  );
}

describe("WhatsApp via QR (waWebApi)", () => {
  it("stores the inbound message, sends the rendered template text and follows the status", async () => {
    t = await createIntegration({
      config: { env: { ...ENV, WAWEBAPI_BASE_URL: "https://wa-gateway.example.com" } },
    });
    const wa = await t.connect("whatsapp_wawebapi", {
      config: { sessionId: "ia-session-1" },
      secrets: { apiKey: "wawebapi-key-123", webhookSecret: "wawebapi-webhook-secret" },
      externalAccountId: "ia-session-1",
    });
    t.net.on("POST", "https://wa-gateway.example.com/sessions/ia-session-1/messages", { id: "wa-out-1" });
    await t.addTemplate({ name: "grazie", body: "Grazie {{1}}, la ricontattiamo per {{2}}." });
    await t.addFlow({
      trigger: { event: "whatsapp.message.received", filters: [] },
      steps: [
        {
          id: "send",
          block: "whatsapp.send_template",
          params: { template: "grazie", variables: { "2": "il preventivo", "1": "{{contact.full_name}}" } },
        },
      ],
    });
    const secret = { "x-webhook-secret": "wawebapi-webhook-secret" };
    const response = await t.webhook(
      post(wa.webhookToken, secret, {
        event: "message",
        data: {
          id: "wa-in-1",
          from: "393331234567",
          fromName: "Mario Rossi",
          text: "Buongiorno",
          timestamp: Math.floor(t.now().getTime() / 1000),
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(
      (await t.webhook(post(wa.webhookToken, { "x-webhook-secret": "wrong" }, { event: "message" }))).status,
    ).toBe(401);
    await drain(t.deps);

    const inbound = await inboundRow(t);
    expect(inbound).toMatchObject({
      content: "Buongiorno",
      external_id: "wa-in-1",
      channel: "whatsapp",
      connection_id: wa.id,
      full_name: "Mario Rossi",
      phones: ["+393331234567"],
    });
    expect(inbound.window_expires_at).toBeTruthy();
    // No provider-side templates here: the connector sends the text the engine rendered,
    // with the variables in numeric order whatever the order of the keys.
    const [call] = t.net.to("https://wa-gateway.example.com/sessions/ia-session-1/messages");
    expect(call!.headers["x-api-key"]).toBe("wawebapi-key-123");
    expect(call!.json).toEqual({
      to: "393331234567",
      text: "Grazie Mario Rossi, la ricontattiamo per il preventivo.",
    });

    await t.webhook(
      post(wa.webhookToken, secret, { event: "status", data: { id: "wa-out-1", status: "delivered" } }),
    );
    await drain(t.deps);
    expect(
      await t.one("select delivery_status from ia_connect.messages where external_id = 'wa-out-1'"),
    ).toEqual({ delivery_status: "delivered" });
    expect(await leaks(t, ["wawebapi-key-123", "wawebapi-webhook-secret"])).toEqual([]);
  });
});

describe("social through GoHighLevel", () => {
  it("answers an Instagram message on Instagram", async () => {
    t = await createIntegration();
    const ghl = await t.connect("ghl_social", {
      config: { locationId: "loc_123", socialAccountIds: ["acc_1"] },
      secrets: { privateToken: "pit-ghl-token-123", webhookSecret: "ghl-webhook-secret-123" },
      externalAccountId: "loc_123",
    });
    t.net.on("POST", "https://services.leadconnectorhq.com/conversations/messages", {
      messageId: "ghl-out-1",
    });
    await t.addFlow({
      trigger: { event: "social.message.received", filters: [] },
      steps: [{ id: "answer", block: "social.send_message", params: { text: "Grazie del messaggio." } }],
    });
    const response = await t.webhook(
      post(
        ghl.webhookToken,
        { "x-ia-webhook-secret": "ghl-webhook-secret-123" },
        {
          type: "InboundMessage",
          locationId: "loc_123",
          contactId: "ghl-contact-9",
          contactName: "Anna Bianchi",
          messageId: "ghl-in-1",
          messageType: "TYPE_INSTAGRAM",
          direction: "inbound",
          body: "Ciao, siete aperti sabato?",
          dateAdded: t.now().toISOString(),
        },
      ),
    );
    expect(response.status).toBe(200);
    await drain(t.deps);

    const inbound = await inboundRow(t);
    expect(inbound).toMatchObject({
      content: "Ciao, siete aperti sabato?",
      external_id: "ghl-in-1",
      channel: "social",
      connection_id: ghl.id,
      full_name: "Anna Bianchi",
      external_ids: { social: "ghl-contact-9" },
    });
    expect(inbound.meta.platform).toBe("instagram");
    const [call] = t.net.to("https://services.leadconnectorhq.com/conversations/messages");
    expect(call!.headers.authorization).toBe("Bearer pit-ghl-token-123");
    expect(call!.json).toEqual({
      type: "IG",
      contactId: "ghl-contact-9",
      message: "Grazie del messaggio.\n\nQuesto è un messaggio automatico.",
    });
    expect(await leaks(t, ["pit-ghl-token-123", "ghl-webhook-secret-123"])).toEqual([]);
  });
});

describe("mail through Microsoft 365", () => {
  it("polls the inbox once per message and answers with a reply to the original", async () => {
    t = await createIntegration({
      config: { env: { ...ENV, MICROSOFT_CLIENT_ID: "ms-client", MICROSOFT_CLIENT_SECRET: "ms-secret-123" } },
    });
    const GRAPH = "https://graph.microsoft.com/v1.0";
    const m365 = await t.connect("microsoft365", {
      config: { email: "agenzia@example.com" },
      secrets: {
        accessToken: "ms-access-token",
        refreshToken: "ms-refresh-token",
        expiresAt: Date.now() + 3_600_000,
      },
    });
    const message = {
      id: "AAMkAGI2",
      internetMessageId: "<DB7PR01.abc@outlook.com>",
      conversationId: "AAQkAGI2conv",
      subject: "Richiesta informazioni",
      receivedDateTime: new Date(Date.now() + 60_000).toISOString(),
      from: { emailAddress: { name: "Luca Verdi", address: "Luca.Verdi@example.com" } },
      toRecipients: [{ emailAddress: { address: "agenzia@example.com" } }],
      body: { contentType: "text", content: "Buongiorno, vorrei informazioni sulla polizza casa." },
      hasAttachments: false,
    };
    t.net.on("GET", `${GRAPH}/me/mailFolders/inbox/messages`, { value: [message] });
    t.net.on("GET", `${GRAPH}/me/messages`, { value: [{ id: "AAMkAGI2" }] });
    t.net.on("POST", `${GRAPH}/me/messages/AAMkAGI2/reply`, () => new Response(null, { status: 202 }));
    await t.addFlow({
      trigger: { event: "mail.received", filters: [] },
      steps: [
        {
          id: "ack",
          block: "mail.send",
          params: { subject: "Re: {{event.payload.subject}}", body: "Ricevuto." },
        },
      ],
    });

    await t.addJob("poll_connection", { connection_id: m365.id }, `poll:${m365.id}`);
    await drain(t.deps);
    expect(await t.all("select 1 from ia_connect.events")).toHaveLength(0);
    t.advance(5 * 60_000 + 1_000);
    await drain(t.deps);
    t.advance(5 * 60_000 + 1_000);
    await drain(t.deps);

    // Polled twice with the same message in the answer: one event, one run, one reply.
    expect(await t.all("select dedupe_key from ia_connect.events")).toEqual([
      { dedupe_key: "microsoft365:<DB7PR01.abc@outlook.com>" },
    ]);
    const inbound = await inboundRow(t);
    expect(inbound).toMatchObject({
      content: "Buongiorno, vorrei informazioni sulla polizza casa.",
      external_id: "<DB7PR01.abc@outlook.com>",
      channel: "mail",
      connection_id: m365.id,
      external_thread_id: "AAQkAGI2conv",
      full_name: "Luca Verdi",
      emails: ["luca.verdi@example.com"],
    });
    expect(inbound.meta.subject).toBe("Richiesta informazioni");
    const lookup = t.net.to(`${GRAPH}/me/messages?`);
    expect(lookup).toHaveLength(1);
    expect(new URL(lookup[0]!.url).searchParams.get("$filter")).toBe(
      "internetMessageId eq '<DB7PR01.abc@outlook.com>'",
    );
    const replies = t.net.to(`${GRAPH}/me/messages/AAMkAGI2/reply`);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.headers.authorization).toBe("Bearer ms-access-token");
    expect(replies[0]!.json).toEqual({
      message: {
        toRecipients: [{ emailAddress: { address: "luca.verdi@example.com" } }],
        body: { contentType: "Text", content: "Ricevuto.\n\nQuesto è un messaggio automatico." },
      },
    });
    expect(await t.one("select delivery_status from ia_connect.messages where direction = 'out'")).toEqual({
      delivery_status: "queued",
    });
    expect(await leaks(t, ["ms-access-token", "ms-refresh-token"])).toEqual([]);
  });

  it("reports a provider outage as a retryable step, then delivers", async () => {
    t = await createIntegration();
    await t.connect("gmail", {
      config: { email: "agenzia@example.com" },
      secrets: { accessToken: "ya29.valid", refreshToken: "1//r", expiresAt: Date.now() + 3_600_000 },
    });
    let calls = 0;
    t.net.on("POST", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", () =>
      ++calls === 1
        ? jsonResponse({ error: { code: 503, message: "Backend Error for agenzia@example.com" } }, 503)
        : jsonResponse({ id: "18f0sent" }),
    );
    await t.addFlow({
      trigger: { event: "manual.test", filters: [] },
      steps: [
        {
          id: "contact",
          block: "contact.upsert",
          params: { email: "mario.rossi@example.com", consent: { channel: "mail", source: "Prova" } },
        },
        { id: "mail", block: "mail.send", params: { subject: "Conferma", body: "Confermato." } },
      ],
    });
    await t.addEvent("manual.test", {});
    await drain(t.deps);
    const waiting = await t.one("select status, waiting_for, error from ia_connect.flow_runs");
    expect(waiting).toEqual({
      status: "waiting",
      waiting_for: "timer",
      error: "Gmail: richiesta non riuscita (HTTP 503)",
    });
    t.advance(31_000);
    await drain(t.deps);
    expect((await t.one("select status from ia_connect.flow_runs")).status).toBe("completed");
    expect(await t.all("select external_id from ia_connect.messages")).toEqual([{ external_id: "18f0sent" }]);
    // One message counted against the monthly quota, not two.
    expect(
      Number((await t.one("select ia_connect.quota_left($1, 'messages') as left", [t.orgId])).left),
    ).toBe(99);
    expect(await leaks(t, ["Backend Error"])).toEqual([]);
  });
});
