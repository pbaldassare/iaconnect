/**
 * The web app and the worker only meet in the database. These tests insert exactly what
 * the web builds (its pure builders, imported from apps/web/src/lib) through RLS, as a
 * signed-in user, and let the worker's handlers process it — and check that what the
 * worker writes back is what the web expects to read.
 *
 * The step outputs of a simulated and of a live run are also captured into
 * apps/web/test/fixtures/*.json: the web's renderer tests read those files, so a change
 * to an executor's output shape fails here first (update with `vitest -u`) and then shows
 * up in the web tests.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_LINKS,
  type BrowserPort,
  type ExtractStep,
  type ScrapeRecipe,
  USER_JOB_KINDS,
  aiCallColumns,
  listBlocks,
  validateFlow,
} from "@ia-connect/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONNECTOR_ENV_KEYS,
  mergeReconnectConfig,
  sanitizeConfig,
} from "../../web/src/lib/connections/catalog";
import { buildValidationContext } from "../../web/src/lib/flows/context";
import { planTemplateInstall } from "../../web/src/lib/flows/install";
import {
  buildTestEvent,
  sampleEventPayload,
  testEventMode,
  testEventProblem,
} from "../../web/src/lib/flows/test-event";
import {
  buildFreeMessage,
  buildTemplateMessage,
  outgoingMessageRow,
  usesTemplate,
} from "../../web/src/lib/inbox/outgoing";
import {
  type JobRequest,
  approvalDecidedJob,
  jobInsertRow,
  scrapeRunJob,
  scrapeTraceJob,
  sendMessageJob,
  simulateFlowJob,
  simulateSampleJob,
  verifyConnectionJob,
} from "../../web/src/lib/job-requests";
import { normalizeTemplateLanguage } from "../../web/src/lib/message-templates";
import { traceState } from "../../web/src/lib/scrape/describe";
import { logAiCall } from "../src/db/repo.ts";
import { connectorEnv } from "../src/deps.ts";
import { ensureRecurringJobs } from "../src/ensure.ts";
import { USER_JOB_KINDS as WORKER_USER_JOB_KINDS } from "../src/jobs/index.ts";
import { drain } from "../src/worker.ts";
import { type Harness, PHONE, USAGE, createHarness } from "./helpers.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_APP_DIR = join(HERE, "../../web/src/app");
const FIXTURES = "../../web/test/fixtures";
/** In the future, so rows inserted "now" by the database are always due. */
const FIXED_NOW = new Date("2030-01-15T10:00:00.000Z");

let h: Harness;
let owner: string;
afterEach(async () => {
  await h?.db.close().catch(() => undefined);
});

/** A harness with a signed-in owner of the organization: the person using the web app. */
async function setup(options: Parameters<typeof createHarness>[0] = {}) {
  h = await createHarness(options);
  owner = (await h.one("insert into auth.users (email) values ('titolare@test.it') returning id")).id;
  await h.sql.query(
    "insert into ia_connect.memberships (user_id, organization_id, role) values ($1, $2, 'org_owner')",
    [owner, h.orgId],
  );
}

/**
 * Lets the worker handle what is due. Rows inserted through RLS get their times from the
 * database or from the web server's clock, a moment after the harness clock was read.
 */
async function work() {
  h.advance(5_000);
  await drain(h.deps);
}

/** INSERT through RLS as the signed-in user, with exactly the columns of `row` (objects → jsonb). */
async function webInsert(table: string, row: Record<string, unknown>, user = owner): Promise<string> {
  const keys = Object.keys(row);
  const isJson = (value: unknown) => value !== null && typeof value === "object";
  const rows = await h.db.asUser<{ id: string }>(
    user,
    `insert into ia_connect.${table} (${keys.join(", ")})
     values (${keys.map((key, index) => `$${index + 1}${isJson(row[key]) ? "::jsonb" : ""}`).join(", ")})
     returning id`,
    keys.map((key) => (isJson(row[key]) ? JSON.stringify(row[key]) : row[key])),
  );
  return rows[0]!.id;
}

/** `requestJob` of the web app, minus the audit entry: the same row, through RLS. */
const webRequestJob = (request: JobRequest, runAt?: Date) =>
  webInsert("scheduled_jobs", jobInsertRow(h.orgId, request, runAt));

const job = (id: string) =>
  h.one("select status, last_error, created_by from ia_connect.scheduled_jobs where id = $1", [id]);

async function addContact(consents: Record<string, unknown> = {}) {
  const row = await h.one(
    `insert into ia_connect.contacts (organization_id, full_name, phones, emails, consents)
     values ($1, 'Maria Rossi', array[$2], array['maria.rossi@example.com'], $3::jsonb) returning id`,
    [h.orgId, PHONE, JSON.stringify(consents)],
  );
  return row.id as string;
}

async function addConversation(contactId: string, channel: string, windowOpen: boolean) {
  const row = await h.one(
    `insert into ia_connect.conversations (organization_id, contact_id, channel, connection_id, window_expires_at)
     values ($1, $2, $3, $4, $5::timestamptz) returning id, window_expires_at`,
    [
      h.orgId,
      contactId,
      channel,
      h.connections[channel],
      windowOpen ? new Date(h.deps.now().getTime() + 3_600_000).toISOString() : null,
    ],
  );
  return row as { id: string; window_expires_at: Date | null };
}

const GRANTED = { granted: true, at: "2026-10-01T08:00:00.000Z", source: "Modulo" };

// ── 1. Jobs ───────────────────────────────────────────────────────────

describe("jobs requested by the web app", () => {
  it("shares one list of kinds and one payload schema per kind", () => {
    expect([...WORKER_USER_JOB_KINDS].sort()).toEqual([...USER_JOB_KINDS].sort());
    const id = "7d69efad-b09f-49ea-abf0-d32e5fd51c76";
    const at = new Date("2026-10-04T10:00:05.000Z");
    const requests = [
      sendMessageJob(id),
      approvalDecidedJob(id, at),
      simulateFlowJob(id, at),
      scrapeRunJob(id, at),
      scrapeTraceJob(id, at),
      verifyConnectionJob(id, at),
    ];
    // Every kind a user may insert has a builder, and every builder passes the shared schema.
    expect(requests.map((request) => request.kind).sort()).toEqual([...USER_JOB_KINDS].sort());
    for (const request of requests) {
      expect(jobInsertRow("org", request, at)).toEqual({
        organization_id: "org",
        kind: request.kind,
        payload: request.payload,
        run_at: at.toISOString(),
        dedupe_key: request.dedupeKey,
      });
    }
    // The worker's own recurring jobs are recognised by these keys: a user request never uses them.
    for (const request of requests)
      expect(request.dedupeKey).not.toMatch(/^(verify|scrape|poll|report):[0-9a-f-]+$/);
    // A payload that is not what the schema says never reaches the database.
    expect(() => jobInsertRow("org", sendMessageJob("not-a-uuid"))).toThrow();
  });

  it("passes RLS with the columns the web sets and is marked with the user who asked", async () => {
    await setup();
    const id = await webRequestJob(verifyConnectionJob(h.connections.whatsapp!));
    expect(await job(id)).toMatchObject({ status: "pending", created_by: owner });
    await work();
    expect(await job(id)).toMatchObject({ status: "done", last_error: null });
    const connection = await h.one(
      "select status, last_checked_at, last_error from ia_connect.connections where id = $1",
      [h.connections.whatsapp],
    );
    expect(connection).toMatchObject({ status: "active", last_error: null });
    expect(connection.last_checked_at).toBeTruthy();
    // "Verifica ora" is a one-off: it must not turn into a second daily check.
    expect(await h.all("select 1 from ia_connect.scheduled_jobs where status = 'pending'")).toHaveLength(0);
  });

  it("is refused by RLS when the web would set what only the worker may set", async () => {
    await setup();
    const row = jobInsertRow(h.orgId, verifyConnectionJob(h.connections.whatsapp!));
    await expect(webInsert("scheduled_jobs", { ...row, status: "done" })).rejects.toThrow();
    await expect(webInsert("scheduled_jobs", { ...row, attempts: 3 })).rejects.toThrow();
    await expect(webInsert("scheduled_jobs", { ...row, created_by: null })).rejects.toThrow();
    await expect(webInsert("scheduled_jobs", { ...row, kind: "poll_connection" })).rejects.toThrow();
  });
});

// ── 2. Operator messages ──────────────────────────────────────────────

describe("messages written in the inbox", () => {
  it("free text inside the WhatsApp window: sent, and the message carries the outcome", async () => {
    await setup();
    const contact = await addContact({ whatsapp: GRANTED });
    const conversation = await addConversation(contact, "whatsapp", true);
    expect(usesTemplate("whatsapp", conversation.window_expires_at?.toISOString(), "", h.deps.now())).toBe(
      false,
    );
    const built = buildFreeMessage("whatsapp", "  Buongiorno, la richiamo domani.  ");
    if (!built.ok) throw new Error(built.error);
    const messageId = await webInsert(
      "messages",
      outgoingMessageRow({
        organizationId: h.orgId,
        conversationId: conversation.id,
        channel: "whatsapp",
        userId: owner,
        message: built.message,
      }),
    );
    const jobId = await webRequestJob(sendMessageJob(messageId));
    await work();

    expect(h.calls).toEqual([
      {
        connector: "whatsapp_meta",
        action: "sendText",
        input: { to: PHONE, text: "Buongiorno, la richiamo domani." },
      },
    ]);
    expect(await job(jobId)).toMatchObject({ status: "done" });
    expect(
      await h.one(
        "select delivery_status, external_id, error, meta, sent_by_user_id from ia_connect.messages where id = $1",
        [messageId],
      ),
    ).toEqual({
      delivery_status: "sent",
      external_id: "ext-1",
      error: null,
      meta: {},
      sent_by_user_id: owner,
    });
  });

  it("approved template outside the window: template, language and variables reach the connector", async () => {
    await setup();
    const contact = await addContact({ whatsapp: GRANTED });
    const conversation = await addConversation(contact, "whatsapp", false);
    // The template as the settings page stores it (language normalized for Meta).
    const templateId = await webInsert("message_templates", {
      organization_id: h.orgId,
      channel: "whatsapp",
      name: "Promemoria",
      language: normalizeTemplateLanguage("en_us"),
      body: "Buongiorno {{1}}, le ricordiamo l'appuntamento di {{2}}.",
      external_name: "promemoria_v2",
      approval_status: "approved",
    });
    const template = await h.one(
      "select id, body, channel, approval_status from ia_connect.message_templates where id = $1",
      [templateId],
    );
    expect(usesTemplate("whatsapp", null, "free", h.deps.now())).toBe(true);
    const built = buildTemplateMessage(template, [" Maria ", "martedì alle 15", "in più"]);
    if (!built.ok) throw new Error(built.error);
    expect(built.message).toEqual({
      content: "Buongiorno Maria, le ricordiamo l'appuntamento di martedì alle 15.",
      meta: { variables: ["Maria", "martedì alle 15"] },
      template_id: templateId,
    });
    const messageId = await webInsert(
      "messages",
      outgoingMessageRow({
        organizationId: h.orgId,
        conversationId: conversation.id,
        channel: "whatsapp",
        userId: owner,
        message: built.message,
      }),
    );
    await webRequestJob(sendMessageJob(messageId));
    await work();

    expect(h.calls).toEqual([
      {
        connector: "whatsapp_meta",
        action: "sendTemplate",
        input: {
          to: PHONE,
          template: "promemoria_v2",
          language: "en_US",
          variables: ["Maria", "martedì alle 15"],
          renderedText: "Buongiorno Maria, le ricordiamo l'appuntamento di martedì alle 15.",
        },
      },
    ]);
    const stored = await h.one("select delivery_status, meta from ia_connect.messages where id = $1", [
      messageId,
    ]);
    // The worker's own bookkeeping key is gone; what the web wrote is still there.
    expect(stored).toEqual({ delivery_status: "sent", meta: { variables: ["Maria", "martedì alle 15"] } });
  });

  it("mail: the subject travels in meta.subject", async () => {
    await setup();
    const contact = await addContact({ mail: GRANTED });
    const conversation = await addConversation(contact, "mail", false);
    const built = buildFreeMessage("mail", "In allegato il preventivo.", "  Il suo preventivo ");
    if (!built.ok) throw new Error(built.error);
    expect(built.message.meta).toEqual({ subject: "Il suo preventivo" });
    const messageId = await webInsert(
      "messages",
      outgoingMessageRow({
        organizationId: h.orgId,
        conversationId: conversation.id,
        channel: "mail",
        userId: owner,
        message: built.message,
      }),
    );
    await webRequestJob(sendMessageJob(messageId));
    await work();
    expect(h.calls[0]).toMatchObject({
      connector: "gmail",
      action: "send",
      input: {
        to: "maria.rossi@example.com",
        subject: "Il suo preventivo",
        text: "In allegato il preventivo.",
      },
    });
  });

  it("a refusal comes back as failed + an Italian reason, which is what the inbox shows", async () => {
    await setup();
    const contact = await addContact({ whatsapp: { ...GRANTED, granted: false } });
    const conversation = await addConversation(contact, "whatsapp", true);
    const built = buildFreeMessage("whatsapp", "Buongiorno");
    if (!built.ok) throw new Error(built.error);
    const messageId = await webInsert(
      "messages",
      outgoingMessageRow({
        organizationId: h.orgId,
        conversationId: conversation.id,
        channel: "whatsapp",
        userId: owner,
        message: built.message,
      }),
    );
    const jobId = await webRequestJob(sendMessageJob(messageId));
    await work();
    expect(h.calls).toHaveLength(0);
    const stored = await h.one("select delivery_status, error from ia_connect.messages where id = $1", [
      messageId,
    ]);
    expect(stored.delivery_status).toBe("failed");
    expect(stored.error).toContain("consenso");
    // The job itself is done: the outcome lives on the message, not in a retry.
    expect(await job(jobId)).toMatchObject({ status: "done" });
  });

  it("refuses in the builder what the worker would refuse later", () => {
    expect(buildFreeMessage("sms", "   ")).toMatchObject({ ok: false });
    expect(buildTemplateMessage(null, [])).toMatchObject({ ok: false });
    expect(
      buildTemplateMessage({ id: "t", body: "Ciao {{1}}", channel: "whatsapp", approval_status: "pending" }, [
        "x",
      ]),
    ).toMatchObject({ ok: false });
    expect(
      buildTemplateMessage(
        { id: "t", body: "Ciao {{1}}", channel: "whatsapp", approval_status: "approved" },
        [""],
      ),
    ).toMatchObject({ ok: false });
    // A subject is a mail thing: on other channels it is dropped.
    expect(buildFreeMessage("sms", "Ciao", "Oggetto")).toMatchObject({ message: { meta: {} } });
  });
});

// ── 3. Approvals ──────────────────────────────────────────────────────

const APPROVAL_FLOW = {
  trigger: { event: "manual.test", filters: [] },
  steps: [
    {
      id: "approve",
      block: "human.request_approval",
      params: { summary: "Inviare l'offerta?" },
      onApproved: "yes",
      onRejected: "no",
    },
    { id: "yes", block: "human.notify_owner", params: { message: "Approvata" }, next: "end" },
    { id: "no", block: "human.notify_owner", params: { message: "Rifiutata" }, next: "end" },
  ],
};

/** What `decideApproval` writes: only a pending row, with who and when. */
async function webDecide(approvalId: string, decision: "approved" | "rejected", decidedAt: Date) {
  const updated = await h.db.asUser<{ id: string }>(
    owner,
    `update ia_connect.approvals set status = $2, decided_by = $3, decided_at = $4::timestamptz
     where id = $1 and organization_id = $5 and status = 'pending' returning id`,
    [approvalId, decision, owner, decidedAt.toISOString(), h.orgId],
  );
  if (updated.length === 0) return null;
  return webRequestJob(approvalDecidedJob(approvalId, decidedAt));
}

describe("approvals decided in the web app", () => {
  it.each([
    ["approved", "Approvata"],
    ["rejected", "Rifiutata"],
  ] as const)("%s: the run resumes from the matching exit", async (decision, message) => {
    await setup();
    await h.addFlow(APPROVAL_FLOW);
    await h.addEvent("manual.test", {});
    await work();
    const approval = await h.one("select id, status, summary from ia_connect.approvals");
    expect(approval).toMatchObject({ status: "pending", summary: "Inviare l'offerta?" });

    const jobId = await webDecide(approval.id, decision, h.deps.now());
    expect(jobId).toBeTruthy();
    // A second click finds nothing pending and asks for nothing.
    expect(await webDecide(approval.id, "rejected", h.deps.now())).toBeNull();
    await work();

    expect((await h.one("select status from ia_connect.flow_runs")).status).toBe("completed");
    expect(
      await h.one("select outlet, output from ia_connect.flow_run_steps where step_id = 'approve'"),
    ).toMatchObject({
      outlet: decision === "approved" ? "onApproved" : "onRejected",
      output: { decision },
    });
    expect(
      (await h.all("select body from ia_connect.notifications where kind = 'flow'")).map((n) => n.body),
    ).toEqual([message]);
  });

  it("a later decision on the same approval row is a new job, not a duplicate key", () => {
    const id = "7d69efad-b09f-49ea-abf0-d32e5fd51c76";
    const first = approvalDecidedJob(id, new Date("2026-10-04T10:00:00.000Z"));
    const second = approvalDecidedJob(id, new Date("2026-10-05T09:00:00.000Z"));
    expect(first.payload).toEqual(second.payload);
    expect(first.dedupeKey).not.toBe(second.dedupeKey);
  });
});

// ── 4. Flows: activation, test event, template installation ───────────

describe("flows", () => {
  it("a test event built by the web starts a flow limited to one connection", async () => {
    await setup();
    const crm = h.connections.crm!;
    const definition = {
      trigger: { event: "order.created", connection: crm, filters: [] },
      steps: [
        {
          id: "note",
          block: "human.notify_owner",
          params: { message: "Ordine {{event.payload.orderNumber}}" },
        },
      ],
    };
    // The flow as the web leaves it after "Attiva": status, active_version_id, trigger_event.
    const { flowId, versionId } = await h.addFlow(definition, { status: "draft" });
    await h.db.asUser(
      owner,
      "update ia_connect.flows set status = 'active', active_version_id = $2, trigger_event = $3 where id = $1",
      [flowId, versionId, definition.trigger.event],
    );
    const payload = sampleEventPayload("order.created");
    expect(testEventMode("order.created")).toBe("event");
    expect(testEventProblem("order.created", payload)).toBeNull();
    const row = buildTestEvent({
      organizationId: h.orgId,
      type: "order.created",
      payload,
      trigger: definition.trigger,
      connectionIds: Object.values(h.connections),
      id: "prova-1",
    });
    expect(row).toMatchObject({ dedupe_key: "manual:prova-1", connection_id: crm });
    const eventId = await webInsert("events", row);
    await work();

    expect(await h.one("select status, error from ia_connect.events where id = $1", [eventId])).toEqual({
      status: "processed",
      error: null,
    });
    expect(await h.one("select status, mode, event_id from ia_connect.flow_runs")).toEqual({
      status: "completed",
      mode: "live",
      event_id: eventId,
    });

    // "Metti in pausa" as the web writes it: the same event type starts nothing.
    await h.db.asUser(owner, "update ia_connect.flows set status = 'paused' where id = $1", [flowId]);
    await webInsert("events", { ...row, dedupe_key: "manual:prova-2" });
    await work();
    expect(await h.all("select 1 from ia_connect.flow_runs")).toHaveLength(1);
  });

  it("the test of an inbound-message flow is a simulation: no contact, no window, nothing sent", async () => {
    await setup();
    const definition = {
      trigger: { event: "whatsapp.message.received", filters: [] },
      steps: [
        { id: "answer", block: "whatsapp.send_text", params: { text: "Grazie {{event.payload.fromName}}" } },
      ],
    };
    const { versionId } = await h.addFlow(definition);
    const payload = sampleEventPayload("whatsapp.message.received");
    expect(testEventMode("whatsapp.message.received")).toBe("simulation");
    for (const type of ["mail.received", "sms.received", "social.message.received", "payment.completed"]) {
      expect(testEventMode(type), type).toBe("simulation");
    }
    for (const type of ["manual.test", "quote.requested", "custom.richiesta"]) {
      expect(testEventMode(type), type).toBe("event");
    }
    // The database refuses the real event the page used to insert…
    await expect(
      webInsert(
        "events",
        buildTestEvent({ organizationId: h.orgId, type: "whatsapp.message.received", payload, id: "finto" }),
      ),
    ).rejects.toThrow(/row-level security/);
    // …and the page asks for a simulation over the same content instead.
    const jobId = await webRequestJob(simulateSampleJob(versionId, payload));
    await work();

    expect(await job(jobId)).toMatchObject({ status: "done", last_error: null });
    const run = await h.one("select mode, status, event_id, context from ia_connect.flow_runs");
    expect(run).toMatchObject({ mode: "simulation", status: "completed", event_id: null });
    expect(run.context.event.payload.from).toBe(payload.from);
    const step = await h.one("select status, output from ia_connect.flow_run_steps");
    expect(step.status).toBe("simulated");
    // Nobody was created, no conversation was opened, no message left the platform.
    expect(await h.all("select 1 from ia_connect.contacts")).toHaveLength(0);
    expect(await h.all("select 1 from ia_connect.conversations")).toHaveLength(0);
    expect(await h.all("select 1 from ia_connect.messages")).toHaveLength(0);
    expect(await h.all("select 1 from ia_connect.events")).toHaveLength(0);
    expect(h.calls).toEqual([]);
  });

  it("says before inserting why the worker would ignore a test event", async () => {
    await setup();
    // What the page used to propose for every type: no sender.
    const old = { subject: "Richiesta di preventivo", text: "Buongiorno, vorrei un preventivo." };
    expect(testEventProblem("mail.received", old)).toContain("from");
    expect(testEventProblem("manual.test", old)).toBeNull();
    await h.addFlow({
      trigger: { event: "mail.received", filters: [] },
      steps: [{ id: "note", block: "human.notify_owner", params: { message: "x" } }],
    });
    // As the mail connector would store it.
    const eventId = await h.addEvent("mail.received", old);
    await work();
    // This is the worker behaviour the check above protects from.
    expect((await h.one("select status from ia_connect.events where id = $1", [eventId])).status).toBe(
      "ignored",
    );
    expect(await h.all("select 1 from ia_connect.flow_runs")).toHaveLength(0);
  });

  it("has a sample with a sender for every inbound message event, and copies no foreign connection", () => {
    for (const type of [
      "mail.received",
      "whatsapp.message.received",
      "sms.received",
      "social.message.received",
    ]) {
      expect(testEventProblem(type, sampleEventPayload(type))).toBeNull();
    }
    const trigger = {
      event: "order.created",
      connection: "7d69efad-b09f-49ea-abf0-d32e5fd51c76",
      filters: [],
    };
    const base = { organizationId: "org", payload: {}, trigger, id: "x" };
    expect(buildTestEvent({ ...base, type: "order.created", connectionIds: [] }).connection_id).toBeNull();
    expect(
      buildTestEvent({ ...base, type: "manual.test", connectionIds: [trigger.connection] }).connection_id,
    ).toBeNull();
  });

  it("a message template installed with a flow is found by name, and sent only once approved", async () => {
    await setup();
    const plan = planTemplateInstall(
      {
        messageTemplates: [{ channel: "whatsapp", name: "benvenuto", body: "Buongiorno {{1}}" }],
        connections: [],
        contactFields: [],
        stages: [],
        dealFields: [],
      },
      { templates: [], connections: [] },
    );
    // What `installTemplate` inserts for each missing template.
    for (const wanted of plan.templatesToCreate) {
      await webInsert("message_templates", {
        organization_id: h.orgId,
        channel: wanted.channel,
        name: wanted.name,
        body: wanted.body,
        approval_status: "draft",
      });
    }
    await addContact({ whatsapp: GRANTED });
    await h.addFlow({
      trigger: { event: "manual.test", filters: [] },
      steps: [
        { id: "contact", block: "contact.upsert", params: { phone: PHONE } },
        {
          id: "send",
          block: "whatsapp.send_template",
          params: { template: "benvenuto", variables: { "1": "Maria" } },
        },
      ],
    });
    await h.addEvent("manual.test", {});
    await work();
    expect((await h.one("select status, error from ia_connect.flow_runs")).error).toContain(
      "non è ancora approvato",
    );
    expect(h.calls).toHaveLength(0);

    // The settings page after Meta's approval: status, Meta's name, language.
    await h.db.asUser(
      owner,
      `update ia_connect.message_templates set approval_status = 'approved', external_name = 'benvenuto_it', language = $2
       where organization_id = $1 and name = 'benvenuto'`,
      [h.orgId, normalizeTemplateLanguage("IT")],
    );
    await h.addEvent("manual.test", {});
    await work();
    expect(h.calls).toEqual([
      {
        connector: "whatsapp_meta",
        action: "sendTemplate",
        input: {
          to: PHONE,
          template: "benvenuto_it",
          language: "it",
          variables: ["Maria"],
          renderedText: "Buongiorno Maria",
        },
      },
    ]);
  });

  it("the activation checks warn about the ambiguity the worker refuses to resolve", async () => {
    await setup();
    await h.sql.query(
      "insert into ia_connect.connections (organization_id, connector_type, name) values ($1, 'whatsapp_meta', 'Secondo numero')",
      [h.orgId],
    );
    const definition = {
      trigger: { event: "manual.test", filters: [] },
      steps: [
        {
          id: "contact",
          block: "contact.upsert",
          params: { phone: PHONE, consent: { channel: "whatsapp", source: "x" } },
        },
        {
          id: "send",
          block: "whatsapp.send_template",
          params: { template: "benvenuto", variables: { "1": "Maria" } },
        },
      ],
    };
    await h.addTemplate("benvenuto", "Buongiorno {{1}}");
    // The context the web builds from the same rows the worker reads.
    const context = buildValidationContext({
      connections: await h.all(
        "select id, connector_type, status from ia_connect.connections where organization_id = $1",
        [h.orgId],
      ),
      connectorTypes: await h.all("select key, category from ia_connect.connector_types"),
      templates: await h.all("select name, channel, approval_status from ia_connect.message_templates"),
      stages: await h.all("select key from ia_connect.deal_stages where organization_id = $1", [h.orgId]),
      limits: null,
      activeFlows: 0,
      aiCreditsLeft: null,
    });
    const result = validateFlow(definition, context);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([
      expect.objectContaining({ level: "warning", code: "connection_ambiguous", stepId: "send" }),
    ]);

    await h.addFlow(definition);
    await h.addEvent("manual.test", {});
    await work();
    expect((await h.one("select error from ia_connect.flow_runs")).error).toContain(
      "più collegamenti attivi",
    );

    // Naming the connection in the step settles it on both sides.
    const named = structuredClone(definition);
    Object.assign(named.steps[1]!.params, { connection: h.connections.whatsapp });
    expect(validateFlow(named, context).issues).toEqual([]);
  });

  it("keeps the language codes Meta accepts", () => {
    expect(normalizeTemplateLanguage("it")).toBe("it");
    expect(normalizeTemplateLanguage("EN_us")).toBe("en_US");
    expect(normalizeTemplateLanguage("pt-br")).toBe("pt_BR");
    expect(normalizeTemplateLanguage("italiano")).toBeNull();
  });
});

// ── 5. Runs and simulation: what the worker writes is what the web renders ──

const ALL_BLOCKS_FLOW = {
  trigger: { event: "quote.requested", filters: [] },
  steps: [
    {
      id: "extract",
      block: "ai.extract",
      params: { text: "{{event.payload.product}}", fields: [{ name: "name" }, { name: "phone" }] },
    },
    {
      id: "classify",
      block: "ai.classify",
      params: { text: "{{event.payload.product}}", categories: [{ key: "preventivo" }, { key: "altro" }] },
    },
    { id: "summarize", block: "ai.summarize", params: { text: "{{event.payload.product}}" } },
    {
      id: "contact",
      block: "contact.upsert",
      params: {
        name: "{{event.payload.name}}",
        phone: "{{event.payload.phone}}",
        email: "{{event.payload.email}}",
        fields: { prodotto: "{{event.payload.product}}" },
        consent: { channel: "whatsapp", source: "Richiesta di preventivo" },
      },
    },
    {
      id: "cond",
      block: "logic.condition",
      params: { left: "{{event.payload.product}}", operator: "contains", right: "auto" },
    },
    {
      id: "choose",
      block: "logic.switch",
      params: {
        value: "{{steps.classify.output.category}}",
        cases: [{ equals: "preventivo", goto: "wa_template" }],
      },
    },
    {
      id: "wa_template",
      block: "whatsapp.send_template",
      params: {
        template: "preventivo",
        variables: { "1": "{{contact.full_name}}", "2": "{{event.payload.product}}" },
      },
    },
    { id: "wa_text", block: "whatsapp.send_text", params: { text: "Buongiorno {{contact.full_name}}" } },
    {
      id: "mail",
      block: "mail.send",
      params: {
        subject: "Il suo preventivo {{event.payload.product}}",
        body: "Gentile {{contact.full_name}}, ecco il preventivo.",
      },
    },
    { id: "sms", block: "sms.send", params: { text: "Preventivo pronto" } },
    { id: "social", block: "social.send_message", params: { text: "Le abbiamo scritto in privato" } },
    {
      id: "post",
      block: "social.publish_post",
      params: { text: "Nuova offerta RC auto", mediaUrl: "https://www.example.com/offerta.jpg" },
    },
    {
      id: "deal",
      block: "deal.create",
      params: {
        title: "Preventivo {{event.payload.product}} · {{contact.full_name}}",
        stage: "new",
        value: "1.250,50",
        nextAction: "Richiamare",
        fields: { targa: "AB123CD" },
      },
    },
    { id: "stage", block: "deal.update_stage", params: { stage: "quote_sent" } },
    {
      id: "crm_read",
      block: "crm.read",
      params: { resource: "customers", query: { phone: "{{contact.phone}}" } },
    },
    {
      id: "crm_write",
      block: "crm.write",
      params: {
        resource: "quotes",
        data: { name: "{{contact.full_name}}", product: "{{event.payload.product}}" },
      },
    },
    {
      id: "find",
      block: "contact.find_matching",
      params: { rules: [{ field: "zona", operator: "exists" }] },
    },
    {
      id: "each",
      block: "logic.for_each",
      params: { items: "{{event.payload.details.targhe}}", emitEvent: "custom.targa" },
    },
    { id: "pause", block: "wait.delay", params: { duration: "2d" } },
    { id: "wait", block: "wait.for_reply", params: { timeout: "48h" } },
    { id: "answer", block: "ai.reply", params: { scope: "Domande sul preventivo", maxTurns: 3 } },
    {
      id: "approve",
      block: "human.request_approval",
      params: { summary: "Inviare l'offerta a {{contact.full_name}}?" },
    },
    { id: "slots", block: "calendar.find_slots", params: { max: 2 } },
    {
      id: "event",
      block: "calendar.create_event",
      params: {
        title: "Appuntamento con {{contact.full_name}}",
        start: "{{steps.slots.output.slots[0].start}}",
        end: "{{steps.slots.output.slots[0].end}}",
        location: "In agenzia",
      },
    },
    { id: "pay", block: "payment.request", params: { amount: "120,50", description: "Acconto polizza" } },
    {
      id: "sign",
      block: "signature.request",
      params: { documentUrl: "https://www.example.com/contratto.pdf", title: "Contratto RC auto" },
    },
    {
      id: "notify",
      block: "human.notify_owner",
      params: { message: "Nuovo preventivo da seguire", via: "whatsapp" },
    },
    { id: "handoff", block: "human.handoff", params: { note: "Il cliente vuole parlare con una persona" } },
  ],
};

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** The step rows as the web's run pages select them, with ids made stable. */
async function capturedSteps(runId: string): Promise<string> {
  const rows = await h.all(
    `select step_id, block, status, outlet, input, output, error, ai_cost_micros
     from ia_connect.flow_run_steps where flow_run_id = $1 order by created_at`,
    [runId],
  );
  const steps = rows.map((row) => ({ ...row, ai_cost_micros: Number(row.ai_cost_micros), duration_ms: 0 }));
  return `${JSON.stringify(steps, null, 2).replace(UUID_ANYWHERE, "00000000-0000-4000-8000-000000000000")}\n`;
}

describe("run steps", () => {
  it("simulation requested from the web: every block of the catalog leaves a step the web can read", async () => {
    await setup();
    h.deps.now = () => FIXED_NOW;
    expect(ALL_BLOCKS_FLOW.steps.map((step) => step.block).sort()).toEqual(
      listBlocks()
        .map((block) => block.key)
        .sort(),
    );
    await h.addTemplate("preventivo", "Buongiorno {{1}}, ecco il preventivo {{2}}.");
    const { flowId, versionId } = await h.addFlow(ALL_BLOCKS_FLOW, { status: "draft" });

    // A test event on a flow that is not active: stored, starts nothing, feeds the simulation.
    const payload = { ...sampleEventPayload("quote.requested"), details: { targhe: ["AB123CD", "EF456GH"] } };
    const eventId = await webInsert(
      "events",
      buildTestEvent({ organizationId: h.orgId, type: "quote.requested", payload, id: "simulazione" }),
    );
    await work();
    expect((await h.one("select status from ia_connect.events where id = $1", [eventId])).status).toBe(
      "ignored",
    );

    const jobId = await webRequestJob(simulateFlowJob(versionId, FIXED_NOW), FIXED_NOW);
    await work();
    expect(await job(jobId)).toMatchObject({ status: "done", last_error: null });

    // What the simulation tab reads: runs of that version in simulation mode.
    const run = await h.one(
      "select id, status, error, event_id, flow_id from ia_connect.flow_runs where flow_version_id = $1 and mode = 'simulation'",
      [versionId],
    );
    expect(run).toMatchObject({ status: "completed", error: null, event_id: eventId, flow_id: flowId });
    // Nothing left the platform and no customer data was written.
    expect(h.calls).toHaveLength(0);
    for (const table of ["contacts", "deals", "messages", "approvals", "notifications", "appointments"]) {
      expect(await h.all(`select 1 from ia_connect.${table}`), table).toHaveLength(0);
    }
    await expect(await capturedSteps(run.id)).toMatchFileSnapshot(`${FIXTURES}/simulated-steps.json`);
  });

  it("live run: the same blocks, really executed", async () => {
    await setup();
    h.deps.now = () => FIXED_NOW;
    await h.addTemplate("preventivo", "Buongiorno {{1}}, ecco il preventivo {{2}}.");
    await h.sql.query("update ia_connect.org_settings set brand = $2::jsonb where organization_id = $1", [
      h.orgId,
      JSON.stringify({ ownerPhone: "+393480000000" }),
    ]);
    // Without the waits (a live run would stop there) and without the sends that need a consent nobody gave.
    const skipped = new Set(["pause", "wait", "answer", "approve", "wa_text", "mail", "sms", "social"]);
    const steps = ALL_BLOCKS_FLOW.steps.filter((step) => !skipped.has(step.id));
    await h.addFlow({ ...ALL_BLOCKS_FLOW, steps });
    const payload = { ...sampleEventPayload("quote.requested"), details: { targhe: ["AB123CD", "EF456GH"] } };
    await webInsert(
      "events",
      buildTestEvent({ organizationId: h.orgId, type: "quote.requested", payload, id: "vera" }),
    );
    await work();
    const run = await h.one("select id, status, error from ia_connect.flow_runs where mode = 'live'");
    expect(run).toMatchObject({ status: "completed", error: null });
    await expect(await capturedSteps(run.id)).toMatchFileSnapshot(`${FIXTURES}/live-steps.json`);
  });

  it("a deal created straight into a closing stage is closed, as when it is created by hand", async () => {
    await setup();
    await h.addFlow({
      trigger: { event: "manual.test", filters: [] },
      steps: [
        { id: "contact", block: "contact.upsert", params: { phone: PHONE } },
        { id: "won", block: "deal.create", params: { title: "Venduto", stage: "won" } },
        { id: "open", block: "deal.create", params: { title: "Aperta", stage: "new" } },
      ],
    });
    await h.addEvent("manual.test", {});
    await work();
    const deals = await h.all("select title, closed_at from ia_connect.deals order by title");
    expect(deals.map((deal) => [deal.title, deal.closed_at !== null])).toEqual([
      ["Aperta", false],
      ["Venduto", true],
    ]);
  });
});

// ── 6. Connections ────────────────────────────────────────────────────

describe("connections", () => {
  it("a reconnect from the web keeps the polling cursor the worker stored", async () => {
    await setup();
    const seen: unknown[] = [];
    const gmail = h.deps.connectors.get("gmail")!;
    gmail.poll = async (_context, cursor) => {
      seen.push(cursor ?? null);
      return {
        events: [],
        cursor: { lastUid: Number((cursor as { lastUid?: number } | undefined)?.lastUid ?? 0) + 1 },
      };
    };
    const id = h.connections.mail!;
    await h.sql.query(
      "update ia_connect.connections set config = $2::jsonb, external_account_id = $3 where id = $1",
      [id, JSON.stringify({ email: "info@agenzia.it" }), "info@agenzia.it"],
    );
    await h.addJob("poll_connection", { connection_id: id });
    await work();
    const stored = (await h.one("select config from ia_connect.connections where id = $1", [id])).config;
    expect(stored).toEqual({ email: "info@agenzia.it", cursor: { lastUid: 1 } });

    // `saveConnection` on reconnect: what `connect` returned, sanitized, merged with the stored row.
    const fresh = sanitizeConfig(
      { email: "info@agenzia.it", accessToken: "never-in-config" },
      { accessToken: "x" },
    );
    const merged = mergeReconnectConfig(stored, fresh, { sameAccount: true });
    expect(merged).toEqual({ email: "info@agenzia.it", cursor: { lastUid: 1 } });
    // Written by the web server with the service role, on behalf of the signed-in manager.
    await h.sql.query("select ia_connect.save_connection($1, $2, $3, $4::jsonb)", [
      owner,
      h.orgId,
      id,
      JSON.stringify({ config: merged, status: "active", last_error: null }),
    ]);
    h.advance(10 * 60_000);
    await h.sql.query(
      "update ia_connect.scheduled_jobs set run_at = now() - interval '1 minute' where kind = 'poll_connection'",
    );
    await work();
    expect(seen).toEqual([null, { lastUid: 1 }]);

    // Another account: the old cursor would point nowhere.
    expect(mergeReconnectConfig(stored, { email: "altro@agenzia.it" }, { sameAccount: false })).toEqual({
      email: "altro@agenzia.it",
    });
    // Platform entries survive, and a value `connect` returns wins over the stored one.
    expect(
      mergeReconnectConfig(
        { accountSid: "AC1", statusCallbackUrl: "https://x/c/tok", pollIntervalMinutes: 15, stale: true },
        { accountSid: "AC2" },
        { sameAccount: false },
      ),
    ).toEqual({ accountSid: "AC2", statusCallbackUrl: "https://x/c/tok", pollIntervalMinutes: 15 });
  });

  it("hands connectors the same platform variables on both sides", () => {
    // Every variable the connectors read…
    const source = readdirSync(join(HERE, "../../../packages/connectors/src"), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(join(HERE, "../../../packages/connectors/src", file), "utf8"))
      .join("\n");
    const read = new Set(
      [...source.matchAll(/(?:env\.|["'])((?:GOOGLE|MICROSOFT|META|WAWEBAPI|WEBHOOK)_[A-Z0-9_]+)\b/g)].map(
        (match) => match[1]!,
      ),
    );
    expect(read.size).toBeGreaterThan(5);
    // …is passed by the worker (prefix rule)…
    const all = Object.fromEntries([...read].map((name) => [name, "x"]));
    expect(Object.keys(connectorEnv({ ...all, DATABASE_URL: "x", ANTHROPIC_API_KEY: "x" })).sort()).toEqual(
      [...read].sort(),
    );
    // …and by the web server, except the one only the webhook edge function needs.
    const webhookOnly = new Set(["META_WEBHOOK_VERIFY_TOKEN"]);
    expect([...read].filter((name) => !webhookOnly.has(name)).sort()).toEqual([...CONNECTOR_ENV_KEYS].sort());
    // And the web hands over nothing the worker would withhold.
    expect(
      Object.keys(connectorEnv(Object.fromEntries(CONNECTOR_ENV_KEYS.map((key) => [key, "x"])))).sort(),
    ).toEqual([...CONNECTOR_ENV_KEYS].sort());
  });
});

// ── 7. Scraping ───────────────────────────────────────────────────────

const RECIPE: ScrapeRecipe = {
  steps: [
    { action: "goto", url: "https://portale.example/annunci" },
    {
      action: "extract",
      listSelector: ".card",
      fields: {
        title: { selector: ".title", attr: "text", transform: "trim" },
        url: { selector: "a", attr: "href", transform: "absolute_url" },
      },
    },
  ],
  output: {
    eventType: "listing.published",
    keyField: "url",
    fields: [
      { name: "title", type: "string", required: true },
      { name: "url", type: "url", required: true },
    ],
  },
};
const ROW = { title: "Trilocale", url: "https://portale.example/annunci/1" };

function fakeBrowser(works: boolean) {
  return async () =>
    ({
      goto: async () => undefined,
      currentUrl: async () => "https://portale.example/annunci",
      snapshot: async () => "",
      click: async () => undefined,
      fill: async () => undefined,
      waitFor: async () => undefined,
      exists: async () => false,
      extractRows: async (_step: ExtractStep) => (works ? [ROW] : []),
      close: async () => undefined,
    }) satisfies BrowserPort & { close(): Promise<void> };
}

/** What `createRecipe` inserts. */
const webRecipe = () =>
  webInsert("scrape_recipes", {
    organization_id: h.orgId,
    name: "Portale annunci",
    target_url: "https://portale.example/annunci",
    goal: "Leggi i nuovi annunci con titolo e indirizzo.",
    connection_id: null,
    interval_minutes: 60,
    status: "draft",
  });

const traceJobs = () =>
  h.all(
    "select kind, status, created_at::text as created_at from ia_connect.scheduled_jobs where kind = 'scrape_trace'",
  );

describe("scraping", () => {
  it("create → trace → activate → run, with the worker never activating by itself", async () => {
    await setup();
    h.deps.openBrowser = fakeBrowser(true);
    h.deps.tracer = async () => ({ recipe: RECIPE, sampleRows: [ROW], usage: USAGE });
    const recipeId = await webRecipe();
    await webRequestJob(scrapeTraceJob(recipeId));
    expect(traceState(await traceJobs())).toBe("tracing");
    await work();

    expect(traceState(await traceJobs())).toBe("idle");
    const traced = await h.one(
      "select status, active_version_id from ia_connect.scrape_recipes where id = $1",
      [recipeId],
    );
    expect(traced.status).toBe("draft");
    expect(traced.active_version_id).toBeTruthy();
    // Draft: the recurring pass books nothing.
    await ensureRecurringJobs(h.deps);
    expect(await h.all("select 1 from ia_connect.scheduled_jobs where kind = 'scrape_run'")).toHaveLength(0);

    // "Attiva" as the web writes it, then "Esegui ora".
    await h.db.asUser(
      owner,
      "update ia_connect.scrape_recipes set status = 'active', repair_attempts = 0 where id = $1",
      [recipeId],
    );
    const runJob = await webRequestJob(scrapeRunJob(recipeId));
    await work();
    expect(await job(runJob)).toMatchObject({ status: "done" });
    expect(
      await h.one(
        "select status, rows_extracted, new_rows, error, needed_repair from ia_connect.scrape_runs",
      ),
    ).toEqual({ status: "succeeded", rows_extracted: 1, new_rows: 1, error: null, needed_repair: false });
    await ensureRecurringJobs(h.deps);
    expect(
      await h.all("select 1 from ia_connect.scheduled_jobs where dedupe_key = $1", [`scrape:${recipeId}`]),
    ).toHaveLength(1);
  });

  it("a trace that finds no path ends as a failed job, which is what the recipe page reads", async () => {
    await setup();
    h.deps.openBrowser = fakeBrowser(false);
    h.deps.tracer = async () => ({ recipe: RECIPE, sampleRows: [], usage: USAGE });
    const recipeId = await webRecipe();
    const jobId = await webRequestJob(scrapeTraceJob(recipeId));
    await work();

    const failed = await job(jobId);
    expect(failed.status).toBe("failed");
    expect(failed.last_error).toContain("browser appena aperto");
    expect(traceState(await traceJobs())).toBe("failed");
    // Not retried (each attempt costs AI credits) and told once, with a link to the recipe.
    expect(await h.all("select 1 from ia_connect.ai_calls")).toHaveLength(1);
    expect(await h.all("select title, link from ia_connect.notifications")).toEqual([
      { title: "Tracciatura non riuscita", link: `/app/collegamenti/siti/${recipeId}` },
    ]);
    expect(
      (await h.one("select active_version_id from ia_connect.scrape_recipes")).active_version_id,
    ).toBeNull();
  });
});

// ── 8. Notification links ─────────────────────────────────────────────

/** Every page of the web app as a pattern: `[id]` matches one path segment. */
function webRoutes(): RegExp[] {
  const routes: RegExp[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path, /^\(.*\)$/.test(name) ? segments : [...segments, name]);
      } else if (name === "page.tsx") {
        const pattern = segments.map((segment) => (/^\[.+\]$/.test(segment) ? "[^/]+" : segment)).join("/");
        routes.push(new RegExp(`^/${pattern}$`));
      }
    }
  };
  walk(WEB_APP_DIR, []);
  return routes;
}
const isWebRoute = (link: string) => webRoutes().some((route) => route.test(link));

describe("notification links", () => {
  it("every address the worker can write is a page of the web app", () => {
    expect(existsSync(WEB_APP_DIR)).toBe(true);
    const id = "7d69efad-b09f-49ea-abf0-d32e5fd51c76";
    for (const [name, build] of Object.entries(APP_LINKS)) {
      const link = (build as (...ids: string[]) => string)(id, id);
      expect(isWebRoute(link), `${name} → ${link}`).toBe(true);
    }
    // The bug this replaces: the customer area lives under /app.
    expect(isWebRoute("/collegamenti")).toBe(false);
    expect(isWebRoute("/inbox/x")).toBe(false);
    expect(isWebRoute("/report")).toBe(false);
  });

  it("the worker writes links only through APP_LINKS", () => {
    const src = join(HERE, "../src");
    const offenders = readdirSync(src, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) =>
        readFileSync(join(src, file), "utf8")
          .split("\n")
          .filter((line) => /^\s*link:/.test(line) && !/APP_LINKS\./.test(line))
          .map((line) => `${file}: ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });

  it("links written during real scenarios open real pages", async () => {
    await setup({
      ai: { reply: async () => ({ text: "La passo a un collega.", outcome: "handoff", usage: USAGE }) },
    });
    // Approval request, failed flow, handoff, weekly report, expired connection.
    await h.addFlow(APPROVAL_FLOW, { name: "Approvazione" });
    await h.addFlow(
      {
        trigger: { event: "manual.test", filters: [] },
        steps: [{ id: "send", block: "whatsapp.send_text", params: { text: "Ciao" } }],
      },
      { name: "Senza contatto" },
    );
    await h.addFlow(
      {
        trigger: { event: "whatsapp.message.received", filters: [] },
        steps: [{ id: "answer", block: "ai.reply", params: { scope: "Tutto" } }],
      },
      { name: "Risposte" },
    );
    await h.addEvent("manual.test", {});
    await h.addEvent(
      "whatsapp.message.received",
      { from: PHONE, text: "Vorrei parlare con una persona", messageId: "m1" },
      {
        connectionId: h.connections.whatsapp,
      },
    );
    h.deps.connectors.get("sms_twilio")!.verify = async () => ({
      status: "expired",
      message: "Accesso scaduto.",
    });
    await h.addJob("verify_connection", { connection_id: h.connections.sms });
    await h.addJob("report", {});
    await work();

    const notifications = await h.all("select kind, title, link from ia_connect.notifications order by kind");
    expect(notifications.map((item) => item.kind)).toEqual([
      "approval",
      "connection",
      "error",
      "handoff",
      "report",
    ]);
    for (const item of notifications) {
      expect(item.link, item.title).toBeTruthy();
      expect(isWebRoute(item.link), `${item.title} → ${item.link}`).toBe(true);
    }
    const run = await h.one("select id, flow_id from ia_connect.flow_runs where status = 'failed'");
    expect(notifications.find((item) => item.kind === "error")!.link).toBe(
      `/app/flussi/${run.flow_id}/esecuzioni/${run.id}`,
    );
    expect(notifications.find((item) => item.kind === "connection")!.link).toBe(
      `/app/collegamenti/${h.connections.sms}`,
    );
  });
});

// ── 9. AI usage ───────────────────────────────────────────────────────

describe("AI usage written by the web app", () => {
  it("fits the table and adds up with the worker's rows", async () => {
    await setup();
    // A real cost is fractional (cache reads are a fraction of the input price).
    const usage = { model: "claude-test", inputTokens: 1800, outputTokens: 450, costMicros: 6123.75 };
    const columns = aiCallColumns(usage);
    expect(columns).toEqual({
      model: "claude-test",
      input_tokens: 1800,
      output_tokens: 450,
      cost_micros: 6124,
      credits: 3,
    });

    // The flow assistant's row, as the web inserts it (service role)…
    await h.db.asService(
      `insert into ia_connect.ai_calls (organization_id, purpose, model, input_tokens, output_tokens, cost_micros, credits)
       values ($1, 'flow_assistant', $2, $3, $4, $5, $6)`,
      [
        h.orgId,
        columns.model,
        columns.input_tokens,
        columns.output_tokens,
        columns.cost_micros,
        columns.credits,
      ],
    );
    await h.db.asService("select ia_connect.add_usage($1, 'ai_credits', $2)", [h.orgId, columns.credits]);
    // …and without the rounding the insert the web used to do is refused by the bigint column.
    await expect(
      h.db.asService(
        "insert into ia_connect.ai_calls (organization_id, purpose, model, cost_micros) values ($1, 'flow_assistant', 'x', $2)",
        [h.orgId, String(usage.costMicros)],
      ),
    ).rejects.toThrow();
    // The worker, same usage.
    await logAiCall(h.sql, h.orgId, "scrape_trace", usage);

    const rows = await h.all(
      "select purpose, model, input_tokens, output_tokens, cost_micros::int as cost_micros, credits from ia_connect.ai_calls order by purpose",
    );
    expect(rows).toEqual([
      { purpose: "flow_assistant", ...columns },
      { purpose: "scrape_trace", ...columns },
    ]);
    expect(
      await h.one(
        "select value::int as value from ia_connect.usage_counters where organization_id = $1 and metric = 'ai_credits'",
        [h.orgId],
      ),
    ).toEqual({ value: 6 });
  });
});
