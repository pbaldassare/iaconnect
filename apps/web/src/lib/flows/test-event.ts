import { type FlowDefinition, INBOUND_MESSAGE_EVENTS, isOpenEventType } from "@ia-connect/core";

/**
 * The "evento di prova" of the flow page: the `events` row the web inserts and the sample
 * content it proposes. Pure (no `server-only`, no `@/` imports): the worker's tests feed
 * the queue with exactly these rows.
 *
 * Two ways, chosen by `testEventMode`:
 * - "event": a real `events` row, for `manual.test`, `custom.*` and the open business types
 *   (the only ones RLS lets a manager insert). Active flows with that trigger run for real.
 * - "simulation": for the types reserved to connectors (an inbound message, a delivery
 *   status, a payment…). A made-up one would be taken as true (contact with consent, open
 *   WhatsApp window, request marked as paid), so the flow is simulated over the sample
 *   content instead (`simulateSampleJob`): nothing is stored, nothing is sent.
 *
 * What the worker's queue needs from the row (apps/worker/src/events.ts):
 * - `status` "pending" and `available_at` now: column defaults, never set here;
 * - a `dedupe_key` unique in the organization;
 * - for an inbound message type (mail, WhatsApp, SMS, social message) a `payload.from`:
 *   without a sender the event is ignored before any flow is looked at;
 * - `connection_id` equal to `trigger.connection` when the flow listens to one connection
 *   only: an event without it never matches that trigger.
 */

const PERSON = { name: "Maria Rossi", phone: "+393331234567", email: "maria.rossi@example.com" };

const SAMPLES: Record<string, Record<string, unknown>> = {
  "mail.received": {
    from: PERSON.email,
    fromName: PERSON.name,
    subject: "Richiesta di preventivo",
    text: "Buongiorno, vorrei un preventivo.",
  },
  "whatsapp.message.received": {
    from: PERSON.phone,
    fromName: PERSON.name,
    text: "Buongiorno, vorrei un'informazione.",
  },
  "sms.received": { from: PERSON.phone, text: "Buongiorno, vorrei un'informazione." },
  "social.message.received": {
    from: "utente-di-prova",
    fromName: PERSON.name,
    text: "Buongiorno, vorrei un'informazione.",
    platform: "facebook",
  },
  "social.comment.received": {
    from: "utente-di-prova",
    fromName: PERSON.name,
    text: "Quanto costa?",
    commentId: "commento-di-prova",
    postId: "post-di-prova",
    platform: "facebook",
  },
  "social.lead.received": { ...PERSON, formName: "Modulo di prova", fields: {}, platform: "facebook" },
  "quote.requested": { ...PERSON, product: "RC auto", details: {}, source: "prova" },
  "order.created": {
    orderNumber: "PROVA-1001",
    ...PERSON,
    total: 49.9,
    currency: "EUR",
    items: [{ name: "Articolo di prova", quantity: 1 }],
    status: "paid",
  },
  "listing.published": {
    title: "Trilocale di prova",
    url: "https://www.example.com/annunci/1",
    price: 250000,
    area: "Centro",
    sqm: 85,
    rooms: 3,
    portal: "prova",
  },
  "crm.record.created": { resource: "customers", id: "prova-1", data: { name: PERSON.name } },
  "crm.record.updated": { resource: "customers", id: "prova-1", data: { name: PERSON.name } },
  "scrape.item.found": { recipeId: "prova", item: { title: "Elemento di prova" } },
  "appointment.booked": {
    start: "2030-01-15T09:00:00.000Z",
    end: "2030-01-15T09:30:00.000Z",
    title: "Appuntamento di prova",
  },
  "payment.completed": { paymentRequestId: "prova", amount: 49.9, currency: "EUR" },
  "signature.completed": {
    signatureRequestId: "prova",
    documentUrl: "https://www.example.com/documento.pdf",
  },
  "manual.test": { ...PERSON, text: "Buongiorno, vorrei un preventivo." },
};

/** Sample content for a test event of this type, with the fields the worker and the usual flows read. */
export function sampleEventPayload(type: string | null | undefined): Record<string, unknown> {
  return { ...(SAMPLES[type ?? ""] ?? SAMPLES["manual.test"]) };
}

/** True for the events the worker stores as a message received from a contact. */
export function isInboundMessageEvent(type: string): boolean {
  return type in INBOUND_MESSAGE_EVENTS;
}

/** Why the worker would ignore this test event, in Italian; null when it will be processed. */
export function testEventProblem(type: string, payload: Record<string, unknown>): string | null {
  if (!isInboundMessageEvent(type)) return null;
  const from = payload.from;
  if (typeof from !== "string" || from.trim() === "") {
    return 'Per un messaggio in arrivo serve il mittente: aggiungi "from" (telefono o mail di prova) al contenuto.';
  }
  return null;
}

/**
 * "event": inserted as a real event. "simulation": the type is reserved to connectors, the
 * test runs the flow in simulation over the sample content.
 */
export function testEventMode(type: string): "event" | "simulation" {
  return type === "manual.test" || isOpenEventType(type) ? "event" : "simulation";
}

/** What the person is told about a test of a flow whose trigger only a connector can produce. */
export const INBOUND_TEST_EVENT_NOTE =
  "Un evento di questo tipo può arrivare solo dal collegamento vero: la prova esegue il flusso in simulazione sul contenuto indicato, senza creare contatti e senza inviare messaggi.";

/**
 * The `events` row for a test event. `connectionIds` are the organization's connections:
 * the trigger's connection is copied only when it really belongs to the organization.
 */
export function buildTestEvent(input: {
  organizationId: string;
  type: string;
  payload: Record<string, unknown>;
  /** Trigger of the version the test is for (the active one, else the latest). */
  trigger?: FlowDefinition["trigger"] | null;
  connectionIds?: readonly string[];
  /** Random id that makes the dedupe key unique. */
  id: string;
}): {
  organization_id: string;
  type: string;
  payload: Record<string, unknown>;
  dedupe_key: string;
  connection_id: string | null;
} {
  const wanted = input.trigger?.event === input.type ? input.trigger.connection : undefined;
  return {
    organization_id: input.organizationId,
    type: input.type,
    payload: input.payload,
    dedupe_key: `manual:${input.id}`,
    connection_id: wanted && (input.connectionIds ?? []).includes(wanted) ? wanted : null,
  };
}
