import {
  type Channel,
  type ContactConsents,
  type FlowDefinition,
  FlowDefinitionSchema,
  INBOUND_MESSAGE_EVENTS,
  evaluateFilter,
  getPath,
  normalizePhone,
} from "@ia-connect/core";
import {
  type ContactKeys,
  type ConversationRow,
  type EventRow,
  type RunRow,
  addUsage,
  cleanContactKeys,
  createContact,
  findContact,
  findOrCreateConversation,
  getOrganization,
  toDate,
} from "./db/repo.ts";
import { type Sql, iso, json } from "./db/sql.ts";
import type { Deps } from "./deps.ts";
import { executeRun, initialState, signalRun } from "./engine/engine.ts";
import type { RunState } from "./engine/types.ts";

export interface EventOutcome {
  status: "processed" | "ignored";
  note?: string;
}

const STATUS_EVENTS: Record<string, Channel> = {
  "whatsapp.status.updated": "whatsapp",
  "sms.status.updated": "sms",
};

const INBOUND_CONSENT_SOURCE = "Messaggio ricevuto dal contatto";

/** Handles one claimed event. Throwing means "deliver again later"; every step tolerates that. */
export async function processEvent(deps: Deps, event: EventRow): Promise<EventOutcome> {
  const org = await getOrganization(deps.sql, event.organization_id);
  if (!org || org.status !== "active") return { status: "ignored", note: "Azienda sospesa." };

  const statusChannel = STATUS_EVENTS[event.type];
  if (statusChannel) await updateDeliveryStatus(deps.sql, event, statusChannel);

  let link: { contactId: string | null; conversationId: string | null } = {
    contactId: null,
    conversationId: null,
  };
  const channel = INBOUND_MESSAGE_EVENTS[event.type];
  if (channel) {
    const inbound = await storeInbound(deps, event, channel);
    if (!inbound) return { status: "ignored", note: "Messaggio senza mittente o già ricevuto." };
    if (inbound.conversation.assignee_type === "user") {
      return { status: "processed", note: "Conversazione in carico a una persona: nessuna automazione." };
    }
    if (await resumeWaitingRun(deps, event, inbound, channel)) return { status: "processed" };
    link = { contactId: inbound.contactId, conversationId: inbound.conversation.id };
  } else {
    const hint = cleanContactKeys((event.contact_hint ?? {}) as { phone?: unknown; email?: unknown });
    const known = hint.phone || hint.email ? await findContact(deps.sql, org.id, hint) : undefined;
    link.contactId = known?.id ?? null;
  }
  const settled = SETTLED_EVENTS[event.type];
  if (settled) {
    // The request's own contact wins over a hint taken from the provider's checkout form.
    const contactId = await settleRequest(deps.sql, event, settled);
    link.contactId = contactId ?? link.contactId;
  }

  const flows = await matchFlows(deps, event);
  for (const flow of flows) {
    const run = await createRun(deps.sql, {
      organizationId: org.id,
      flowId: flow.flowId,
      versionId: flow.versionId,
      definition: flow.definition,
      event,
      mode: "live",
      ...link,
    });
    await executeRun(deps, run.id);
  }
  if (flows.length || channel || statusChannel || settled) return { status: "processed" };
  return { status: "ignored", note: "Nessun flusso attivo per questo evento." };
}

// ── Delivery status ────────────────────────────────────────────────────

async function updateDeliveryStatus(sql: Sql, event: EventRow, channel: Channel): Promise<void> {
  const payload = event.payload as Record<string, unknown>;
  const status = String(payload.status ?? "");
  if (!payload.messageId || !["sent", "delivered", "read", "failed"].includes(status)) return;
  // Statuses can arrive out of order: never move a message backwards.
  await sql.query(
    `update ia_connect.messages set delivery_status = $4, error = $5
     where organization_id = $1 and channel = $2 and external_id = $3 and direction = 'out'
       and case when $4 = 'failed' then delivery_status not in ('delivered', 'read')
           else coalesce(array_position(array['queued', 'sent', 'delivered', 'read'], delivery_status), 0)
              < array_position(array['queued', 'sent', 'delivered', 'read'], $4::text) end`,
    [
      event.organization_id,
      channel,
      String(payload.messageId),
      status,
      status === "failed" ? String(payload.error ?? "Consegna non riuscita.") : null,
    ],
  );
}

// ── Payments and signatures ────────────────────────────────────────────

interface Settled {
  table: "payment_requests" | "signature_requests";
  field: string;
  status: string;
}

const SETTLED_EVENTS: Record<string, Settled> = {
  "payment.completed": { table: "payment_requests", field: "paymentRequestId", status: "paid" },
  "signature.completed": { table: "signature_requests", field: "signatureRequestId", status: "signed" },
};

/**
 * Marks the request a provider confirmed. Connectors identify it either with our own id
 * (the `reference` we passed, e.g. Stripe) or with the id they returned when it was created.
 */
async function settleRequest(sql: Sql, event: EventRow, settled: Settled): Promise<string | null> {
  const reference = (event.payload as Record<string, unknown>)[settled.field];
  if (typeof reference !== "string" || !reference) return null;
  const rows = await sql.query<{ contact_id: string | null }>(
    `update ia_connect.${settled.table} set status = $3
     where organization_id = $1 and (id::text = $2 or external_id = $2) and status in ('pending', $3)
     returning contact_id`,
    [event.organization_id, reference, settled.status],
  );
  return rows[0]?.contact_id ?? null;
}

// ── Inbound messages ───────────────────────────────────────────────────

interface Inbound {
  contactId: string;
  conversation: ConversationRow;
  messageId: string;
  text: string;
}

/**
 * Contact, conversation and message for an inbound event, in one transaction.
 * Returns undefined for a message already stored by a different event.
 */
async function storeInbound(deps: Deps, event: EventRow, channel: Channel): Promise<Inbound | undefined> {
  const payload = event.payload as Record<string, unknown>;
  const hint = (event.contact_hint ?? {}) as { name?: string; phone?: string; email?: string };
  const from = typeof payload.from === "string" ? payload.from.trim() : "";
  if (!from) return undefined;
  const text = typeof payload.text === "string" ? payload.text : "";
  const externalId = payload.messageId ? String(payload.messageId) : null;
  const occurredAt = toDate(event.occurred_at) ?? deps.now();

  const keys: ContactKeys =
    channel === "mail"
      ? { email: from.toLowerCase() }
      : channel === "social"
        ? { ...cleanContactKeys(hint), socialId: from }
        : { phone: normalizePhone(from) };

  return deps.sql.transaction(async (tx) => {
    const stored = await tx.query<{ id: string; conversation_id: string; event_id: string | null }>(
      `select id, conversation_id, meta ->> 'event_id' as event_id from ia_connect.messages
       where organization_id = $1 and channel = $2 and direction = 'in'
         and (meta ->> 'event_id' = $3 or ($4::text is not null and external_id = $4::text))
       limit 1`,
      [event.organization_id, channel, event.id, externalId],
    );
    if (stored[0]) {
      // Same message from another event: a duplicate. From this event: a redelivery, carry on.
      if (stored[0].event_id !== event.id) return undefined;
      const rows = await tx.query<ConversationRow>("select * from ia_connect.conversations where id = $1", [
        stored[0].conversation_id,
      ]);
      const conversation = rows[0]!;
      return { contactId: conversation.contact_id, conversation, messageId: stored[0].id, text };
    }

    const name = typeof payload.fromName === "string" ? payload.fromName : (hint.name ?? "");
    const consent: ContactConsents = {
      [channel]: { granted: true, at: occurredAt.toISOString(), source: INBOUND_CONSENT_SOURCE },
    };
    let contact = await findContact(tx, event.organization_id, keys);
    if (!contact) {
      contact = await createContact(tx, event.organization_id, { ...keys, name, consents: consent });
    } else if (!contact.consents[channel]) {
      // Writing to us is consent for that channel; a recorded choice is left untouched.
      await tx.query("update ia_connect.contacts set consents = consents || $2::jsonb where id = $1", [
        contact.id,
        json(consent),
      ]);
    }

    const conversation = await findOrCreateConversation(tx, {
      organizationId: event.organization_id,
      contactId: contact.id,
      channel,
      connectionId: event.connection_id,
    });
    const meta = {
      event_id: event.id,
      from,
      occurred_at: occurredAt.toISOString(),
      ...(typeof payload.subject === "string" ? { subject: payload.subject } : {}),
      ...(typeof payload.mediaUrl === "string" ? { mediaUrl: payload.mediaUrl } : {}),
      ...(typeof payload.platform === "string" ? { platform: payload.platform } : {}),
    };
    const message = await tx.query<{ id: string }>(
      `insert into ia_connect.messages
         (organization_id, conversation_id, direction, channel, content, meta, delivery_status, external_id)
       values ($1, $2, 'in', $3, $4, $5::jsonb, 'received', $6) returning id`,
      // `created_at` stays the insertion time, so a conversation reads in the order we saw it.
      [event.organization_id, conversation.id, channel, text, json(meta), externalId],
    );
    const updated = await tx.query<ConversationRow>(
      `update ia_connect.conversations set
         status = 'open', unread_count = unread_count + 1, last_message_at = $2::timestamptz,
         window_expires_at = case when channel = 'whatsapp' then $3::timestamptz else window_expires_at end,
         external_thread_id = coalesce($4, external_thread_id)
       where id = $1 returning *`,
      [
        conversation.id,
        iso(occurredAt),
        iso(new Date(occurredAt.getTime() + 24 * 3_600_000)),
        typeof payload.threadId === "string" ? payload.threadId : null,
      ],
    );
    return { contactId: contact.id, conversation: updated[0]!, messageId: message[0]!.id, text };
  });
}

/** True when the message belongs to a run: it resumes it, or (redelivery) already did. */
async function resumeWaitingRun(
  deps: Deps,
  event: EventRow,
  inbound: Inbound,
  channel: Channel,
): Promise<boolean> {
  const handled = await deps.sql.query<RunRow>(
    `select * from ia_connect.flow_runs
     where organization_id = $1 and mode = 'live' and context -> 'reply' ->> 'messageId' = $2
     order by updated_at desc limit 1`,
    [event.organization_id, inbound.messageId],
  );
  if (handled[0]) {
    if (handled[0].status === "running") await executeRun(deps, handled[0].id);
    return true;
  }
  const waiting = await deps.sql.query<RunRow & { definition: unknown }>(
    `select r.*, v.definition from ia_connect.flow_runs r
     join ia_connect.flow_versions v on v.id = r.flow_version_id
     where r.organization_id = $1 and r.mode = 'live' and r.status = 'waiting' and r.waiting_for = 'reply'
       and (r.conversation_id = $2 or (r.conversation_id is null and r.contact_id = $3))
     order by r.updated_at desc limit 10`,
    [event.organization_id, inbound.conversation.id, inbound.contactId],
  );
  for (const run of waiting) {
    // A wait can be limited to one channel.
    const definition = FlowDefinitionSchema.safeParse(run.definition);
    const step = definition.data?.steps.find((item) => item.id === run.current_step_id);
    const wanted = step?.params.channel;
    if (typeof wanted === "string" && wanted !== channel) continue;
    const signalled = await signalRun(deps.sql, event.organization_id, run.id, {
      kind: "reply",
      text: inbound.text,
      messageId: inbound.messageId,
    });
    if (!signalled) continue;
    if (!run.conversation_id) {
      await deps.sql.query("update ia_connect.flow_runs set conversation_id = $2 where id = $1", [
        run.id,
        inbound.conversation.id,
      ]);
    }
    await executeRun(deps, run.id);
    return true;
  }
  return false;
}

// ── Flow matching ──────────────────────────────────────────────────────

export interface MatchedFlow {
  flowId: string;
  versionId: string;
  definition: FlowDefinition;
}

export function eventView(
  event: Pick<EventRow, "id" | "type" | "payload" | "connection_id" | "occurred_at">,
) {
  return {
    id: event.id,
    type: event.type,
    payload: event.payload,
    connection: event.connection_id,
    occurred_at: event.occurred_at,
  };
}

export function triggerMatches(definition: FlowDefinition, event: Parameters<typeof eventView>[0]): boolean {
  const { trigger } = definition;
  if (trigger.event !== event.type) return false;
  if (trigger.connection && trigger.connection !== event.connection_id) return false;
  const view = eventView(event);
  return trigger.filters.every((filter) => evaluateFilter(filter, getPath(view, filter.field)));
}

async function matchFlows(deps: Deps, event: EventRow): Promise<MatchedFlow[]> {
  const rows = await deps.sql.query<{ flow_id: string; version_id: string; definition: unknown }>(
    `select f.id as flow_id, v.id as version_id, v.definition
     from ia_connect.flows f join ia_connect.flow_versions v on v.id = f.active_version_id
     where f.organization_id = $1 and f.status = 'active' and f.trigger_event = $2
     order by f.created_at`,
    [event.organization_id, event.type],
  );
  const matched: MatchedFlow[] = [];
  for (const row of rows) {
    const parsed = FlowDefinitionSchema.safeParse(row.definition);
    if (!parsed.success) {
      deps.logger.error("active flow with an invalid definition", {
        flowId: row.flow_id,
        versionId: row.version_id,
      });
      continue;
    }
    if (triggerMatches(parsed.data, event)) {
      matched.push({ flowId: row.flow_id, versionId: row.version_id, definition: parsed.data });
    }
  }
  return matched;
}

/**
 * Creates the run, or returns the one that already exists for this event and version:
 * the unique key (flow_version_id, event_id, mode) makes a redelivered event harmless.
 */
export async function createRun(
  sql: Sql,
  input: {
    organizationId: string;
    flowId: string;
    versionId: string;
    definition: FlowDefinition;
    event:
      | Pick<EventRow, "id" | "type" | "payload" | "connection_id">
      | { id: null; type: string; payload: object };
    mode: "live" | "simulation";
    contactId?: string | null;
    conversationId?: string | null;
  },
): Promise<RunRow> {
  const state: RunState = initialState(
    {
      id: input.event.id,
      type: input.event.type,
      payload: input.event.payload as Record<string, unknown>,
      connectionId: "connection_id" in input.event ? input.event.connection_id : null,
    },
    input.definition,
  );
  return sql.transaction(async (tx) => {
    const created = await tx.query<RunRow>(
      `insert into ia_connect.flow_runs
         (organization_id, flow_id, flow_version_id, event_id, mode, status, current_step_id, context, contact_id, conversation_id)
       values ($1, $2, $3, $4, $5, 'running', $6, $7::jsonb, $8, $9)
       on conflict (flow_version_id, event_id, mode) do nothing returning *`,
      [
        input.organizationId,
        input.flowId,
        input.versionId,
        input.event.id,
        input.mode,
        input.definition.steps[0]!.id,
        json(state),
        input.contactId ?? null,
        input.conversationId ?? null,
      ],
    );
    if (created[0]) {
      if (input.mode === "live") await addUsage(tx, input.organizationId, "flow_runs", 1);
      return created[0];
    }
    const existing = await tx.query<RunRow>(
      "select * from ia_connect.flow_runs where flow_version_id = $1 and event_id = $2 and mode = $3",
      [input.versionId, input.event.id, input.mode],
    );
    return existing[0]!;
  });
}
