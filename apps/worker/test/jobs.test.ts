import { ConnectorError } from "@ia-connect/core";
import { afterEach, describe, expect, it } from "vitest";
import { parseOutboundOverride } from "../src/deps.ts";
import { ensureRecurringJobs } from "../src/ensure.ts";
import { redact } from "../src/log.ts";
import { drain } from "../src/worker.ts";
import { type Harness, PHONE, createHarness } from "./helpers.ts";

let h: Harness;
afterEach(async () => {
  // Tests that need no database leave the previous, already closed one behind.
  await h?.db.close().catch(() => undefined);
});

const USER = "00000000-0000-0000-0000-0000000000aa";

/** A conversation with an operator's queued message, as the web app leaves it. */
async function queuedMessage(
  harness: Harness,
  org: { orgId: string; connections: Record<string, string> },
  options: { consent?: boolean; window?: boolean } = {},
) {
  const contact = await harness.one(
    "insert into ia_connect.contacts (organization_id, full_name, phones, consents) values ($1, 'Mario', array[$2], $3::jsonb) returning id",
    [
      org.orgId,
      PHONE,
      JSON.stringify(
        options.consent === false
          ? {}
          : { whatsapp: { granted: true, at: "2026-01-01T00:00:00Z", source: "Prova" } },
      ),
    ],
  );
  const conversation = await harness.one(
    `insert into ia_connect.conversations (organization_id, contact_id, channel, connection_id, assignee_type, window_expires_at)
     values ($1, $2, 'whatsapp', $3, 'user', $4::timestamptz) returning id`,
    [
      org.orgId,
      contact.id,
      org.connections.whatsapp,
      new Date(harness.deps.now().getTime() + (options.window === false ? -1 : 3_600_000)).toISOString(),
    ],
  );
  const message = await harness.one(
    `insert into ia_connect.messages (organization_id, conversation_id, direction, channel, content, delivery_status, sent_by_user_id)
     values ($1, $2, 'out', 'whatsapp', 'Buongiorno, sono Anna.', 'queued', $3) returning id`,
    [org.orgId, conversation.id, USER],
  );
  return message.id as string;
}

const message = (harness: Harness, id: string) =>
  harness.one("select * from ia_connect.messages where id = $1", [id]);

describe("send_message", () => {
  it("sends an operator's queued message and records the outcome", async () => {
    h = await createHarness();
    const id = await queuedMessage(h, h);
    await h.addJob("send_message", { message_id: id }, { createdBy: USER });
    await drain(h.deps);
    expect(h.calls).toEqual([
      {
        connector: "whatsapp_meta",
        action: "sendText",
        input: { to: PHONE, text: "Buongiorno, sono Anna." },
      },
    ]);
    expect(await message(h, id)).toMatchObject({
      delivery_status: "sent",
      external_id: "ext-1",
      error: null,
    });
    expect((await h.one("select status from ia_connect.scheduled_jobs")).status).toBe("done");
  });

  it("refuses without consent or outside the WhatsApp window, with a reason the operator can read", async () => {
    h = await createHarness();
    const noConsent = await queuedMessage(h, h, { consent: false });
    await h.addJob("send_message", { message_id: noConsent }, { createdBy: USER });
    await drain(h.deps);
    expect(await message(h, noConsent)).toMatchObject({ delivery_status: "failed" });
    expect((await message(h, noConsent)).error).toContain("consenso");

    const other = await h.createOrg("Altra");
    const closed = await queuedMessage(h, other, { window: false });
    await h.addJob("send_message", { message_id: closed }, { orgId: other.orgId, createdBy: USER });
    await drain(h.deps);
    expect((await message(h, closed)).error).toContain("finestra di 24 ore");
    expect(h.calls).toHaveLength(0);
  });
});

describe("untrusted jobs", () => {
  it("cannot touch another organization through the payload", async () => {
    h = await createHarness();
    const victim = await h.createOrg("Vittima");
    const victimMessage = await queuedMessage(h, victim);
    const victimFlow = await h.addFlow(
      {
        trigger: { event: "manual.test", filters: [] },
        steps: [{ id: "n", block: "human.notify_owner", params: { message: "x" } }],
      },
      { orgId: victim.orgId, status: "draft" },
    );
    await h.addEvent("manual.test", {}, { orgId: victim.orgId });
    const recipe = await h.one(
      "insert into ia_connect.scrape_recipes (organization_id, name, target_url, status) values ($1, 'Sito', 'https://example.com', 'active') returning id",
      [victim.orgId],
    );

    // A member of the first organization asks for work on the victim's records.
    await h.addJob("send_message", { message_id: victimMessage }, { createdBy: USER });
    await h.addJob("simulate_flow", { flow_version_id: victimFlow.versionId }, { createdBy: USER });
    await h.addJob("verify_connection", { connection_id: victim.connections.whatsapp }, { createdBy: USER });
    await h.addJob("scrape_run", { recipe_id: recipe.id }, { createdBy: USER });
    await h.addJob("scrape_trace", { recipe_id: recipe.id }, { createdBy: USER });
    await h.addJob("approval_decided", { approval_id: "not-a-uuid'; drop table x" }, { createdBy: USER });
    await drain(h.deps);

    expect(h.calls).toHaveLength(0);
    expect(await message(h, victimMessage)).toMatchObject({ delivery_status: "queued" });
    expect(await h.all("select * from ia_connect.flow_runs")).toHaveLength(0);
    expect(await h.all("select * from ia_connect.scrape_runs")).toHaveLength(0);
    expect(
      (
        await h.one("select last_checked_at from ia_connect.connections where id = $1", [
          victim.connections.whatsapp,
        ])
      ).last_checked_at,
    ).toBeNull();
    expect((await h.all("select status from ia_connect.scheduled_jobs")).map((job) => job.status)).toEqual(
      Array(6).fill("failed"),
    );
    // A refused job is not the organization's problem: no notification.
    expect(await h.all("select * from ia_connect.notifications")).toHaveLength(0);
  });

  it("accepts from users only the kinds the policy allows", async () => {
    h = await createHarness();
    await h.addTemplate("benvenuto", "Ciao {{1}}");
    const { flowId, versionId } = await h.addFlow({
      trigger: { event: "manual.test", filters: [] },
      steps: [
        { id: "wait", block: "wait.delay", params: { duration: "2d" } },
        { id: "n", block: "human.notify_owner", params: { message: "x" } },
      ],
    });
    await h.addEvent("manual.test", {});
    await drain(h.deps);
    const run = await h.one(
      "select * from ia_connect.flow_runs where flow_id = $1 and flow_version_id = $2",
      [flowId, versionId],
    );
    expect(run.status).toBe("waiting");
    // A user tries to skip the wait by forging the system's own job.
    for (const kind of ["resume_run", "wait_timeout", "poll_connection", "report"]) {
      await h.addJob(kind, { run_id: run.id, key: "wait", signal: "timer" }, { createdBy: USER });
    }
    await drain(h.deps);
    expect((await h.one("select status from ia_connect.flow_runs where id = $1", [run.id])).status).toBe(
      "waiting",
    );
    expect(
      await h.all(
        "select * from ia_connect.scheduled_jobs where created_by is not null and status <> 'failed'",
      ),
    ).toHaveLength(0);

    // The system's own job resumes it when the time comes.
    h.advance(2 * 86_400_000 + 1_000);
    await drain(h.deps);
    expect((await h.one("select status from ia_connect.flow_runs where id = $1", [run.id])).status).toBe(
      "completed",
    );
  });
});

describe("approvals", () => {
  const FLOW = {
    trigger: { event: "manual.test", filters: [] },
    steps: [
      {
        id: "ask",
        block: "human.request_approval",
        params: { summary: "Procedere?", timeout: "24h" },
        onApproved: "yes",
        onRejected: "no",
        onTimeout: "late",
      },
      { id: "yes", block: "human.notify_owner", params: { message: "approvato" }, next: "end" },
      { id: "no", block: "human.notify_owner", params: { message: "rifiutato" }, next: "end" },
      { id: "late", block: "human.notify_owner", params: { message: "scaduto" }, next: "end" },
    ],
  };
  const bodies = async () =>
    (await h.all("select body from ia_connect.notifications where kind = 'flow'")).map((row) => row.body);

  it("resumes with the decision read from the database", async () => {
    h = await createHarness();
    await h.addFlow(FLOW);
    await h.addEvent("manual.test", {});
    await h.addEvent("manual.test", {});
    await drain(h.deps);
    const approvals = await h.all("select * from ia_connect.approvals order by created_at");
    expect(approvals.map((item) => item.status)).toEqual(["pending", "pending"]);

    // A job for an undecided approval does nothing, whatever its payload claims.
    await h.addJob(
      "approval_decided",
      { approval_id: approvals[0]!.id, decision: "approved" },
      { createdBy: USER },
    );
    await drain(h.deps);
    expect(await bodies()).toEqual([]);

    await h.sql.query("update ia_connect.approvals set status = 'approved', decided_by = $2 where id = $1", [
      approvals[0]!.id,
      USER,
    ]);
    await h.sql.query("update ia_connect.approvals set status = 'rejected', decided_by = $2 where id = $1", [
      approvals[1]!.id,
      USER,
    ]);
    await h.addJob("approval_decided", { approval_id: approvals[0]!.id }, { createdBy: USER });
    await h.addJob("approval_decided", { approval_id: approvals[1]!.id }, { createdBy: USER });
    await h.addJob("approval_decided", { approval_id: approvals[1]!.id }, { createdBy: USER });
    await drain(h.deps);
    expect(await bodies()).toEqual(["approvato", "rifiutato"]);
    expect((await h.all("select status from ia_connect.flow_runs")).map((run) => run.status)).toEqual([
      "completed",
      "completed",
    ]);
  });

  it("expires and follows onTimeout", async () => {
    h = await createHarness();
    await h.addFlow(FLOW);
    await h.addEvent("manual.test", {});
    await drain(h.deps);
    h.advance(25 * 3_600_000);
    await drain(h.deps);
    expect(await bodies()).toEqual(["scaduto"]);
    expect((await h.one("select status from ia_connect.approvals")).status).toBe("expired");
  });
});

describe("connections", () => {
  it("polls, stores the cursor, inserts only new events and books the next poll", async () => {
    h = await createHarness();
    const gmail = h.deps.connectors.get("gmail")!;
    const cursors: unknown[] = [];
    gmail.poll = async (_context, cursor) => {
      cursors.push(cursor);
      return {
        events: [
          {
            type: "mail.received",
            dedupeKey: "mail-1",
            payload: { from: "mario@example.com", subject: "Info", text: "Buongiorno", messageId: "m1" },
          },
          { type: "not.a.type", dedupeKey: "bad", payload: {} } as never,
        ],
        cursor: { historyId: cursors.length },
      };
    };
    await ensureRecurringJobs(h.deps);
    const kinds = (await h.all("select kind from ia_connect.scheduled_jobs order by kind")).map(
      (job) => job.kind,
    );
    expect(kinds.filter((kind) => kind === "poll_connection")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "verify_connection")).toHaveLength(8);
    expect(kinds.filter((kind) => kind === "report")).toHaveLength(1);

    await drain(h.deps);
    h.advance(6 * 60_000);
    await ensureRecurringJobs(h.deps);
    await drain(h.deps);

    expect(cursors).toEqual([undefined, { historyId: 1 }]);
    expect(
      (await h.one("select config from ia_connect.connections where id = $1", [h.connections.mail])).config,
    ).toEqual({ cursor: { historyId: 2 } });
    const events = await h.all("select type, connection_id, status from ia_connect.events");
    expect(events).toEqual([
      { type: "mail.received", connection_id: h.connections.mail, status: "processed" },
    ]);
    // The inbound mail became a contact and a conversation.
    expect((await h.one("select emails from ia_connect.contacts")).emails).toEqual(["mario@example.com"]);
    expect(
      (await h.one("select status from ia_connect.scheduled_jobs where kind = 'poll_connection'")).status,
    ).toBe("pending");
    expect(
      await h.all("select * from ia_connect.scheduled_jobs where kind = 'poll_connection'"),
    ).toHaveLength(1);
  });

  it("verifies connections, updates their status and notifies when access is lost", async () => {
    h = await createHarness();
    h.deps.connectors.get("whatsapp_meta")!.verify = async () => ({
      status: "expired",
      message: "token scaduto",
    });
    h.deps.connectors.get("gmail")!.verify = async () => {
      throw new ConnectorError("401", { retryable: false });
    };
    await ensureRecurringJobs(h.deps);
    await drain(h.deps);
    const status = async (id: string) =>
      await h.one("select status, last_error, last_checked_at from ia_connect.connections where id = $1", [
        id,
      ]);
    expect(await status(h.connections.whatsapp!)).toMatchObject({
      status: "expired",
      last_error: "token scaduto",
    });
    expect(await status(h.connections.mail!)).toMatchObject({ status: "error" });
    expect((await status(h.connections.crm!)).status).toBe("active");
    expect((await status(h.connections.crm!)).last_checked_at).not.toBeNull();
    const titles = (await h.all("select title from ia_connect.notifications order by title")).map(
      (row) => row.title,
    );
    expect(titles).toEqual(["Collegamento con problemi", "Collegamento scaduto"]);

    // Next day: still broken, but the organization is not told twice.
    h.advance(25 * 3_600_000);
    await drain(h.deps);
    expect(await h.all("select * from ia_connect.notifications")).toHaveLength(2);
  });
});

describe("queue", () => {
  it("fails an event after the last attempt and tells the organization", async () => {
    h = await createHarness({ config: { maxAttempts: 3 } });
    await h.addFlow({
      trigger: { event: "manual.test", filters: [] },
      steps: [{ id: "n", block: "human.notify_owner", params: { message: "x" } }],
    });
    const eventId = await h.addEvent("manual.test", {});
    const real = h.deps.sql;
    // The flow lookup keeps failing: an infrastructure fault, not a step error.
    h.deps.sql = {
      query: (text, params) =>
        text.includes("from ia_connect.flows f")
          ? Promise.reject(new Error("boom"))
          : real.query(text, params),
      transaction: (fn) => real.transaction(fn),
    };
    const seen: number[] = [];
    for (let round = 0; round < 4; round++) {
      seen.push(await drain(h.deps));
      h.advance(3_600_000);
    }
    expect(seen).toEqual([1, 1, 1, 0]);
    expect(
      await h.one("select status, attempts, error from ia_connect.events where id = $1", [eventId]),
    ).toEqual({ status: "failed", attempts: 3, error: "boom" });
    expect((await h.one("select title from ia_connect.notifications")).title).toBe("Evento non elaborato");
  });

  it("books a recovery for a run orphaned by a dead worker", async () => {
    h = await createHarness();
    const { flowId, versionId } = await h.addFlow({
      trigger: { event: "manual.test", filters: [] },
      steps: [{ id: "n", block: "human.notify_owner", params: { message: "ripreso" } }],
    });
    await h.sql.query(
      `insert into ia_connect.flow_runs (organization_id, flow_id, flow_version_id, status, current_step_id, context)
       values ($1, $2, $3, 'running', 'n', '{"event":{"id":null,"type":"manual.test","payload":{}},"steps":{}}')`,
      [h.orgId, flowId, versionId],
    );
    h.advance(10 * 60_000);
    await ensureRecurringJobs(h.deps);
    await drain(h.deps);
    expect((await h.one("select status from ia_connect.flow_runs")).status).toBe("completed");
    expect((await h.one("select body from ia_connect.notifications where kind = 'flow'")).body).toBe(
      "ripreso",
    );
  });

  it("writes the weekly report from plain counts", async () => {
    h = await createHarness();
    await h.addFlow({
      trigger: { event: "manual.test", filters: [] },
      steps: [{ id: "c", block: "contact.upsert", params: { phone: PHONE } }],
    });
    await h.addEvent("manual.test", {});
    await ensureRecurringJobs(h.deps);
    await drain(h.deps);
    await h.sql.query("update ia_connect.scheduled_jobs set run_at = $1::timestamptz where kind = 'report'", [
      h.deps.now().toISOString(),
    ]);
    await drain(h.deps);
    const report = await h.one("select body from ia_connect.notifications where kind = 'report'");
    expect(report.body).toContain("Flussi eseguiti: 1");
    expect(report.body).toContain("Nuovi contatti: 1");
    expect((await h.one("select status from ia_connect.scheduled_jobs where kind = 'report'")).status).toBe(
      "pending",
    );
  });
});

describe("configuration", () => {
  it("redacts secrets and message bodies from logs", () => {
    expect(
      redact({
        runId: "r1",
        text: "ciao",
        nested: { accessToken: "abc", api_key: "k", count: 2 },
        payload: { a: 1 },
      }),
    ).toEqual({
      runId: "r1",
      text: "[redacted]",
      nested: { accessToken: "[redacted]", api_key: "[redacted]", count: 2 },
      payload: "[redacted]",
    });
  });

  it("parses the outbound safety switch", () => {
    expect(parseOutboundOverride({})).toBeUndefined();
    expect(parseOutboundOverride({ WHATSAPP_TEST_RECIPIENT: "+39333" })).toEqual({
      whatsapp: "+39333",
      sms: undefined,
      mail: undefined,
      blockOthers: false,
    });
    expect(parseOutboundOverride({ OUTBOUND_OVERRIDE_RECIPIENT: "+39111, test@example.com" })).toEqual({
      whatsapp: "+39111",
      sms: "+39111",
      mail: "test@example.com",
      blockOthers: true,
    });
  });
});
