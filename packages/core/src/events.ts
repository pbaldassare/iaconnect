import { z } from "zod";

/**
 * Catalog of normalized event types. Connectors translate provider payloads
 * into these; flows trigger on them. `custom.*` is allowed for events emitted
 * by flows themselves (logic.for_each) or by generic webhooks.
 */
export const EVENT_TYPES = {
  "mail.received": {
    title: "Mail ricevuta",
    payload: "from, fromName, to, subject, text, html?, messageId, threadId?, attachments[]",
  },
  "quote.requested": {
    title: "Richiesta di preventivo",
    payload: "name, phone?, email?, product, details{}, source",
  },
  "order.created": {
    title: "Nuovo ordine",
    payload: "orderNumber, name, phone?, email?, total, currency, items[], status",
  },
  "whatsapp.message.received": {
    title: "Messaggio WhatsApp ricevuto",
    payload: "from, fromName?, text, messageId, mediaUrl?",
  },
  "whatsapp.status.updated": {
    title: "Stato di consegna WhatsApp",
    payload: "messageId, status(sent|delivered|read|failed), error?",
  },
  "sms.received": { title: "SMS ricevuto", payload: "from, text, messageId" },
  "sms.status.updated": { title: "Stato di consegna SMS", payload: "messageId, status, error?" },
  "social.lead.received": {
    title: "Contatto da modulo social",
    payload: "name, phone?, email?, formName, fields{}, platform",
  },
  "social.message.received": {
    title: "Messaggio social ricevuto",
    payload: "from, fromName?, text, messageId, platform",
  },
  "social.comment.received": {
    title: "Commento social ricevuto",
    payload: "from, fromName?, text, commentId, postId, platform",
  },
  "listing.published": {
    title: "Nuovo immobile pubblicato",
    payload: "title, url, price, area?, sqm?, rooms?, description?, portal",
  },
  "crm.record.created": { title: "Nuovo record nel gestionale", payload: "resource, id, data{}" },
  "crm.record.updated": { title: "Record aggiornato nel gestionale", payload: "resource, id, data{}" },
  "scrape.item.found": { title: "Nuovo elemento da un sito", payload: "recipeId, item{}" },
  "appointment.booked": { title: "Appuntamento fissato", payload: "start, end, title, contactId?" },
  "payment.completed": { title: "Pagamento completato", payload: "paymentRequestId, amount, currency" },
  "signature.completed": { title: "Firma completata", payload: "signatureRequestId, documentUrl" },
  "manual.test": { title: "Evento di prova", payload: "qualsiasi" },
} as const;

export type KnownEventType = keyof typeof EVENT_TYPES;

export function isKnownEventType(type: string): boolean {
  return type in EVENT_TYPES || /^custom\.[a-z0-9_.]+$/.test(type);
}

/**
 * Event types anyone holding a generic channel may create: the "Webhook in ingresso"
 * connector, `logic.for_each`, a manager's test event. Every other type is reserved to the
 * connector that verified its origin: an inbound message records consent and opens the
 * WhatsApp window, a payment event marks a request as paid.
 * Mirrored by `ia_connect.is_open_event_type` in the database (a test compares the two).
 */
export const OPEN_EVENT_TYPES = [
  "quote.requested",
  "order.created",
  "listing.published",
  "crm.record.created",
  "crm.record.updated",
] as const;

export function isOpenEventType(type: string): boolean {
  return (OPEN_EVENT_TYPES as readonly string[]).includes(type) || /^custom\.[a-z0-9_.]+$/.test(type);
}

/**
 * Connector category a reserved event must come from. The worker gives an event of these
 * types its special meaning (store a message, update a delivery status, settle a payment or
 * a signature) only when `events.connection_id` is a connection of that category in the
 * same organization.
 */
export const RESERVED_EVENT_SOURCES: Record<
  string,
  "whatsapp" | "mail" | "sms" | "social" | "payment" | "signature"
> = {
  "whatsapp.message.received": "whatsapp",
  "whatsapp.status.updated": "whatsapp",
  "mail.received": "mail",
  "sms.received": "sms",
  "sms.status.updated": "sms",
  "social.message.received": "social",
  "payment.completed": "payment",
  "signature.completed": "signature",
};

/** Inbound message events: they resume a waiting run before triggering new flows. */
export const INBOUND_MESSAGE_EVENTS: Record<string, "whatsapp" | "mail" | "sms" | "social"> = {
  "whatsapp.message.received": "whatsapp",
  "mail.received": "mail",
  "sms.received": "sms",
  "social.message.received": "social",
};

export const ContactHintSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

/** What a connector hands to the platform. `dedupeKey` must be stable across redeliveries. */
export const NormalizedEventInputSchema = z.object({
  type: z.string().refine(isKnownEventType, "Unknown event type"),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  dedupeKey: z.string().min(1).max(512),
  payload: z.record(z.string(), z.unknown()),
  contact: ContactHintSchema.optional(),
});
export type NormalizedEventInput = z.infer<typeof NormalizedEventInputSchema>;

/** Normalizes a phone number to digits with a leading "+" (E.164-like). Default country: Italy. */
export function normalizePhone(raw: string, defaultCountryCode = "39"): string | null {
  const trimmed = raw.trim();
  let digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.length <= 10) digits = defaultCountryCode + digits;
  return `+${digits}`;
}
