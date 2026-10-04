import { ConnectorError, listBlocks } from "@ia-connect/core";
import { afterEach, describe, expect, it } from "vitest";
import { EXECUTORS } from "../src/engine/blocks/index.ts";
import { executeRun } from "../src/engine/engine.ts";
import { drain } from "../src/worker.ts";
import { type Harness, PHASE0_FLOW, PHONE, createHarness } from "./helpers.ts";

let h: Harness;
afterEach(async () => {
  // Tests that need no database leave the previous, already closed one behind.
  await h?.db.close().catch(() => undefined);
});

const runs = (harness: Harness) => harness.all("select * from ia_connect.flow_runs order by created_at");
const steps = (harness: Harness, runId: string) =>
  harness.all("select * from ia_connect.flow_run_steps where flow_run_id = $1 order by created_at", [runId]);

describe("catalog", () => {
  it("has an executor for every block", () => {
    const missing = listBlocks().filter((block) => !EXECUTORS[block.key]);
    expect(missing.map((block) => block.key)).toEqual([]);
    expect(Object.keys(EXECUTORS).sort()).toEqual(
      listBlocks()
        .map((block) => block.key)
        .sort(),
    );
  });
});

describe("phase 0", () => {
  it("runs a manual event through a flow: sends a WhatsApp template and creates a deal", async () => {
    h = await createHarness();
    await h.addTemplate(
      "benvenuto",
      "Buongiorno {{1}}, grazie per la richiesta. Questo è un messaggio automatico.",
    );
    await h.addFlow(PHASE0_FLOW);
    const eventId = await h.addEvent("manual.test", { name: "Mario Rossi", phone: "333 123 4567" });
    await drain(h.deps);

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({
      connector: "whatsapp_meta",
      action: "sendTemplate",
      input: { to: PHONE, template: "benvenuto", variables: ["Mario Rossi"] },
    });
    const [run] = await runs(h);
    expect(run).toMatchObject({ status: "completed", mode: "live", event_id: eventId });
    expect((await steps(h, run.id)).map((step) => [step.idempotency_key, step.status])).toEqual([
      ["contact", "succeeded"],
      ["send", "succeeded"],
      ["deal", "succeeded"],
    ]);
    const deal = await h.one(
      "select d.*, s.key as stage from ia_connect.deals d join ia_connect.deal_stages s on s.id = d.stage_id",
    );
    expect(deal).toMatchObject({
      title: "Richiesta di Mario Rossi",
      stage: "new",
      origin_flow_run_id: run.id,
    });
    expect(Number(deal.estimated_value_cents)).toBe(125050);
    const message = await h.one("select * from ia_connect.messages");
    expect(message).toMatchObject({
      direction: "out",
      flow_run_id: run.id,
      external_id: "ext-1",
      delivery_status: "sent",
    });
    expect(message.content).toContain("Buongiorno Mario Rossi");
    expect((await h.one("select status from ia_connect.events where id = $1", [eventId])).status).toBe(
      "processed",
    );
    const usage = await h.all(
      "select metric, value::int as value from ia_connect.usage_counters order by metric",
    );
    expect(usage).toEqual([
      { metric: "flow_runs", value: 1 },
      { metric: "messages", value: 1 },
    ]);
  });

  it("does not duplicate anything when the same event is delivered again", async () => {
    h = await createHarness();
    await h.addTemplate("benvenuto", "Ciao {{1}}");
    await h.addFlow(PHASE0_FLOW);
    const eventId = await h.addEvent(
      "manual.test",
      { name: "Mario Rossi", phone: PHONE },
      { dedupeKey: "same" },
    );
    await drain(h.deps);
    await h.sql.query("update ia_connect.events set status = 'pending' where id = $1", [eventId]);
    await drain(h.deps);
    await expect(
      h.addEvent("manual.test", { name: "Mario Rossi", phone: PHONE }, { dedupeKey: "same" }),
    ).rejects.toThrow();

    expect(h.calls).toHaveLength(1);
    expect(await runs(h)).toHaveLength(1);
    expect((await h.one("select count(*)::int as n from ia_connect.deals")).n).toBe(1);
    expect((await h.one("select count(*)::int as n from ia_connect.contacts")).n).toBe(1);
    expect(
      (await h.one("select value::int as value from ia_connect.usage_counters where metric = 'flow_runs'"))
        .value,
    ).toBe(1);
  });

  it("ignores events of a suspended organization", async () => {
    h = await createHarness();
    await h.addTemplate("benvenuto", "Ciao {{1}}");
    await h.addFlow(PHASE0_FLOW);
    await h.sql.query("update ia_connect.organizations set status = 'suspended' where id = $1", [h.orgId]);
    const eventId = await h.addEvent("manual.test", { name: "Mario", phone: PHONE });
    await drain(h.deps);
    expect(h.calls).toHaveLength(0);
    expect(await runs(h)).toHaveLength(0);
    expect((await h.one("select status from ia_connect.events where id = $1", [eventId])).status).toBe(
      "ignored",
    );
  });
});

describe("crash and resume", () => {
  it("resumes after a crash without repeating completed steps", async () => {
    h = await createHarness();
    await h.addTemplate("benvenuto", "Ciao {{1}}");
    await h.addFlow(PHASE0_FLOW);
    await h.addEvent("manual.test", { name: "Mario Rossi", phone: PHONE });

    // The "process" dies when the third step starts: from then on no query succeeds.
    const real = h.deps.sql;
    let dead = false;
    const dying = (sql: typeof real): typeof real => ({
      async query(text, params) {
        if (text.includes("insert into ia_connect.deals")) dead = true;
        if (dead) throw new Error("connection lost");
        return sql.query(text, params);
      },
      transaction: (fn) => sql.transaction((tx) => fn(dying(tx))),
    });
    h.deps.sql = dying(real);
    await expect(drain(h.deps)).rejects.toThrow("connection lost");
    h.deps.sql = real;

    expect(h.calls).toHaveLength(1);
    let [run] = await runs(h);
    expect(run).toMatchObject({ status: "running", current_step_id: "deal" });
    expect((await h.one("select count(*)::int as n from ia_connect.deals")).n).toBe(0);

    // Nothing happens while the dead worker's lease is still valid.
    expect(await drain(h.deps)).toBe(0);
    h.advance(h.deps.config.lockMs + 1_000);
    await drain(h.deps);

    [run] = await runs(h);
    expect(run.status).toBe("completed");
    expect(h.calls).toHaveLength(1);
    expect((await h.one("select count(*)::int as n from ia_connect.deals")).n).toBe(1);
    expect((await h.one("select count(*)::int as n from ia_connect.contacts")).n).toBe(1);
    expect((await h.one("select count(*)::int as n from ia_connect.messages")).n).toBe(1);
    expect(await steps(h, run.id)).toHaveLength(3);
  });

  it("reuses a finished step instead of executing it again", async () => {
    h = await createHarness();
    await h.addTemplate("benvenuto", "Ciao {{1}}");
    await h.addFlow(PHASE0_FLOW);
    await h.addEvent("manual.test", { name: "Mario Rossi", phone: PHONE });
    await drain(h.deps);
    const [run] = await runs(h);
    // As if the run were still pointing at a step whose row is already finished.
    await h.sql.query(
      "update ia_connect.flow_runs set status = 'running', current_step_id = 'deal', finished_at = null where id = $1",
      [run.id],
    );
    await executeRun(h.deps, run.id);
    expect(h.calls).toHaveLength(1);
    expect((await h.one("select count(*)::int as n from ia_connect.deals")).n).toBe(1);
    expect((await runs(h))[0].status).toBe("completed");
  });

  it("never repeats an external step whose outcome is unknown", async () => {
    let dead = false;
    h = await createHarness({
      before: () => {
        // The message leaves, then the worker dies before recording it.
        dead = true;
      },
    });
    await h.addTemplate("benvenuto", "Ciao {{1}}");
    await h.addFlow(PHASE0_FLOW);
    await h.addEvent("manual.test", { name: "Mario Rossi", phone: PHONE });
    const real = h.deps.sql;
    const dying = (sql: typeof real): typeof real => ({
      async query(text, params) {
        if (dead) throw new Error("connection lost");
        return sql.query(text, params);
      },
      transaction: (fn) => sql.transaction((tx) => fn(dying(tx))),
    });
    h.deps.sql = dying(real);
    await expect(drain(h.deps)).rejects.toThrow("connection lost");
    h.deps.sql = real;
    dead = false;
    expect(h.calls).toHaveLength(1);

    h.advance(h.deps.config.lockMs + 1_000);
    await drain(h.deps);
    const [run] = await runs(h);
    expect(run.status).toBe("failed");
    expect(run.error).toContain("esito non è certo");
    expect(h.calls).toHaveLength(1);
    expect((await h.one("select count(*)::int as n from ia_connect.deals")).n).toBe(0);
    const notification = await h.one("select * from ia_connect.notifications");
    expect(notification.title).toBe("Flusso non completato");
  });

  it("retries a retryable connector error with backoff, then gives up and notifies", async () => {
    let failures = 2;
    h = await createHarness({
      before: () => {
        if (failures-- > 0)
          throw new ConnectorError("Servizio momentaneamente non disponibile.", { retryable: true });
      },
    });
    await h.addTemplate("benvenuto", "Ciao {{1}}");
    await h.addFlow(PHASE0_FLOW);
    await h.addEvent("manual.test", { name: "Mario Rossi", phone: PHONE });
    await drain(h.deps);
    let [run] = await runs(h);
    expect(run).toMatchObject({ status: "waiting", waiting_for: "timer", attempts: 1 });
    expect(await drain(h.deps)).toBe(0);
    h.advance(31_000);
    await drain(h.deps);
    expect((await runs(h))[0]).toMatchObject({ status: "waiting", attempts: 2 });
    h.advance(61_000);
    await drain(h.deps);
    [run] = await runs(h);
    expect(run.status).toBe("completed");
    expect(h.calls).toHaveLength(1);
    // Failed attempts gave their message back to the quota.
    expect(
      (await h.one("select value::int as value from ia_connect.usage_counters where metric = 'messages'"))
        .value,
    ).toBe(1);

    // A second run that never succeeds fails after the cap.
    failures = 99;
    await h.addEvent("manual.test", { name: "Luca Bianchi", phone: "+393339999999" });
    for (let round = 0; round < 6; round++) {
      await drain(h.deps);
      h.advance(3_600_000);
    }
    const failed = (await runs(h))[1];
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("non disponibile");
    expect(h.calls).toHaveLength(1);
    expect(
      (await h.all("select * from ia_connect.notifications where title = 'Flusso non completato'")).length,
    ).toBe(1);
  });
});

describe("sending rules", () => {
  it("refuses to send without the contact's consent", async () => {
    h = await createHarness();
    await h.addTemplate("benvenuto", "Ciao {{1}}");
    const flow = structuredClone(PHASE0_FLOW);
    delete (flow.steps[0]!.params as Record<string, unknown>).consent;
    await h.addFlow(flow);
    await h.addEvent("manual.test", { name: "Mario Rossi", phone: PHONE });
    await drain(h.deps);
    const [run] = await runs(h);
    expect(run.status).toBe("failed");
    expect(run.error).toContain("consenso");
    expect(h.calls).toHaveLength(0);
    expect((await h.one("select count(*)::int as n from ia_connect.messages")).n).toBe(0);
    expect((await h.one("select body from ia_connect.notifications")).body).toContain("consenso");
  });

  it("refuses to send when the monthly message quota is used up", async () => {
    h = await createHarness();
    const other = await h.createOrg("Senza quota", { messages_per_month: 1 });
    await h.addTemplate("benvenuto", "Ciao {{1}}", other.orgId);
    await h.addFlow(PHASE0_FLOW, { orgId: other.orgId });
    await h.addEvent("manual.test", { name: "Uno", phone: "+393330000001" }, { orgId: other.orgId });
    await h.addEvent("manual.test", { name: "Due", phone: "+393330000002" }, { orgId: other.orgId });
    await drain(h.deps);
    const [first, second] = await runs(h);
    expect(first.status).toBe("completed");
    expect(second.status).toBe("failed");
    expect(second.error).toContain("esauriti");
    expect(h.calls).toHaveLength(1);
  });

  it("refuses an AI step when the AI credits are used up, and meters the ones that run", async () => {
    h = await createHarness();
    const flow = {
      trigger: { event: "manual.test", filters: [] },
      steps: [
        {
          id: "extract",
          block: "ai.extract",
          params: { text: "{{event.payload.text}}", fields: [{ name: "name" }] },
        },
        { id: "sum", block: "ai.summarize", params: { text: "{{event.payload.text}}" } },
      ],
    };
    const poor = await h.createOrg("Pochi crediti", { ai_credits_per_month: 2 });
    await h.addFlow(flow, { orgId: poor.orgId });
    await h.addEvent("manual.test", { text: "Sono Mario Rossi" }, { orgId: poor.orgId });
    await drain(h.deps);
    const [run] = await runs(h);
    // The first call costs 2 credits (1500 tokens) and uses the quota up; the second is refused.
    expect(run.status).toBe("failed");
    expect(run.error).toContain("crediti IA");
    const calls = await h.all("select * from ia_connect.ai_calls");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      purpose: "ai.extract",
      model: "fake-model",
      credits: 2,
      flow_run_id: run.id,
    });
    const [step] = await steps(h, run.id);
    expect(calls[0].flow_run_step_id).toBe(step.id);
    expect(Number(step.ai_cost_micros)).toBe(4200);
    expect(step.output).toMatchObject({ data: { name: "Mario Rossi" } });
  });

  it("allows free WhatsApp text only while the 24-hour window is open", async () => {
    h = await createHarness();
    await h.addFlow({
      trigger: { event: "manual.test", filters: [] },
      steps: [
        {
          id: "contact",
          block: "contact.upsert",
          params: { phone: PHONE, consent: { channel: "whatsapp", source: "Prova" } },
        },
        {
          id: "text",
          block: "whatsapp.send_text",
          params: { text: "Buongiorno, la informiamo che la pratica è pronta." },
        },
      ],
    });
    // Never wrote to us: no window.
    await h.addEvent("manual.test", {});
    await drain(h.deps);
    expect((await runs(h))[0].error).toContain("finestra di 24 ore");
    expect(h.calls).toHaveLength(0);

    // The contact writes: the window opens for 24 hours.
    await h.addEvent(
      "whatsapp.message.received",
      { from: PHONE, text: "Salve", messageId: "wamid.1" },
      { connectionId: h.connections.whatsapp },
    );
    await h.addEvent("manual.test", {});
    await drain(h.deps);
    expect((await runs(h))[1].status).toBe("completed");
    expect(h.calls).toHaveLength(1);
    // First automatic message of the conversation: the notice is added.
    expect(h.calls[0]!.input.text).toBe(
      "Buongiorno, la informiamo che la pratica è pronta.\n\nQuesto è un messaggio automatico.",
    );

    h.advance(25 * 3_600_000);
    await h.addEvent("manual.test", {});
    await drain(h.deps);
    expect((await runs(h))[2].error).toContain("finestra di 24 ore");
    expect(h.calls).toHaveLength(1);
  });

  it("sends every message to the test recipient when the safety switch is set", async () => {
    h = await createHarness({
      config: { outboundOverride: { whatsapp: "+390000000000", sms: "+390000000000", blockOthers: true } },
    });
    await h.addTemplate("benvenuto", "Ciao {{1}}");
    await h.addFlow({
      ...PHASE0_FLOW,
      steps: [
        ...PHASE0_FLOW.steps.slice(0, 2),
        {
          id: "mail",
          block: "mail.send",
          params: { to: "mario@example.com", subject: "Ciao", body: "Testo" },
        },
      ],
    });
    await h.addEvent("manual.test", { name: "Mario Rossi", phone: PHONE });
    await drain(h.deps);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.input.to).toBe("+390000000000");
    // No test recipient for mail: the step is refused rather than reaching a real person.
    expect((await runs(h))[0].status).toBe("failed");
  });
});
