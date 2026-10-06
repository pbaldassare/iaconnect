import { afterEach, describe, expect, it } from "vitest";
import { parseRequirements, planTemplateInstall } from "../../web/src/lib/flows/install";
import { drain } from "../src/worker.ts";
import {
  type Integration,
  type NetCall,
  createIntegration,
  jsonResponse,
  leaks,
} from "./integration-helpers.ts";

/**
 * Renewals end to end with the real connectors: a fake Assicurapp API behind the real
 * `crm_rest` connector, configured as a customer would (daily poll, first poll emits
 * everything), the two insurance renewal templates installed the way the web installs them
 * (message templates, the `renewal_due` stage, the deal fields), the real Meta connector
 * for the WhatsApp templates. Nothing is sent: the network is fake.
 */

let t: Integration;
afterEach(async () => {
  expect(t?.net.unmatched ?? []).toEqual([]);
  await t?.db.close().catch(() => undefined);
});

const ASSICURAPP = "https://gestionale.assicurapp.example";
const EXPIRING = `${ASSICURAPP}/api/policies/expiring_api`;
const API_TOKEN = "assicurapp-api-token-very-secret";
const PHONE_NUMBER_ID = "106540352242922";
const WA_TOKEN = "EAAG-whatsapp-permanent-token";
const GRAPH_MESSAGES = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The response of `GET /api/policies/expiring_api` as documented in docs/riferimenti/assicurapp-scadenze.md. */
const expiring = {
  status: "success",
  quotes: [
    {
      quoteUID: "0199a1b2-0000-7000-8000-000000000001",
      plate: "GA123BC",
      client_name: "MARIO ROSSI",
      client_cf: "RSSMRA80A01H501U",
      phone: "3331234567",
      email: "mario@example.com",
      product_name: "RCA Auto",
      creator_name: "Luca Bianchi",
      created_at: "2026-09-12T08:30:00.000Z",
      current_company: "ZAVAROVALNICA TRIGLAV D.D.",
      expire_date: "2026-10-17",
      days_left: 15,
    },
  ],
  policies: [
    {
      policyUID: "0198c3d4-0000-7000-8000-000000000002",
      quoteUID: "0198c3d4-0000-7000-8000-000000000003",
      policy_num: "123456789",
      company_slug: "groupama",
      expire_date: "2026-10-20",
      days_left: 18,
      created_at: "2025-10-20T09:00:00.000Z",
      plate: "FX456DE",
      client_name: "ANNA VERDI",
      client_cf: "VRDNNA75B41F205X",
      phone: "3337654321",
      email: "anna@example.com",
      product_name: "RCA Auto",
      policy_price: "412.50",
      creator_name: "Luca Bianchi",
    },
  ],
};

/** The non-secret `connections.config` a customer stores for Assicurapp (the token is a secret). */
const ASSICURAPP_CONFIG = {
  baseUrl: ASSICURAPP,
  authHeaderName: "Authorization",
  pollIntervalMinutes: 1440,
  resources: {
    quotes: {
      listPath: "/api/policies/expiring_api",
      recordsPath: "quotes",
      idField: "quoteUID",
      watch: true,
      initialPoll: "emit",
      eventType: "quote.expiring",
      contactFields: { name: "client_name", phone: "phone", email: "email" },
    },
    policies: {
      listPath: "/api/policies/expiring_api",
      recordsPath: "policies",
      idField: "policyUID",
      watch: true,
      initialPoll: "emit",
      eventType: "policy.expiring",
      contactFields: { name: "client_name", phone: "phone", email: "email" },
    },
  },
};

/** Installs a library template the way `installTemplate` (apps/web) does, with the templates approved. */
async function installTemplate(key: string) {
  const seeded = await t.one(
    "select definition, requirements from ia_connect.flow_templates where key = $1 and is_published",
    [key],
  );
  const requirements = parseRequirements(seeded.requirements);
  const stages = await t.all(
    "select id, key, position, kind from ia_connect.deal_stages where organization_id = $1",
    [t.orgId],
  );
  const settings = await t.one(
    "select deal_custom_fields from ia_connect.org_settings where organization_id = $1",
    [t.orgId],
  );
  const plan = planTemplateInstall(requirements, {
    templates: await t.all(
      "select channel, name, approval_status from ia_connect.message_templates where organization_id = $1",
      [t.orgId],
    ),
    connections: [],
    stages,
    dealFields: settings.deal_custom_fields,
  });
  for (const template of plan.templatesToCreate) {
    // Approved on Meta under the same name.
    await t.addTemplate({ name: template.name, body: template.body });
  }
  for (const move of plan.stagesToMove) {
    await t.sql.query("update ia_connect.deal_stages set position = $2 where id = $1", [
      move.id,
      move.position,
    ]);
  }
  for (const stage of plan.stagesToCreate) {
    await t.sql.query(
      "insert into ia_connect.deal_stages (organization_id, key, name, kind, position) values ($1, $2, $3, $4, $5)",
      [t.orgId, stage.key, stage.name, stage.kind, stage.position],
    );
  }
  if (plan.dealFieldsToCreate.length > 0) {
    await t.sql.query(
      "update ia_connect.org_settings set deal_custom_fields = $2::jsonb where organization_id = $1",
      [t.orgId, JSON.stringify([...settings.deal_custom_fields, ...plan.dealFieldsToCreate])],
    );
  }
  await t.addFlow(seeded.definition, key);
  return plan;
}

describe("renewals: Assicurapp expiring list → crm_rest → flows → WhatsApp templates → deals", () => {
  it("emits every row on the first daily poll, runs both templates and emits nothing on the second poll", async () => {
    t = await createIntegration();
    const crm = await t.connect("crm_rest", {
      config: ASSICURAPP_CONFIG,
      secrets: { authHeaderValue: `Bearer ${API_TOKEN}` },
      externalAccountId: "gestionale.assicurapp.example",
    });
    const whatsapp = await t.connect("whatsapp_meta", {
      config: { phoneNumberId: PHONE_NUMBER_ID, wabaId: "102290129340398" },
      secrets: { accessToken: WA_TOKEN },
      externalAccountId: PHONE_NUMBER_ID,
    });

    // ── Installation: stage after the last open one, fields appended once, templates approved ──
    const policyPlan = await installTemplate("insurance_policy_renewal");
    expect(policyPlan.stagesToCreate).toEqual([
      { key: "renewal_due", name: "In scadenza", kind: "open", position: 3 },
    ]);
    expect(policyPlan.stagesToMove).toHaveLength(2);
    const quotePlan = await installTemplate("insurance_quote_expiring");
    expect(quotePlan.stagesToCreate).toEqual([]);
    expect(quotePlan.dealFieldsToCreate.map((field) => field.key)).toEqual(["compagnia_attuale"]);
    expect(
      await t.all(
        "select key, kind, position from ia_connect.deal_stages where organization_id = $1 order by position",
        [t.orgId],
      ),
    ).toEqual([
      { key: "new", kind: "open", position: 0 },
      { key: "quote_sent", kind: "open", position: 1 },
      { key: "negotiation", kind: "open", position: 2 },
      { key: "renewal_due", kind: "open", position: 3 },
      { key: "won", kind: "won", position: 4 },
      { key: "lost", kind: "lost", position: 5 },
    ]);
    const fields = (
      await t.one("select deal_custom_fields from ia_connect.org_settings where organization_id = $1", [
        t.orgId,
      ])
    ).deal_custom_fields as { key: string; type: string }[];
    expect(fields.map((field) => field.key)).toEqual([
      "targa",
      "scadenza",
      "compagnia",
      "premio",
      "tipo",
      "numero_polizza",
      "compagnia_attuale",
    ]);
    expect(fields.find((field) => field.key === "scadenza")!.type).toBe("date");

    // ── Fake Assicurapp and fake Meta ──
    t.net.on("GET", EXPIRING, (call: NetCall) => {
      if (call.headers.authorization !== `Bearer ${API_TOKEN}`) {
        return jsonResponse({ status: "error", error: "token_revoked" }, 401);
      }
      return jsonResponse(expiring);
    });
    let sent = 0;
    t.net.on("POST", GRAPH_MESSAGES, (call: NetCall) =>
      jsonResponse({
        messaging_product: "whatsapp",
        contacts: [{ input: (call.json as { to: string }).to, wa_id: (call.json as { to: string }).to }],
        messages: [{ id: `wamid.OUT${++sent}` }],
      }),
    );

    // ── First poll: the whole list is actionable, one event per row ──
    await t.addJob("poll_connection", { connection_id: crm.id }, `poll:${crm.id}`);
    const polledAt = t.now();
    await drain(t.deps);

    // One request per watched resource, both to the same endpoint with the customer's token.
    const apiCalls = t.net.to(EXPIRING);
    expect(apiCalls).toHaveLength(2);
    for (const call of apiCalls) expect(call.headers.authorization).toBe(`Bearer ${API_TOKEN}`);

    const events = await t.all(
      "select type, connection_id, dedupe_key, status, payload, contact_hint from ia_connect.events order by type",
    );
    expect(events).toEqual([
      {
        type: "policy.expiring",
        connection_id: crm.id,
        dedupe_key: `crm_rest:${crm.id}:policies:${expiring.policies[0]!.policyUID}`,
        status: "processed",
        payload: { resource: "policies", id: expiring.policies[0]!.policyUID, data: expiring.policies[0] },
        contact_hint: { name: "ANNA VERDI", phone: "+393337654321", email: "anna@example.com" },
      },
      {
        type: "quote.expiring",
        connection_id: crm.id,
        dedupe_key: `crm_rest:${crm.id}:quotes:${expiring.quotes[0]!.quoteUID}`,
        status: "processed",
        payload: { resource: "quotes", id: expiring.quotes[0]!.quoteUID, data: expiring.quotes[0] },
        contact_hint: { name: "MARIO ROSSI", phone: "+393331234567", email: "mario@example.com" },
      },
    ]);
    // The cursor remembers both lists; the next poll is a day away (pollIntervalMinutes: 1440 honoured).
    const connection = await t.one("select config, last_error from ia_connect.connections where id = $1", [
      crm.id,
    ]);
    expect(connection.last_error).toBeNull();
    expect(connection.config.cursor).toEqual({
      seen: { quotes: [expiring.quotes[0]!.quoteUID], policies: [expiring.policies[0]!.policyUID] },
    });
    const poll = await t.one("select status, run_at from ia_connect.scheduled_jobs where dedupe_key = $1", [
      `poll:${crm.id}`,
    ]);
    expect(poll.status).toBe("pending");
    expect(new Date(poll.run_at).getTime() - polledAt.getTime()).toBeGreaterThanOrEqual(DAY - MINUTE);
    expect(new Date(poll.run_at).getTime() - polledAt.getTime()).toBeLessThanOrEqual(DAY + MINUTE);

    // ── Contacts: phone normalized, fiscal code kept, WhatsApp consent from the agency relationship ──
    const contacts = await t.all(
      "select full_name, phones, emails, custom_fields, consents from ia_connect.contacts order by full_name",
    );
    expect(contacts).toHaveLength(2);
    expect(contacts[0]).toMatchObject({
      full_name: "ANNA VERDI",
      phones: ["+393337654321"],
      emails: ["anna@example.com"],
      custom_fields: { codice_fiscale: "VRDNNA75B41F205X" },
    });
    expect(contacts[0]!.consents.whatsapp).toMatchObject({
      granted: true,
      source: "Cliente con polizza in agenzia",
    });
    expect(contacts[1]).toMatchObject({
      full_name: "MARIO ROSSI",
      phones: ["+393331234567"],
      custom_fields: { codice_fiscale: "RSSMRA80A01H501U" },
    });
    expect(contacts[1]!.consents.whatsapp).toMatchObject({
      granted: true,
      source: "Cliente con preventivo in agenzia",
    });

    // ── WhatsApp: the two template requests as Meta receives them ──
    const graph = t.net.to(GRAPH_MESSAGES, "POST").map((call) => call.json);
    expect(graph).toHaveLength(2);
    for (const call of t.net.to(GRAPH_MESSAGES, "POST"))
      expect(call.headers.authorization).toBe(`Bearer ${WA_TOKEN}`);
    expect(graph).toContainEqual({
      messaging_product: "whatsapp",
      to: "393337654321",
      type: "template",
      template: {
        name: "rinnovo_polizza",
        language: { code: "it" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "ANNA VERDI" },
              { type: "text", text: "FX456DE" },
              { type: "text", text: "2026-10-20" },
            ],
          },
        ],
      },
    });
    expect(graph).toContainEqual({
      messaging_product: "whatsapp",
      to: "393331234567",
      type: "template",
      template: {
        name: "scadenza_copertura",
        language: { code: "it" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "MARIO ROSSI" },
              { type: "text", text: "GA123BC" },
              { type: "text", text: "ZAVAROVALNICA TRIGLAV D.D." },
              { type: "text", text: "2026-10-17" },
            ],
          },
        ],
      },
    });
    const messages = await t.all(
      "select content, delivery_status, channel from ia_connect.messages where direction = 'out' order by content",
    );
    expect(messages.map((message) => message.delivery_status)).toEqual(["sent", "sent"]);
    expect(messages[0]!.content).toBe(
      "Buongiorno ANNA VERDI, la polizza della targa FX456DE scade il 2026-10-20. Possiamo preparare il rinnovo: ci scriva qui per confermare o per qualsiasi domanda. Questo è un messaggio automatico.",
    );
    expect(messages[1]!.content).toBe(
      "Buongiorno MARIO ROSSI, la copertura della targa GA123BC con ZAVAROVALNICA TRIGLAV D.D. scade il 2026-10-17. Il preventivo che le abbiamo preparato è ancora valido: se vuole attivarlo o ha domande, ci scriva qui. Questo è un messaggio automatico.",
    );

    // ── Deals: the renewal_due stage, the custom fields, the premium in cents ──
    const deals = await t.all(
      `select d.title, s.key as stage, d.estimated_value_cents::int as cents, d.next_action, d.custom_fields, c.full_name
       from ia_connect.deals d
       join ia_connect.deal_stages s on s.id = d.stage_id
       join ia_connect.contacts c on c.id = d.contact_id
       order by d.title`,
    );
    expect(deals).toEqual([
      {
        title: "Preventivo RCA Auto · GA123BC",
        stage: "renewal_due",
        cents: null,
        next_action: "Proporre l'attivazione prima del 2026-10-17",
        custom_fields: {
          targa: "GA123BC",
          scadenza: "2026-10-17",
          compagnia_attuale: "ZAVAROVALNICA TRIGLAV D.D.",
          tipo: "preventivo",
        },
        full_name: "MARIO ROSSI",
      },
      {
        title: "Rinnovo RCA Auto · FX456DE",
        stage: "renewal_due",
        cents: 41250,
        next_action: "Rinnovare prima del 2026-10-20",
        custom_fields: {
          targa: "FX456DE",
          scadenza: "2026-10-20",
          compagnia: "groupama",
          premio: "412.50",
          tipo: "polizza",
          numero_polizza: "123456789",
        },
        full_name: "ANNA VERDI",
      },
    ]);

    // ── Both runs wait for the customer's reply ──
    const runs = await t.all("select status, waiting_for, current_step_id from ia_connect.flow_runs");
    expect(runs).toEqual([
      { status: "waiting", waiting_for: "reply", current_step_id: "wait_reply" },
      { status: "waiting", waiting_for: "reply", current_step_id: "wait_reply" },
    ]);

    // ── A day later the same list comes back: nothing new, nothing sent, nothing created ──
    t.advance(DAY + MINUTE);
    await drain(t.deps);
    expect(t.net.to(EXPIRING)).toHaveLength(4);
    expect(await t.all("select 1 from ia_connect.events")).toHaveLength(2);
    expect(await t.all("select 1 from ia_connect.flow_runs")).toHaveLength(2);
    expect(await t.all("select 1 from ia_connect.deals")).toHaveLength(2);
    expect(t.net.to(GRAPH_MESSAGES, "POST")).toHaveLength(2);

    // ── A new policy in the list the day after: exactly one more event and run ──
    expiring.policies.push({
      ...expiring.policies[0]!,
      policyUID: "0198c3d4-0000-7000-8000-000000000009",
      plate: "AB000CD",
      client_name: "LUCA NERI",
      phone: "+39 333 0000000",
      email: "luca@example.com",
    });
    t.advance(DAY + MINUTE);
    await drain(t.deps);
    expect(await t.all("select 1 from ia_connect.events")).toHaveLength(3);
    expect(await t.all("select 1 from ia_connect.flow_runs")).toHaveLength(3);
    expect(t.net.to(GRAPH_MESSAGES, "POST")).toHaveLength(3);

    // Neither token ends up in a row or a log line.
    expect(await leaks(t, [API_TOKEN, WA_TOKEN])).toEqual([]);
    expect(whatsapp.id).toBeTruthy();
  });

  it("stops polling with a clear message when the token is revoked and asks for a health check", async () => {
    t = await createIntegration();
    const crm = await t.connect("crm_rest", {
      config: ASSICURAPP_CONFIG,
      secrets: { authHeaderValue: "Bearer revoked-token" },
      externalAccountId: "gestionale.assicurapp.example",
    });
    t.net.on("GET", EXPIRING, () =>
      jsonResponse({ status: "error", error: "token_revoked", message: "Token revoked by the agency" }, 401),
    );
    await t.addJob("poll_connection", { connection_id: crm.id }, `poll:${crm.id}`);
    await drain(t.deps);

    const connection = await t.one("select status, last_error from ia_connect.connections where id = $1", [
      crm.id,
    ]);
    expect(connection.status).toBe("expired");
    expect(connection.last_error).toContain("ricollega");
    expect(connection.last_error).not.toContain("Token revoked by the agency");
    expect(await t.all("select 1 from ia_connect.events")).toHaveLength(0);
    const notice = await t.one("select title from ia_connect.notifications where organization_id = $1", [
      t.orgId,
    ]);
    expect(notice.title).toBe("Collegamento scaduto");
  });
});
