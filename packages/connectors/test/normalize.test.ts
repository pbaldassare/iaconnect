import { NormalizedEventInputSchema } from "@ia-connect/core";
import { describe, expect, it } from "vitest";
import { metaSocialConnector, paymentStripeConnector } from "../src/index.ts";
import { normalizeStripeEvent } from "../src/payment-stripe.ts";
import { normalizeTwilioWebhook } from "../src/sms-twilio.ts";
import { normalizeWhatsAppWebhook, whatsAppAccountIds } from "../src/whatsapp-meta.ts";
import {
  PAGE_ID,
  PHONE_NUMBER_ID,
  fakeFetch,
  hmacHex,
  json,
  makeContext,
  metaLeadPayload,
  whatsappInboundPayload,
  whatsappStatusPayload,
} from "./helpers.ts";

describe("WhatsApp (Meta) normalization", () => {
  it("turns an inbound text message into whatsapp.message.received", () => {
    const events = normalizeWhatsAppWebhook(whatsappInboundPayload, PHONE_NUMBER_ID);
    expect(events).toEqual([
      {
        type: "whatsapp.message.received",
        occurredAt: "2026-10-04T08:00:00.000Z",
        dedupeKey: "whatsapp_meta:msg:wamid.HBgMMzkzMzMxMjM0NTY3FQIAEhgUM0EwQjQ1",
        payload: {
          from: "+393331234567",
          fromName: "Mario Rossi",
          text: "Buongiorno, vorrei un preventivo",
          messageId: "wamid.HBgMMzkzMzMxMjM0NTY3FQIAEhgUM0EwQjQ1",
          messageType: "text",
        },
        contact: { name: "Mario Rossi", phone: "+393331234567" },
      },
    ]);
    for (const event of events) expect(NormalizedEventInputSchema.safeParse(event).success).toBe(true);
  });

  it("turns delivery statuses into whatsapp.status.updated, with the error of a failed one", () => {
    const events = normalizeWhatsAppWebhook(whatsappStatusPayload, PHONE_NUMBER_ID);
    expect(events).toEqual([
      {
        type: "whatsapp.status.updated",
        occurredAt: "2026-10-04T08:01:00.000Z",
        dedupeKey: "whatsapp_meta:status:wamid.OUT1:delivered",
        payload: { messageId: "wamid.OUT1", status: "delivered", to: "+393331234567" },
      },
      {
        type: "whatsapp.status.updated",
        occurredAt: "2026-10-04T08:01:01.000Z",
        dedupeKey: "whatsapp_meta:status:wamid.OUT2:failed",
        payload: {
          messageId: "wamid.OUT2",
          status: "failed",
          error: "Message undeliverable",
          errorCode: "131026",
          to: "+393339999999",
        },
      },
    ]);
  });

  it("ignores deliveries addressed to another phone number", () => {
    expect(whatsAppAccountIds(whatsappInboundPayload)).toEqual([PHONE_NUMBER_ID]);
    expect(normalizeWhatsAppWebhook(whatsappInboundPayload, "999")).toEqual([]);
    expect(normalizeWhatsAppWebhook({ object: "page", entry: [] }, PHONE_NUMBER_ID)).toEqual([]);
  });

  it("reads button and interactive replies as text", () => {
    const payload = structuredClone(whatsappInboundPayload);
    const messages = payload.entry[0]!.changes[0]!.value.messages as Record<string, unknown>[];
    messages[0] = {
      from: "393331234567",
      id: "wamid.B",
      timestamp: "1791100800",
      type: "button",
      button: { text: "Sì" },
    };
    messages[1] = {
      from: "393331234567",
      id: "wamid.I",
      timestamp: "1791100800",
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: "ok", title: "Confermo" } },
    };
    const events = normalizeWhatsAppWebhook(payload, PHONE_NUMBER_ID);
    expect(events.map((event) => event.payload.text)).toEqual(["Sì", "Confermo"]);
  });
});

describe("Meta lead ads normalization", () => {
  const env = { META_APP_SECRET: "meta-app-secret" };
  const rawBody = JSON.stringify(metaLeadPayload);
  const signed = {
    method: "POST",
    headers: { "x-hub-signature-256": `sha256=${hmacHex("meta-app-secret", rawBody)}` },
    query: {},
    rawBody,
  };

  it("fetches the lead's answers with the page token and emits social.lead.received", async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.url.includes("/444555666777")) {
        return json({
          id: "444555666777",
          created_time: "2026-10-04T08:00:00+0000",
          form_id: "999888777",
          field_data: [
            { name: "full_name", values: ["Giulia Verdi"] },
            { name: "email", values: ["giulia@example.com"] },
            { name: "phone_number", values: ["333 765 4321"] },
            { name: "tipo_di_polizza", values: ["Casa"] },
          ],
        });
      }
      if (call.url.includes("/999888777")) return json({ name: "Preventivo casa", id: "999888777" });
      return json({}, 404);
    });
    const context = makeContext({
      connectorKey: "meta_social",
      config: { pageId: PAGE_ID },
      secrets: { pageAccessToken: "page-token" },
      fetch,
      env,
    });
    const result = await metaSocialConnector.handleWebhook!(context, signed);
    expect(result.verified).toBe(true);
    expect(result.events).toEqual([
      {
        type: "social.lead.received",
        occurredAt: "2026-10-04T08:00:00.000Z",
        dedupeKey: "meta_social:lead:444555666777",
        payload: {
          name: "Giulia Verdi",
          phone: "+393337654321",
          email: "giulia@example.com",
          formName: "Preventivo casa",
          fields: {
            full_name: "Giulia Verdi",
            email: "giulia@example.com",
            phone_number: "333 765 4321",
            tipo_di_polizza: "Casa",
          },
          platform: "facebook",
          leadId: "444555666777",
          formId: "999888777",
        },
        contact: { name: "Giulia Verdi", phone: "+393337654321", email: "giulia@example.com" },
      },
    ]);
    expect(NormalizedEventInputSchema.safeParse(result.events[0]).success).toBe(true);
    // The token travels in a header, never in the URL.
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.headers.authorization).toBe("Bearer page-token");
      expect(call.url).not.toContain("page-token");
      expect(call.url.startsWith("https://graph.facebook.com/")).toBe(true);
    }
  });

  it("ignores entries of another page and never fetches for them", async () => {
    const context = makeContext({
      connectorKey: "meta_social",
      config: { pageId: "another-page" },
      secrets: { pageAccessToken: "page-token" },
      env,
    });
    const result = await metaSocialConnector.handleWebhook!(context, signed);
    expect(result).toEqual({ verified: true, events: [] });
  });

  it("normalizes Messenger messages and page comments, skipping echoes and the page's own comments", async () => {
    const body = JSON.stringify({
      object: "page",
      entry: [
        {
          id: PAGE_ID,
          messaging: [
            {
              sender: { id: "7001" },
              recipient: { id: PAGE_ID },
              timestamp: 1791100800000,
              message: { mid: "m_abc", text: "Siete aperti sabato?" },
            },
            {
              sender: { id: PAGE_ID },
              recipient: { id: "7001" },
              timestamp: 1791100801000,
              message: { mid: "m_echo", text: "Sì", is_echo: true },
            },
          ],
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                comment_id: "555_666",
                post_id: `${PAGE_ID}_555`,
                from: { id: "7002", name: "Paola Neri" },
                message: "Quanto costa?",
                created_time: 1791100800,
              },
            },
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                comment_id: "555_667",
                from: { id: PAGE_ID },
                message: "x",
              },
            },
          ],
        },
      ],
    });
    const context = makeContext({
      connectorKey: "meta_social",
      config: { pageId: PAGE_ID },
      secrets: { pageAccessToken: "page-token" },
      env,
    });
    const result = await metaSocialConnector.handleWebhook!(context, {
      method: "POST",
      headers: { "x-hub-signature-256": `sha256=${hmacHex("meta-app-secret", body)}` },
      query: {},
      rawBody: body,
    });
    expect(result.events).toEqual([
      {
        type: "social.message.received",
        occurredAt: "2026-10-04T08:00:00.000Z",
        dedupeKey: "meta_social:msg:m_abc",
        payload: { from: "7001", text: "Siete aperti sabato?", messageId: "m_abc", platform: "facebook" },
      },
      {
        type: "social.comment.received",
        occurredAt: "2026-10-04T08:00:00.000Z",
        dedupeKey: "meta_social:comment:fb:555_666",
        payload: {
          from: "7002",
          fromName: "Paola Neri",
          text: "Quanto costa?",
          commentId: "555_666",
          postId: `${PAGE_ID}_555`,
          platform: "facebook",
        },
      },
    ]);
  });
});

describe("Twilio normalization", () => {
  it("turns an inbound SMS into sms.received", () => {
    const params = new URLSearchParams({
      MessageSid: "SM1234567890abcdef1234567890abcdef",
      AccountSid: `AC${"a".repeat(32)}`,
      From: "+393331234567",
      To: "+390212345678",
      Body: "Va bene, grazie",
      NumMedia: "0",
    });
    expect(normalizeTwilioWebhook(params)).toEqual([
      {
        type: "sms.received",
        dedupeKey: "sms_twilio:msg:SM1234567890abcdef1234567890abcdef",
        payload: {
          from: "+393331234567",
          text: "Va bene, grazie",
          messageId: "SM1234567890abcdef1234567890abcdef",
          to: "+390212345678",
        },
        contact: { phone: "+393331234567" },
      },
    ]);
  });

  it("turns a status callback into sms.status.updated", () => {
    const params = new URLSearchParams({
      MessageSid: "SM1",
      MessageStatus: "undelivered",
      ErrorCode: "30003",
      To: "+393331234567",
    });
    expect(normalizeTwilioWebhook(params)).toEqual([
      {
        type: "sms.status.updated",
        dedupeKey: "sms_twilio:status:SM1:undelivered",
        payload: { messageId: "SM1", status: "failed", error: "30003" },
      },
    ]);
    expect(normalizeTwilioWebhook(new URLSearchParams({ Foo: "bar" }))).toEqual([]);
  });
});

describe("Stripe normalization", () => {
  const event = {
    id: "evt_1Q",
    type: "checkout.session.completed",
    created: 1791100800,
    data: {
      object: {
        id: "cs_test_1",
        payment_link: "plink_1",
        payment_status: "paid",
        amount_total: 12050,
        currency: "eur",
        metadata: { reference: "pr_42" },
        customer_details: { email: "cliente@example.com", name: "Anna Blu", phone: null },
      },
    },
  };

  it("emits payment.completed for a paid checkout session", () => {
    expect(normalizeStripeEvent(event)).toEqual([
      {
        type: "payment.completed",
        occurredAt: "2026-10-04T08:00:00.000Z",
        dedupeKey: "payment_stripe:evt_1Q",
        payload: {
          paymentRequestId: "pr_42",
          reference: "pr_42",
          amount: 120.5,
          amountCents: 12050,
          currency: "EUR",
          externalId: "plink_1",
          sessionId: "cs_test_1",
        },
        contact: { name: "Anna Blu", email: "cliente@example.com" },
      },
    ]);
  });

  it("ignores unpaid sessions and other event types", () => {
    const unpaid = structuredClone(event);
    unpaid.data.object.payment_status = "unpaid";
    expect(normalizeStripeEvent(unpaid)).toEqual([]);
    expect(normalizeStripeEvent({ ...event, type: "charge.refunded" })).toEqual([]);
    expect(paymentStripeConnector.emits).toEqual(["payment.completed"]);
  });
});
