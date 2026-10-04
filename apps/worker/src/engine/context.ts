import type { TemplateContext } from "@ia-connect/core";
import { type ContactRow, getContact, getSettings } from "../db/repo.ts";
import type { RunRow } from "../db/repo.ts";
import type { Sql } from "../db/sql.ts";
import type { RunState } from "./types.ts";

export function contactView(contact: ContactRow) {
  return {
    id: contact.id,
    full_name: contact.full_name,
    name: contact.full_name,
    phone: contact.phones[0] ?? null,
    email: contact.emails[0] ?? null,
    phones: contact.phones,
    emails: contact.emails,
    custom_fields: contact.custom_fields,
    fields: contact.custom_fields,
  };
}

interface DealView {
  id: string;
  title: string;
  stage: string;
  value: number | null;
  next_action: string | null;
  custom_fields: Record<string, unknown>;
}

export async function loadDealView(sql: Sql, organizationId: string, dealId: string) {
  const rows = await sql.query<DealView & { cents: string | null }>(
    `select d.id, d.title, s.key as stage, d.estimated_value_cents::text as cents, d.next_action, d.custom_fields
     from ia_connect.deals d join ia_connect.deal_stages s on s.id = d.stage_id
     where d.organization_id = $1 and d.id = $2`,
    [organizationId, dealId],
  );
  const row = rows[0];
  if (!row) return undefined;
  const { cents, ...deal } = row;
  return { ...deal, value: cents === null ? null : Number(cents) / 100 };
}

/**
 * What `{{…}}` can reference: event, steps, contact, deal, org, reply.
 * In simulation the contact and deal may exist only in the run state.
 */
export async function buildTemplateContext(
  sql: Sql,
  run: RunRow,
  state: RunState,
  org: { id: string; name: string },
): Promise<TemplateContext> {
  const contactRow = run.contact_id ? await getContact(sql, org.id, run.contact_id) : undefined;
  const deal = run.deal_id ? await loadDealView(sql, org.id, run.deal_id) : undefined;
  const settings = await getSettings(sql, org.id);
  return {
    event: state.event,
    steps: state.steps,
    reply: state.reply ?? {},
    contact: { ...(contactRow ? contactView(contactRow) : {}), ...(state._sim?.contact ?? {}) },
    deal: { ...(deal ?? {}), ...(state._sim?.deal ?? {}) },
    org: { id: org.id, name: org.name, brand: settings.brand, language: settings.language },
  };
}
