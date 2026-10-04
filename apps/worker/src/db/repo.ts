import {
  type Channel,
  type ConnectionRecord,
  type ConnectionStatus,
  type ConnectorCategory,
  type ContactConsents,
  type Row,
  type UsageMetric,
  normalizePhone,
} from "@ia-connect/core";
import { StepError } from "../errors.ts";
import { type Sql, iso, json } from "./sql.ts";

export type EventRow = Row<"events">;
export type JobRow = Row<"scheduled_jobs"> & { created_by: string | null };
export type RunRow = Row<"flow_runs">;
export type StepRow = Row<"flow_run_steps">;
export type ContactRow = Omit<Row<"contacts">, "consents" | "custom_fields" | "external_ids"> & {
  consents: ContactConsents;
  custom_fields: Record<string, unknown>;
  external_ids: Record<string, unknown>;
};
export type ConversationRow = Row<"conversations">;
export type MessageRow = Row<"messages">;
export type SettingsRow = Omit<Row<"org_settings">, "brand"> & { brand: Record<string, unknown> };
export type ConnectionRow = Omit<Row<"connections">, "config"> & {
  config: Record<string, unknown>;
  category: ConnectorCategory;
};

/** Timestamps arrive as Date from the drivers although the generated types say string. */
export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}

export const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  mail: "mail",
  sms: "SMS",
  social: "social",
};

// ── Organization ───────────────────────────────────────────────────────

export async function getOrganization(sql: Sql, organizationId: string) {
  const rows = await sql.query<{ id: string; name: string; status: string; sector: string }>(
    "select id, name, status, sector from ia_connect.organizations where id = $1",
    [organizationId],
  );
  return rows[0];
}

export async function getSettings(sql: Sql, organizationId: string): Promise<SettingsRow> {
  const rows = await sql.query<SettingsRow>(
    "select * from ia_connect.org_settings where organization_id = $1",
    [organizationId],
  );
  if (!rows[0]) throw new Error(`org_settings missing for organization ${organizationId}`);
  return rows[0];
}

export async function notify(
  sql: Sql,
  organizationId: string,
  input: { kind?: string; title: string; body?: string; link?: string },
): Promise<string> {
  const rows = await sql.query<{ id: string }>(
    `insert into ia_connect.notifications (organization_id, kind, title, body, link)
     values ($1, $2, $3, $4, $5) returning id`,
    [organizationId, input.kind ?? "info", input.title, input.body ?? "", input.link ?? null],
  );
  return rows[0]!.id;
}

/** Automation actions are recorded like the ones of users and admins. */
export async function audit(
  sql: Sql,
  organizationId: string,
  action: string,
  entity?: { type: string; id?: string | null },
  data: Record<string, unknown> = {},
): Promise<void> {
  await sql.query(
    `insert into ia_connect.audit_log (organization_id, actor_type, action, entity_type, entity_id, data)
     values ($1, 'automation', $2, $3, $4, $5::jsonb)`,
    [organizationId, action, entity?.type ?? null, entity?.id ?? null, json(data)],
  );
}

// ── Quotas ─────────────────────────────────────────────────────────────

export async function consumeQuota(sql: Sql, organizationId: string, metric: UsageMetric, amount = 1) {
  const rows = await sql.query<{ ok: boolean }>("select ia_connect.consume_quota($1, $2, $3::int) as ok", [
    organizationId,
    metric,
    amount,
  ]);
  return rows[0]?.ok === true;
}

export async function addUsage(sql: Sql, organizationId: string, metric: UsageMetric, amount: number) {
  await sql.query("select ia_connect.add_usage($1, $2, $3::int)", [organizationId, metric, amount]);
}

/** Remaining quota this month; null = unlimited. */
export async function quotaLeft(
  sql: Sql,
  organizationId: string,
  metric: UsageMetric,
): Promise<number | null> {
  const rows = await sql.query<{ left: string | null }>(
    "select ia_connect.quota_left($1, $2)::text as left",
    [organizationId, metric],
  );
  const left = rows[0]?.left;
  return left === null || left === undefined ? null : Number(left);
}

// ── Contacts and conversations ─────────────────────────────────────────

export async function getContact(sql: Sql, organizationId: string, id: string) {
  const rows = await sql.query<ContactRow>(
    "select * from ia_connect.contacts where organization_id = $1 and id = $2",
    [organizationId, id],
  );
  return rows[0];
}

export interface ContactKeys {
  phone?: string | null;
  email?: string | null;
  socialId?: string | null;
}

export function cleanContactKeys(input: { phone?: unknown; email?: unknown }): ContactKeys {
  const phone = typeof input.phone === "string" || typeof input.phone === "number" ? String(input.phone) : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  return { phone: phone ? normalizePhone(phone) : null, email: email.includes("@") ? email : null };
}

/** Phone first, then mail, then the social account id. */
export async function findContact(sql: Sql, organizationId: string, keys: ContactKeys) {
  if (keys.phone) {
    const rows = await sql.query<ContactRow>(
      `select * from ia_connect.contacts where organization_id = $1 and phones @> array[$2]::text[]
       order by created_at limit 1`,
      [organizationId, keys.phone],
    );
    if (rows[0]) return rows[0];
  }
  if (keys.email) {
    const rows = await sql.query<ContactRow>(
      `select * from ia_connect.contacts where organization_id = $1 and emails @> array[$2]::text[]
       order by created_at limit 1`,
      [organizationId, keys.email],
    );
    if (rows[0]) return rows[0];
  }
  if (keys.socialId) {
    const rows = await sql.query<ContactRow>(
      `select * from ia_connect.contacts where organization_id = $1 and external_ids ->> 'social' = $2
       order by created_at limit 1`,
      [organizationId, keys.socialId],
    );
    if (rows[0]) return rows[0];
  }
  return undefined;
}

export async function createContact(
  sql: Sql,
  organizationId: string,
  input: ContactKeys & {
    name?: string;
    fields?: Record<string, unknown>;
    consents?: ContactConsents;
  },
): Promise<ContactRow> {
  const rows = await sql.query<ContactRow>(
    `insert into ia_connect.contacts (organization_id, full_name, phones, emails, consents, custom_fields, external_ids)
     values ($1, $2,
       case when $3::text is null then '{}'::text[] else array[$3::text] end,
       case when $4::text is null then '{}'::text[] else array[$4::text] end,
       $5::jsonb, $6::jsonb, $7::jsonb)
     returning *`,
    [
      organizationId,
      input.name ?? "",
      input.phone ?? null,
      input.email ?? null,
      json(input.consents ?? {}),
      json(input.fields ?? {}),
      json(input.socialId ? { social: input.socialId } : {}),
    ],
  );
  return rows[0]!;
}

export async function getConversation(sql: Sql, organizationId: string, id: string) {
  const rows = await sql.query<ConversationRow>(
    "select * from ia_connect.conversations where organization_id = $1 and id = $2",
    [organizationId, id],
  );
  return rows[0];
}

/** One conversation per contact, channel and connection. A closed one is reopened. */
export async function findOrCreateConversation(
  sql: Sql,
  input: { organizationId: string; contactId: string; channel: Channel; connectionId: string | null },
): Promise<ConversationRow> {
  const found = await sql.query<ConversationRow>(
    `select * from ia_connect.conversations
     where organization_id = $1 and contact_id = $2 and channel = $3 and connection_id is not distinct from $4::uuid
     order by created_at desc limit 1`,
    [input.organizationId, input.contactId, input.channel, input.connectionId],
  );
  if (found[0]) return found[0];
  const rows = await sql.query<ConversationRow>(
    `insert into ia_connect.conversations (organization_id, contact_id, channel, connection_id)
     values ($1, $2, $3, $4) returning *`,
    [input.organizationId, input.contactId, input.channel, input.connectionId],
  );
  return rows[0]!;
}

export async function insertOutboundMessage(
  sql: Sql,
  input: {
    id: string;
    organizationId: string;
    conversationId: string;
    channel: Channel;
    content: string;
    meta?: Record<string, unknown>;
    templateId?: string | null;
    aiGenerated?: boolean;
    aiModel?: string | null;
    externalId: string | null;
    deliveryStatus: string;
    flowRunId: string | null;
    at: Date;
  },
): Promise<void> {
  await sql.query(
    `insert into ia_connect.messages
       (id, organization_id, conversation_id, direction, channel, content, meta, template_id,
        ai_generated, ai_model, delivery_status, external_id, flow_run_id)
     values ($1, $2, $3, 'out', $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)`,
    [
      input.id,
      input.organizationId,
      input.conversationId,
      input.channel,
      input.content,
      json(input.meta ?? {}),
      input.templateId ?? null,
      input.aiGenerated ?? false,
      input.aiModel ?? null,
      input.deliveryStatus,
      // Providers that return no id must not collide on the unique (channel, external_id) index.
      input.externalId || null,
      input.flowRunId,
    ],
  );
  await sql.query(
    "update ia_connect.conversations set last_message_at = $2::timestamptz, status = 'open' where id = $1",
    [input.conversationId, iso(input.at)],
  );
}

// ── Connections ────────────────────────────────────────────────────────

const CONNECTION_SELECT = `select c.*, t.category from ia_connect.connections c
  join ia_connect.connector_types t on t.key = c.connector_type`;

export async function getConnection(sql: Sql, organizationId: string, id: string) {
  const rows = await sql.query<ConnectionRow>(
    `${CONNECTION_SELECT} where c.organization_id = $1 and c.id = $2`,
    [organizationId, id],
  );
  return rows[0];
}

const CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  mail: "mail",
  whatsapp: "WhatsApp",
  crm: "gestionale",
  social: "social",
  scraper: "sito",
  sms: "SMS",
  calendar: "calendario",
  payment: "pagamenti",
  signature: "firma",
};

/**
 * Connection used by a block: the one named in the params, else the preferred one
 * (the conversation's), else the organization's single active connection of the category.
 */
export async function resolveConnection(
  sql: Sql,
  organizationId: string,
  category: ConnectorCategory,
  wantedId?: string | null,
  preferredId?: string | null,
  /** Narrows the candidates, e.g. to connectors that offer the needed action. */
  usable: (row: ConnectionRow) => boolean = () => true,
): Promise<ConnectionRow> {
  const label = CATEGORY_LABELS[category];
  if (wantedId) {
    const wanted = await getConnection(sql, organizationId, wantedId);
    if (!wanted || wanted.category !== category) {
      throw new StepError(`Il collegamento indicato (${label}) non esiste.`, "connection");
    }
    if (wanted.status !== "active") {
      throw new StepError(`Il collegamento "${wanted.name}" non è attivo: ricollegarlo.`, "connection");
    }
    return wanted;
  }
  const active = (
    await sql.query<ConnectionRow>(
      `${CONNECTION_SELECT} where c.organization_id = $1 and t.category = $2 and c.status = 'active'
       order by c.created_at`,
      [organizationId, category],
    )
  ).filter(usable);
  const preferred = preferredId ? active.find((item) => item.id === preferredId) : undefined;
  if (preferred) return preferred;
  if (active.length === 0) {
    throw new StepError(`Nessun collegamento attivo di tipo ${label}.`, "connection");
  }
  if (active.length > 1) {
    throw new StepError(
      `Ci sono più collegamenti attivi di tipo ${label}: indicare nel passo quale usare.`,
      "connection",
    );
  }
  return active[0]!;
}

export function toConnectionRecord(row: ConnectionRow): ConnectionRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    connectorKey: row.connector_type,
    status: row.status as ConnectionStatus,
    config: row.config ?? {},
  };
}

// ── AI usage outside flows ─────────────────────────────────────────────

export async function logAiCall(
  sql: Sql,
  organizationId: string,
  purpose: string,
  usage: { model: string; inputTokens: number; outputTokens: number; costMicros: number },
  credits: number,
): Promise<void> {
  await sql.query(
    `insert into ia_connect.ai_calls (organization_id, purpose, model, input_tokens, output_tokens, cost_micros, credits)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      organizationId,
      purpose,
      usage.model,
      usage.inputTokens,
      usage.outputTokens,
      Math.round(usage.costMicros),
      credits,
    ],
  );
  await addUsage(sql, organizationId, "ai_credits", credits);
}
