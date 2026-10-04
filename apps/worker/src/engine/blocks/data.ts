import {
  type Channel,
  type ContactConsents,
  CrmReadOutput,
  CrmWriteOutput,
  type FilterOperator,
  evaluateFilter,
  getPath,
} from "@ia-connect/core";
import { offersAction, runAction } from "../../connectors.ts";
import {
  type ContactRow,
  audit,
  cleanContactKeys,
  createContact,
  findContact,
  getContact,
  resolveConnection,
} from "../../db/repo.ts";
import { type Sql, iso, json } from "../../db/sql.ts";
import { StepError } from "../../errors.ts";
import { contactView } from "../context.ts";
import { type Executor, type StepContext, next } from "../types.ts";

interface UpsertParams {
  name?: string;
  phone?: string;
  email?: string;
  fields?: Record<string, unknown>;
  consent?: { channel: Channel; source: string };
}

async function lookup(ctx: StepContext, params: UpsertParams) {
  const keys = cleanContactKeys(params);
  let existing = await findContact(ctx.sql, ctx.org.id, keys);
  if (!existing && !keys.phone && !keys.email && ctx.run.contact_id) {
    existing = await getContact(ctx.sql, ctx.org.id, ctx.run.contact_id);
  }
  if (!existing && !keys.phone && !keys.email) {
    throw new StepError("Per creare un contatto serve almeno un telefono o una mail validi.", "contact");
  }
  return { keys, existing };
}

/** A consent already recorded (given or withdrawn) is never overwritten by a flow. */
function mergeConsents(current: ContactConsents, params: UpsertParams, now: Date): ContactConsents {
  if (!params.consent || current[params.consent.channel]) return current;
  return {
    ...current,
    [params.consent.channel]: { granted: true, at: now.toISOString(), source: params.consent.source },
  };
}

export const contactUpsert: Executor<UpsertParams> = {
  async run(ctx, params) {
    const { keys, existing } = await lookup(ctx, params);
    let contact: ContactRow;
    if (existing) {
      const rows = await ctx.sql.query<ContactRow>(
        `update ia_connect.contacts set
           full_name = case when $2::text <> '' then $2::text else full_name end,
           phones = case when $3::text is null or phones @> array[$3::text] then phones else phones || $3::text end,
           emails = case when $4::text is null or emails @> array[$4::text] then emails else emails || $4::text end,
           custom_fields = custom_fields || $5::jsonb,
           consents = $6::jsonb
         where id = $1 returning *`,
        [
          existing.id,
          params.name?.trim() ?? "",
          keys.phone ?? null,
          keys.email ?? null,
          json(params.fields ?? {}),
          json(mergeConsents(existing.consents, params, ctx.now)),
        ],
      );
      contact = rows[0]!;
    } else {
      contact = await createContact(ctx.sql, ctx.org.id, {
        ...keys,
        name: params.name?.trim(),
        fields: params.fields,
        consents: mergeConsents({}, params, ctx.now),
      });
    }
    // Contacts and deals are audited by database triggers (actor: automation).
    ctx.run.contact_id = contact.id;
    return next({ contactId: contact.id, created: !existing });
  },
  async simulate(ctx, params) {
    const { keys, existing } = await lookup(ctx, params);
    const base = existing ? contactView(existing) : undefined;
    const fields = { ...(base?.custom_fields ?? {}), ...(params.fields ?? {}) };
    const contact = {
      id: existing?.id ?? null,
      full_name: params.name?.trim() || base?.full_name || "",
      name: params.name?.trim() || base?.full_name || "",
      phone: base?.phone ?? keys.phone ?? null,
      email: base?.email ?? keys.email ?? null,
      custom_fields: fields,
      fields,
      consents: mergeConsents(existing?.consents ?? {}, params, ctx.now),
    };
    ctx.state._sim = { ...ctx.state._sim, contact };
    if (existing) ctx.run.contact_id = existing.id;
    return next({ simulated: true, contactId: existing?.id ?? null, created: !existing, contact });
  },
};

interface Rule {
  field: string;
  operator: FilterOperator;
  value?: unknown;
}

export const contactFindMatching: Executor<{ rules: Rule[]; limit: number }> = {
  async run(ctx, params) {
    const rows = await ctx.sql.query<ContactRow>(
      "select * from ia_connect.contacts where organization_id = $1 order by created_at limit 20000",
      [ctx.org.id],
    );
    const contacts = rows
      .filter((row) =>
        params.rules.every((rule) => evaluateFilter(rule, getPath(row.custom_fields, rule.field))),
      )
      .slice(0, params.limit)
      .map((row) => ({
        id: row.id,
        full_name: row.full_name,
        phone: row.phones[0] ?? null,
        email: row.emails[0] ?? null,
        custom_fields: row.custom_fields,
      }));
    return next({ contacts, count: contacts.length });
  },
};

interface DealCreateParams {
  title: string;
  stage?: string;
  value?: number | string;
  nextAction?: string;
  fields?: Record<string, unknown>;
}

async function findStage(sql: Sql, organizationId: string, key?: string) {
  const rows = await sql.query<{ id: string; key: string; kind: string }>(
    `select id, key, kind from ia_connect.deal_stages
     where organization_id = $1 and ($2::text is null or key = $2::text) order by position limit 1`,
    [organizationId, key ?? null],
  );
  if (!rows[0])
    throw new StepError(`La fase "${key ?? ""}" non esiste tra le fasi delle trattative.`, "stage");
  return rows[0];
}

/** Euros (number or "1.250,50") to cents. */
function toCents(value: number | string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const text = String(value).trim();
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const amount = Number(normalized.replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(amount)) throw new StepError(`Il valore "${text}" non è un importo valido.`, "amount");
  return Math.round(amount * 100);
}

export const dealCreate: Executor<DealCreateParams> = {
  async run(ctx, params) {
    if (!ctx.run.contact_id) {
      throw new StepError(
        'Per aprire una trattativa serve prima il passo "Crea o aggiorna contatto".',
        "contact",
      );
    }
    const stage = await findStage(ctx.sql, ctx.org.id, params.stage);
    const rows = await ctx.sql.query<{ id: string }>(
      `insert into ia_connect.deals
         (organization_id, contact_id, title, stage_id, estimated_value_cents, origin_flow_run_id, next_action, custom_fields)
       values ($1, $2, $3, $4, $5::bigint, $6, $7, $8::jsonb) returning id`,
      [
        ctx.org.id,
        ctx.run.contact_id,
        params.title,
        stage.id,
        toCents(params.value),
        ctx.run.id,
        params.nextAction ?? null,
        json(params.fields ?? {}),
      ],
    );
    const dealId = rows[0]!.id;
    await ctx.sql.query(
      `insert into ia_connect.deal_events (organization_id, deal_id, type, to_stage_id, actor_type, data)
       values ($1, $2, 'created', $3, 'automation', $4::jsonb)`,
      [ctx.org.id, dealId, stage.id, json({ flow_run_id: ctx.run.id })],
    );
    ctx.run.deal_id = dealId;
    return next({ dealId });
  },
  async simulate(ctx, params) {
    const stage = await findStage(ctx.sql, ctx.org.id, params.stage);
    const cents = toCents(params.value);
    const deal = {
      id: null,
      title: params.title,
      stage: stage.key,
      value: cents === null ? null : cents / 100,
      next_action: params.nextAction ?? null,
      custom_fields: params.fields ?? {},
    };
    ctx.state._sim = { ...ctx.state._sim, deal };
    return next({ simulated: true, dealId: null, deal });
  },
};

async function currentDeal(ctx: StepContext) {
  const rows = await ctx.sql.query<{ id: string; stage_id: string }>(
    `select d.id, d.stage_id from ia_connect.deals d
     where d.organization_id = $1 and (d.id = $2::uuid or ($2::uuid is null and d.contact_id = $3::uuid and d.closed_at is null))
     order by d.created_at desc limit 1`,
    [ctx.org.id, ctx.run.deal_id, ctx.run.contact_id],
  );
  return rows[0];
}

export const dealUpdateStage: Executor<{ stage: string; nextAction?: string }> = {
  async run(ctx, params) {
    const deal = await currentDeal(ctx);
    if (!deal) throw new StepError("Non c'è una trattativa da aggiornare per questo contatto.", "deal");
    const stage = await findStage(ctx.sql, ctx.org.id, params.stage);
    await ctx.sql.query(
      `update ia_connect.deals set stage_id = $2, next_action = coalesce($3, next_action),
         closed_at = case when $4 then $5::timestamptz else null end
       where id = $1`,
      [deal.id, stage.id, params.nextAction ?? null, stage.kind !== "open", iso(ctx.now)],
    );
    await ctx.sql.query(
      `insert into ia_connect.deal_events (organization_id, deal_id, type, from_stage_id, to_stage_id, actor_type, data)
       values ($1, $2, 'stage_changed', $3, $4, 'automation', $5::jsonb)`,
      [ctx.org.id, deal.id, deal.stage_id, stage.id, json({ flow_run_id: ctx.run.id })],
    );
    ctx.run.deal_id = deal.id;
    return next({ dealId: deal.id, stage: stage.key });
  },
  async simulate(ctx, params) {
    const stage = await findStage(ctx.sql, ctx.org.id, params.stage);
    const deal = await currentDeal(ctx);
    const virtual = ctx.state._sim?.deal;
    if (virtual) ctx.state._sim = { ...ctx.state._sim, deal: { ...virtual, stage: stage.key } };
    return next({ simulated: true, dealId: deal?.id ?? null, stage: stage.key });
  },
};

const crmConnection = (ctx: StepContext, wanted: string | undefined, action: string) =>
  resolveConnection(ctx.sql, ctx.org.id, "crm", wanted, null, (row) => offersAction(ctx.deps, row, action));

export const crmRead: Executor<{ connection?: string; resource: string; query: Record<string, unknown> }> = {
  async run(ctx, params) {
    const connection = await crmConnection(ctx, params.connection, "read");
    const result = CrmReadOutput.parse(
      await runAction(ctx.deps, connection, "read", { resource: params.resource, query: params.query }),
    );
    return next({ records: result.records, count: result.records.length });
  },
  async simulate(_ctx, params) {
    return next({
      simulated: true,
      records: [],
      count: 0,
      note: `In simulazione il gestionale non viene letto (risorsa "${params.resource}").`,
    });
  },
};

export const crmWrite: Executor<{
  connection?: string;
  resource: string;
  id?: string;
  data: Record<string, unknown>;
}> = {
  async run(ctx, params) {
    const connection = await crmConnection(ctx, params.connection, "write");
    const result = CrmWriteOutput.parse(
      await runAction(ctx.deps, connection, "write", {
        resource: params.resource,
        id: params.id,
        data: params.data,
      }),
    );
    await audit(
      ctx.sql,
      ctx.org.id,
      "crm.written",
      { type: "connection", id: connection.id },
      {
        resource: params.resource,
        flow_run_id: ctx.run.id,
      },
    );
    return next({ id: result.id });
  },
  async simulate(_ctx, params) {
    return next({ simulated: true, id: params.id ?? null, resource: params.resource, data: params.data });
  },
};
