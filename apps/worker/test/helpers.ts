import {
  type AiService,
  type AiUsage,
  CalendarCreateEventInput,
  CalendarFindSlotsInput,
  type Connector,
  type ConnectorCategory,
  CrmReadInput,
  CrmWriteInput,
  type FlowDefinition,
  FlowDefinitionSchema,
  MailSendInput,
  PaymentCreateLinkInput,
  RESERVED_EVENT_SOURCES,
  SignatureCreateInput,
  SmsSendInput,
  SocialPublishPostInput,
  SocialSendMessageInput,
  WhatsAppSendTemplateInput,
  WhatsAppSendTextInput,
} from "@ia-connect/core";
import { z } from "zod";
import { type TestDb, createTestDb } from "../../../supabase/test/db.ts";
import { type Sql, createPgliteSql } from "../src/db/sql.ts";
import { DEFAULT_CONFIG, type Deps, type WorkerConfig } from "../src/deps.ts";
import { silentLogger } from "../src/log.ts";
import { createMemorySecretStore } from "../src/secrets.ts";

export interface Call {
  connector: string;
  action: string;
  input: Record<string, unknown>;
}

export const USAGE: AiUsage = { model: "fake-model", inputTokens: 1200, outputTokens: 300, costMicros: 4200 };

/** Fake connectors: every call is recorded, nothing leaves the process. */
export function fakeConnectors(calls: Call[], hooks: { before?: (call: Call) => void | Promise<void> } = {}) {
  let counter = 0;
  const action = (
    connector: string,
    key: string,
    input: z.ZodType,
    result: (input: Record<string, unknown>) => unknown,
  ) => ({
    key,
    title: key,
    input,
    async execute(_context: unknown, parsed: unknown) {
      const call = { connector, action: key, input: parsed as Record<string, unknown> };
      await hooks.before?.(call);
      calls.push(call);
      return result(parsed as Record<string, unknown>);
    },
  });
  const sent = () => ({ externalId: `ext-${++counter}`, status: "sent" });
  const make = (
    key: string,
    category: ConnectorCategory,
    actions: Record<string, [z.ZodType, (input: Record<string, unknown>) => unknown]>,
  ) =>
    ({
      key,
      category,
      name: key,
      description: "",
      connectMode: "api_key",
      inputSchema: z.object({}),
      emits: [],
      connect: async () => ({ config: {}, secrets: {} }),
      verify: async () => ({ status: "active" }),
      disconnect: async () => undefined,
      actions: Object.fromEntries(
        Object.entries(actions).map(([name, [input, result]]) => [name, action(key, name, input, result)]),
      ),
    }) as Connector;

  const list: Connector[] = [
    make("whatsapp_meta", "whatsapp", {
      sendTemplate: [WhatsAppSendTemplateInput, sent],
      sendText: [WhatsAppSendTextInput, sent],
    }),
    make("gmail", "mail", { send: [MailSendInput, sent] }),
    make("sms_twilio", "sms", { send: [SmsSendInput, sent] }),
    make("meta_social", "social", {
      sendMessage: [SocialSendMessageInput, sent],
      publishPost: [SocialPublishPostInput, sent],
    }),
    make("crm_rest", "crm", {
      read: [CrmReadInput, (input) => ({ records: [{ resource: input.resource, status: "spedito" }] })],
      write: [CrmWriteInput, () => ({ id: "crm-1" })],
    }),
    make("google_calendar", "calendar", {
      findSlots: [
        CalendarFindSlotsInput,
        () => ({ slots: [{ start: "2026-10-06T09:00:00Z", end: "2026-10-06T09:30:00Z" }] }),
      ],
      createEvent: [CalendarCreateEventInput, () => ({ externalEventId: "cal-1" })],
    }),
    make("payment_stripe", "payment", {
      createLink: [PaymentCreateLinkInput, () => ({ externalId: "pay-1", url: "https://pay.example/1" })],
    }),
    make("signature_link", "signature", {
      createRequest: [SignatureCreateInput, () => ({ externalId: "sig-1", url: "https://sign.example/1" })],
    }),
  ];
  return { get: (key: string) => list.find((item) => item.key === key), list: () => list, items: list };
}

export function fakeAi(
  script: Partial<AiService> = {},
): AiService & { replies: Parameters<AiService["reply"]>[0][] } {
  const replies: Parameters<AiService["reply"]>[0][] = [];
  return {
    replies,
    extract: async () => ({ data: { name: "Mario Rossi", phone: "3331234567" }, missing: [], usage: USAGE }),
    classify: async (input) => ({ category: input.categories[0]!.key, usage: USAGE }),
    summarize: async () => ({ summary: "Riassunto di prova.", usage: USAGE }),
    reply: async (input) => {
      replies.push(input);
      return { text: `Risposta ${input.turn}`, outcome: "continue", usage: USAGE };
    },
    ...script,
  };
}

export interface Harness {
  db: TestDb;
  sql: Sql;
  deps: Deps;
  calls: Call[];
  ai: ReturnType<typeof fakeAi>;
  /** Moves the injected clock forward. */
  advance(ms: number): void;
  orgId: string;
  connections: Record<string, string>;
  // biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary columns
  one<T = any>(text: string, params?: unknown[]): Promise<T>;
  // biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary columns
  all<T = any>(text: string, params?: unknown[]): Promise<T[]>;
  createOrg(
    name: string,
    limits?: Partial<Record<string, number>>,
  ): Promise<{ orgId: string; connections: Record<string, string> }>;
  addFlow(
    definition: unknown,
    options?: { orgId?: string; status?: string; name?: string },
  ): Promise<{ flowId: string; versionId: string }>;
  addEvent(
    type: string,
    payload: Record<string, unknown>,
    options?: { orgId?: string; connectionId?: string | null; dedupeKey?: string },
  ): Promise<string>;
  addTemplate(name: string, body: string, orgId?: string): Promise<string>;
  addJob(
    kind: string,
    payload: Record<string, unknown>,
    options?: { orgId?: string; createdBy?: string | null },
  ): Promise<string>;
}

const CONNECTORS: [string, string][] = [
  ["whatsapp", "whatsapp_meta"],
  ["mail", "gmail"],
  ["sms", "sms_twilio"],
  ["social", "meta_social"],
  ["crm", "crm_rest"],
  ["calendar", "google_calendar"],
  ["payment", "payment_stripe"],
  ["signature", "signature_link"],
];

let sequence = 0;

export async function createHarness(
  options: {
    ai?: Partial<AiService>;
    config?: Partial<WorkerConfig>;
    before?: (call: Call) => void | Promise<void>;
  } = {},
): Promise<Harness> {
  const db = await createTestDb();
  const sql = createPgliteSql(db.pg);
  const calls: Call[] = [];
  const ai = fakeAi(options.ai);
  let clock = Date.now();
  const deps: Deps = {
    sql,
    secrets: createMemorySecretStore(),
    connectors: fakeConnectors(calls, { before: options.before }),
    ai,
    now: () => new Date(clock),
    logger: silentLogger,
    fetch: async () => {
      throw new Error("no network in tests");
    },
    config: { ...DEFAULT_CONFIG, ...options.config },
  };
  const all = <T>(text: string, params: unknown[] = []) => sql.query<T>(text, params);
  const one = async <T>(text: string, params: unknown[] = []) => (await sql.query<T>(text, params))[0] as T;

  const createOrg: Harness["createOrg"] = async (name, limits = {}) => {
    const plan = await one<{ id: string }>(
      "insert into ia_connect.plans (key, name, limits) values ($1, $1, $2::jsonb) returning id",
      [
        `test_${++sequence}`,
        JSON.stringify({
          active_flows: 10,
          messages_per_month: 100,
          scrape_runs_per_month: 100,
          ai_credits_per_month: 100,
          ...limits,
        }),
      ],
    );
    const org = await one<{ id: string }>(
      `insert into ia_connect.organizations (reseller_id, name, plan_id)
       select id, $1, $2 from ia_connect.resellers where slug = 'default' returning id`,
      [name, plan.id],
    );
    const connections: Record<string, string> = {};
    for (const [category, type] of CONNECTORS) {
      const row = await one<{ id: string }>(
        "insert into ia_connect.connections (organization_id, connector_type, name) values ($1, $2, $2) returning id",
        [org.id, type],
      );
      connections[category] = row.id;
    }
    return { orgId: org.id, connections };
  };
  const main = await createOrg("Agenzia Rossi");

  return {
    db,
    sql,
    deps,
    calls,
    ai,
    advance: (ms) => {
      clock += ms;
    },
    ...main,
    one,
    all,
    createOrg,
    async addFlow(definition, { orgId = main.orgId, status = "active", name = "Flusso di prova" } = {}) {
      const parsed: FlowDefinition = FlowDefinitionSchema.parse(definition);
      // Draft first: the database lets a flow become active only once it has its version.
      const flow = await one<{ id: string }>(
        "insert into ia_connect.flows (organization_id, name, status, trigger_event) values ($1, $2, 'draft', $3) returning id",
        [orgId, name, parsed.trigger.event],
      );
      const version = await one<{ id: string }>(
        `insert into ia_connect.flow_versions (organization_id, flow_id, version, definition, author_type)
         values ($1, $2, 1, $3::jsonb, 'user') returning id`,
        [orgId, flow.id, JSON.stringify(definition)],
      );
      await sql.query("update ia_connect.flows set active_version_id = $2, status = $3 where id = $1", [
        flow.id,
        version.id,
        status,
      ]);
      return { flowId: flow.id, versionId: version.id };
    },
    async addEvent(type, payload, { orgId = main.orgId, connectionId, dedupeKey } = {}) {
      // Reserved types count only when they come from a connection of the right kind: by
      // default the event arrives from the organization's connection of that category, as
      // it would from the real connector. Pass `connectionId: null` for an event without origin.
      if (connectionId === undefined) {
        const category = RESERVED_EVENT_SOURCES[type];
        const found = category
          ? await one<{ id: string } | undefined>(
              `select c.id from ia_connect.connections c join ia_connect.connector_types t on t.key = c.connector_type
               where c.organization_id = $1 and t.category = $2 order by c.created_at limit 1`,
              [orgId, category],
            )
          : undefined;
        connectionId = found?.id ?? null;
      }
      const row = await one<{ id: string }>(
        `insert into ia_connect.events (organization_id, type, connection_id, payload, dedupe_key, occurred_at, available_at)
         values ($1, $2, $3, $4::jsonb, $5, $6::timestamptz, $6::timestamptz) returning id`,
        [
          orgId,
          type,
          connectionId,
          JSON.stringify(payload),
          dedupeKey ?? `test-${++sequence}`,
          new Date(clock).toISOString(),
        ],
      );
      return row.id;
    },
    async addTemplate(name, body, orgId = main.orgId) {
      const row = await one<{ id: string }>(
        `insert into ia_connect.message_templates (organization_id, channel, name, body, approval_status)
         values ($1, 'whatsapp', $2, $3, 'approved') returning id`,
        [orgId, name, body],
      );
      return row.id;
    },
    async addJob(kind, payload, { orgId = main.orgId, createdBy = null } = {}) {
      const row = await one<{ id: string }>(
        `insert into ia_connect.scheduled_jobs (organization_id, kind, payload, run_at, created_by)
         values ($1, $2, $3::jsonb, $4::timestamptz, $5) returning id`,
        [orgId, kind, JSON.stringify(payload), new Date(clock).toISOString(), createdBy],
      );
      return row.id;
    },
  };
}

export const PHONE = "+393331234567";

/** contact → WhatsApp template → deal: the Phase 0 check. */
export const PHASE0_FLOW = {
  trigger: { event: "manual.test", filters: [] },
  steps: [
    {
      id: "contact",
      block: "contact.upsert",
      params: {
        name: "{{event.payload.name}}",
        phone: "{{event.payload.phone}}",
        consent: { channel: "whatsapp", source: "Modulo di prova" },
      },
    },
    {
      id: "send",
      block: "whatsapp.send_template",
      params: { template: "benvenuto", variables: { "1": "{{contact.full_name}}" } },
    },
    {
      id: "deal",
      block: "deal.create",
      params: { title: "Richiesta di {{contact.full_name}}", stage: "new", value: "1.250,50" },
    },
  ],
};
