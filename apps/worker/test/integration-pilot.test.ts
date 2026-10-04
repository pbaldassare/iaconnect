import { afterEach, describe, expect, it } from "vitest";
import { drain } from "../src/worker.ts";
import {
  type Integration,
  createIntegration,
  jsonResponse,
  leaks,
  metaWebhook,
  text,
} from "./integration-helpers.ts";

/**
 * The pilot flow (`insurance_quote_followup`) end to end with the real connectors and the
 * real Claude service: Gmail poll → mail.received → ai.extract → contact → WhatsApp template
 * → deal → wait → Meta webhook with the customer's reply → ai.reply → WhatsApp text → status.
 */

let t: Integration;
afterEach(async () => {
  expect(t?.net.unmatched ?? []).toEqual([]);
  await t?.db.close().catch(() => undefined);
});

const PHONE_NUMBER_ID = "106540352242922";
const WA_TOKEN = "EAAG-whatsapp-permanent-token";
const GMAIL_ACCESS = "ya29.gmail-access-token";
const GMAIL_REFRESH = "1//gmail-refresh-token";
const GRAPH_MESSAGES = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const MINUTE = 60_000;

const MAIL_TEXT =
  "Buongiorno, sono Mario Rossi (cell. 333 123 4567). Vorrei un preventivo per la RC auto della mia Panda.";

const gmailMessage = {
  id: "18f0a1b2c3d4e5f6",
  threadId: "18f0a1b2c3d4e5f0",
  labelIds: ["INBOX", "UNREAD"],
  snippet: "Buongiorno, sono Mario Rossi",
  internalDate: String(Date.now()),
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: "Mario Rossi <mario.rossi@example.com>" },
      { name: "To", value: "agenzia@example.com" },
      { name: "Subject", value: "Richiesta preventivo RC auto" },
      { name: "Message-ID", value: "<CAF123@mail.example.com>" },
    ],
    parts: [
      { mimeType: "text/plain", body: { size: 100, data: Buffer.from(MAIL_TEXT).toString("base64url") } },
      {
        mimeType: "text/html",
        body: { size: 120, data: Buffer.from(`<p>${MAIL_TEXT}</p>`).toString("base64url") },
      },
    ],
  },
};

const inboundWhatsApp = (id: string, body: string, at: Date) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "390212345678", phone_number_id: PHONE_NUMBER_ID },
            contacts: [{ profile: { name: "Mario" }, wa_id: "393331234567" }],
            messages: [
              {
                from: "393331234567",
                id,
                timestamp: String(Math.floor(at.getTime() / 1000)),
                type: "text",
                text: { body },
              },
            ],
          },
        },
      ],
    },
  ],
});

const statusWhatsApp = (id: string, status: string, at: Date) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "390212345678", phone_number_id: PHONE_NUMBER_ID },
            statuses: [
              {
                id,
                status,
                timestamp: String(Math.floor(at.getTime() / 1000)),
                recipient_id: "393331234567",
              },
            ],
          },
        },
      ],
    },
  ],
});

describe("pilot flow with real connectors and the real Claude service", () => {
  it("runs from the mail to the AI answer on WhatsApp and the delivery status", async () => {
    t = await createIntegration();
    const gmail = await t.connect("gmail", {
      config: { email: "agenzia@example.com" },
      secrets: { accessToken: GMAIL_ACCESS, refreshToken: GMAIL_REFRESH, expiresAt: Date.now() + 3_600_000 },
      externalAccountId: "agenzia@example.com",
    });
    const whatsapp = await t.connect("whatsapp_meta", {
      config: { phoneNumberId: PHONE_NUMBER_ID, wabaId: "102290129340398" },
      secrets: { accessToken: WA_TOKEN },
      externalAccountId: PHONE_NUMBER_ID,
    });

    // The flow exactly as seeded in the database by the migration generated from packages/core.
    const seeded = await t.one(
      "select definition, requirements from ia_connect.flow_templates where key = 'insurance_quote_followup'",
    );
    for (const template of seeded.requirements.messageTemplates) {
      // Approved on Meta under a provider-side name that differs from ours.
      await t.addTemplate({ name: template.name, body: template.body, externalName: `${template.name}_v2` });
    }
    await t.addFlow(seeded.definition, "Preventivi");

    // ── Gmail: first poll starts from "now", the second finds the mail ──
    let history: unknown = { historyId: "1000" };
    t.net.on("GET", `${GMAIL}/profile`, { emailAddress: "agenzia@example.com", historyId: "1000" });
    t.net.on("GET", `${GMAIL}/history`, () => jsonResponse(history));
    t.net.on("GET", `${GMAIL}/messages/${gmailMessage.id}`, gmailMessage);
    let sent = 0;
    t.net.on("POST", GRAPH_MESSAGES, () =>
      jsonResponse({
        messaging_product: "whatsapp",
        contacts: [{ input: "393331234567", wa_id: "393331234567" }],
        messages: [{ id: `wamid.OUT${++sent}` }],
      }),
    );

    await t.addJob("poll_connection", { connection_id: gmail.id }, `poll:${gmail.id}`);
    await drain(t.deps);
    expect(await t.all("select 1 from ia_connect.events")).toHaveLength(0);
    expect(
      (await t.one("select config from ia_connect.connections where id = $1", [gmail.id])).config,
    ).toMatchObject({ email: "agenzia@example.com", cursor: { historyId: "1000" } });

    history = {
      historyId: "1010",
      history: [{ id: "1005", messagesAdded: [{ message: { id: gmailMessage.id } }] }],
    };
    t.claude.push(
      text({
        name: "Mario Rossi",
        phone: "333 123 4567",
        email: "mario.rossi@example.com",
        product: "RC auto",
      }),
    );
    t.advance(5 * MINUTE + 1_000);
    await drain(t.deps);

    // The event as the Gmail connector wrote it.
    const event = await t.one("select * from ia_connect.events");
    expect(event).toMatchObject({
      type: "mail.received",
      connection_id: gmail.id,
      dedupe_key: `gmail:${gmailMessage.id}`,
      status: "processed",
    });
    expect(event.payload).toMatchObject({
      from: "mario.rossi@example.com",
      fromName: "Mario Rossi",
      subject: "Richiesta preventivo RC auto",
      text: MAIL_TEXT,
      messageId: "<CAF123@mail.example.com>",
      threadId: gmailMessage.threadId,
    });
    expect(t.net.to(`${GMAIL}/history`)[0]!.headers.authorization).toBe(`Bearer ${GMAIL_ACCESS}`);
    expect(t.net.to(`${GMAIL}/history`)[0]!.url).toContain("startHistoryId=1000");

    // ai.extract went through the real service: cheap model, the mail as data in <testo>.
    const extract = t.claude.requests[0]!;
    expect(extract.model).toBe("claude-haiku-4-5");
    expect(JSON.stringify(extract.messages)).toContain(MAIL_TEXT);
    expect(String(extract.system)).not.toContain("Mario");

    // Contact: the one created from the mail, completed with phone and WhatsApp consent.
    const contact = await t.one("select * from ia_connect.contacts");
    expect(contact).toMatchObject({
      full_name: "Mario Rossi",
      phones: ["+393331234567"],
      emails: ["mario.rossi@example.com"],
      custom_fields: { prodotto: "RC auto" },
    });
    expect(contact.consents.whatsapp).toMatchObject({
      granted: true,
      source: "Richiesta di preventivo via mail",
    });
    expect(contact.consents.mail).toMatchObject({ granted: true });

    // whatsapp.send_template → the real Meta connector → Graph API request.
    const [templateCall] = t.net.to(GRAPH_MESSAGES, "POST");
    expect(templateCall!.headers.authorization).toBe(`Bearer ${WA_TOKEN}`);
    expect(templateCall!.json).toEqual({
      messaging_product: "whatsapp",
      to: "393331234567",
      type: "template",
      template: {
        name: "preventivo_pronto_v2",
        language: { code: "it" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Mario Rossi" },
              { type: "text", text: "RC auto" },
            ],
          },
        ],
      },
    });
    const templateMessage = await t.one(
      "select m.*, c.channel as conv_channel, c.connection_id from ia_connect.messages m join ia_connect.conversations c on c.id = m.conversation_id where m.direction = 'out'",
    );
    expect(templateMessage).toMatchObject({
      channel: "whatsapp",
      external_id: "wamid.OUT1",
      delivery_status: "sent",
      connection_id: whatsapp.id,
      content:
        "Buongiorno Mario Rossi, abbiamo ricevuto la sua richiesta di preventivo per RC auto. Le rispondiamo qui su WhatsApp: può scriverci per qualsiasi domanda. Questo è un messaggio automatico.",
    });
    expect(templateMessage.template_id).toBeTruthy();

    // Deal, then the run waits for the reply.
    const deal = await t.one(
      "select d.title, s.key as stage from ia_connect.deals d join ia_connect.deal_stages s on s.id = d.stage_id",
    );
    expect(deal).toEqual({ title: "Preventivo RC auto · Mario Rossi", stage: "quote_sent" });
    let run = await t.one("select * from ia_connect.flow_runs");
    expect(run).toMatchObject({ status: "waiting", waiting_for: "reply", current_step_id: "wait_reply" });

    // ── A third poll that sees the same Gmail message again creates nothing ──
    t.advance(5 * MINUTE + 1_000);
    await drain(t.deps);
    expect(await t.all("select 1 from ia_connect.events")).toHaveLength(1);
    expect(await t.all("select 1 from ia_connect.flow_runs")).toHaveLength(1);

    // ── The customer answers on WhatsApp: real Meta payload through the real webhook handler ──
    const question = "Grazie! Che franchigia è prevista per i cristalli?";
    const reply =
      "Buongiorno, la franchigia sui cristalli la verifica una persona dello staff e le rispondiamo qui.";
    t.claude.push(text({ text: reply, outcome: "continue" }));
    const delivery = inboundWhatsApp("wamid.IN1", question, t.now());
    expect((await t.webhook(metaWebhook("whatsapp_meta", delivery))).status).toBe(200);
    // A forged signature stores nothing; a redelivery is dropped by the dedupe key.
    expect((await t.webhook(metaWebhook("whatsapp_meta", delivery, "wrong-secret"))).status).toBe(401);
    expect((await t.webhook(metaWebhook("whatsapp_meta", delivery))).status).toBe(200);
    const inboundEvents = await t.all(
      "select * from ia_connect.events where type = 'whatsapp.message.received'",
    );
    expect(inboundEvents).toHaveLength(1);
    expect(inboundEvents[0]).toMatchObject({
      connection_id: whatsapp.id,
      contact_hint: { phone: "+393331234567" },
    });
    expect(inboundEvents[0].payload).toMatchObject({
      from: "+393331234567",
      text: question,
      messageId: "wamid.IN1",
    });

    await drain(t.deps);

    // The inbound message joined the WhatsApp conversation of the same contact.
    const inbound = await t.one(
      "select * from ia_connect.messages where direction = 'in' and channel = 'whatsapp'",
    );
    expect(inbound).toMatchObject({
      content: question,
      external_id: "wamid.IN1",
      conversation_id: templateMessage.conversation_id,
    });
    expect(await t.all("select 1 from ia_connect.contacts")).toHaveLength(1);

    // ai.reply through the real service: capable model, scope in the system prompt, the
    // customer's words only as a user turn.
    const replyRequest = t.claude.requests[1]!;
    expect(replyRequest.model).toBe("claude-opus-5-5");
    expect(String(replyRequest.system)).toContain("Domande sul preventivo assicurativo richiesto");
    expect(String(replyRequest.system)).toContain("Agenzia Rossi");
    expect(String(replyRequest.system)).not.toContain("franchigia è prevista");
    expect(replyRequest.messages.at(-1)).toEqual({ role: "user", content: question });
    expect(replyRequest.messages.at(-2)).toMatchObject({
      role: "assistant",
      content: templateMessage.content,
    });

    // The answer left with sendText, unchanged (the conversation already had an automatic message).
    const textCall = t.net.to(GRAPH_MESSAGES, "POST")[1]!;
    expect(textCall.json).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "393331234567",
      type: "text",
      text: { preview_url: false, body: reply },
    });
    const answer = await t.one("select * from ia_connect.messages where external_id = 'wamid.OUT2'");
    expect(answer).toMatchObject({
      content: reply,
      ai_generated: true,
      ai_model: "claude-opus-5-5",
      delivery_status: "sent",
    });
    run = await t.one("select * from ia_connect.flow_runs");
    expect(run).toMatchObject({ status: "waiting", waiting_for: "reply", current_step_id: "answer" });

    // Every AI call is metered with the model and the cost computed by packages/ai.
    const aiCalls = await t.all(
      "select purpose, model, cost_micros, credits from ia_connect.ai_calls order by created_at",
    );
    expect(aiCalls.map((row) => [row.purpose, row.model])).toEqual([
      ["ai.extract", "claude-haiku-4-5"],
      ["ai.reply", "claude-opus-5-5"],
    ]);
    expect(Number(aiCalls[0].cost_micros)).toBe(900 * 1 + 150 * 5);
    expect(Number(aiCalls[1].cost_micros)).toBe(900 * 4 + 150 * 20);

    // ── Delivery status webhooks update the message, never backwards ──
    expect(
      (await t.webhook(metaWebhook("whatsapp_meta", statusWhatsApp("wamid.OUT2", "read", t.now())))).status,
    ).toBe(200);
    expect(
      (await t.webhook(metaWebhook("whatsapp_meta", statusWhatsApp("wamid.OUT2", "delivered", t.now()))))
        .status,
    ).toBe(200);
    await drain(t.deps);
    expect(
      (await t.one("select delivery_status from ia_connect.messages where external_id = 'wamid.OUT2'"))
        .delivery_status,
    ).toBe("read");
    expect(
      await t.all(
        "select status from ia_connect.events where type = 'whatsapp.status.updated' and status <> 'processed'",
      ),
    ).toEqual([]);

    // ── A second question: the model closes, the run moves the deal and ends ──
    t.claude.push(text({ text: "Perfetto, resto a disposizione.", outcome: "done" }));
    await t.webhook(metaWebhook("whatsapp_meta", inboundWhatsApp("wamid.IN2", "Va bene, grazie", t.now())));
    await drain(t.deps);
    run = await t.one("select * from ia_connect.flow_runs");
    expect(run).toMatchObject({ status: "completed", error: null });
    expect(
      (await t.one("select s.key from ia_connect.deals d join ia_connect.deal_stages s on s.id = d.stage_id"))
        .key,
    ).toBe("negotiation");
    expect(t.net.to(GRAPH_MESSAGES, "POST")).toHaveLength(3);

    // Nothing secret reached a table or a log line.
    expect(await leaks(t, [WA_TOKEN, GMAIL_ACCESS, GMAIL_REFRESH, "meta-app-secret-for-tests"])).toEqual([]);
    expect(t.logs.join("\n")).not.toContain(question);
  });
});
