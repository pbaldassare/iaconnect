import { afterEach, describe, expect, it } from "vitest";
import { drain } from "../src/worker.ts";
import { type Harness, PHONE, createHarness } from "./helpers.ts";

let h: Harness;
afterEach(async () => {
  // Tests that need no database leave the previous, already closed one behind.
  await h?.db.close().catch(() => undefined);
});

const FLOW = {
  trigger: {
    event: "quote.requested",
    filters: [{ field: "payload.product", operator: "contains", value: "auto" }],
  },
  steps: [
    {
      id: "extract",
      block: "ai.extract",
      params: { text: "{{event.payload.details}}", fields: [{ name: "name" }] },
    },
    {
      id: "contact",
      block: "contact.upsert",
      params: {
        name: "{{event.payload.name}}",
        phone: "{{event.payload.phone}}",
        consent: { channel: "whatsapp", source: "Richiesta di preventivo" },
      },
    },
    {
      id: "send",
      block: "whatsapp.send_template",
      params: {
        template: "preventivo",
        variables: { "1": "{{contact.full_name}}", "2": "{{event.payload.product}}" },
      },
    },
    {
      id: "deal",
      block: "deal.create",
      params: { title: "Preventivo {{event.payload.product}} · {{contact.full_name}}", stage: "quote_sent" },
    },
    { id: "pause", block: "wait.delay", params: { duration: "2d" } },
    { id: "wait", block: "wait.for_reply", params: { timeout: "48h" }, onReply: "answer", onTimeout: "end" },
    {
      id: "answer",
      block: "ai.reply",
      params: { scope: "Domande sul preventivo", maxTurns: 3 },
      onHandoff: "end",
    },
    {
      id: "crm",
      block: "crm.write",
      params: { resource: "quotes", data: { name: "{{contact.full_name}}" } },
    },
    {
      id: "approve",
      block: "human.request_approval",
      params: { summary: "Inviare l'offerta a {{contact.full_name}}?" },
    },
    { id: "pay", block: "payment.request", params: { amount: 120, description: "Acconto" } },
    {
      id: "notify",
      block: "human.notify_owner",
      params: { message: "Fatto per {{contact.full_name}}", via: "whatsapp" },
    },
  ],
};

const CUSTOMER_TABLES = [
  "contacts",
  "conversations",
  "messages",
  "deals",
  "deal_events",
  "appointments",
  "payment_requests",
  "signature_requests",
  "approvals",
  "notifications",
];

describe("simulation", () => {
  it("shows every step without sending or writing customer data", async () => {
    h = await createHarness();
    await h.addTemplate("preventivo", "Buongiorno {{1}}, ecco il preventivo {{2}}. Messaggio automatico.");
    const { versionId } = await h.addFlow(FLOW, { status: "draft" });
    await h.addEvent("quote.requested", {
      name: "Mario Rossi",
      phone: PHONE,
      product: "RC auto",
      details: "...",
    });
    await h.addEvent("quote.requested", {
      name: "Lucia Verdi",
      phone: "+393335555555",
      product: "Casa",
      details: "...",
    });
    await drain(h.deps);
    // The flow is a draft: the real events started nothing.
    expect(await h.all("select * from ia_connect.flow_runs")).toHaveLength(0);

    const audited = () => h.one("select count(*)::int as n from ia_connect.audit_log");
    const before = (await audited()).n;
    await h.addJob(
      "simulate_flow",
      { flow_version_id: versionId },
      { createdBy: "00000000-0000-0000-0000-0000000000aa" },
    );
    await drain(h.deps);

    const runs = await h.all("select * from ia_connect.flow_runs");
    // Only the event that passes the trigger filter is simulated.
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ mode: "simulation", status: "completed" });
    const steps = await h.all(
      "select * from ia_connect.flow_run_steps where flow_run_id = $1 order by created_at",
      [runs[0]!.id],
    );
    expect(steps.map((step) => step.step_id)).toEqual(FLOW.steps.map((step) => step.id));
    expect(new Set(steps.map((step) => step.status))).toEqual(new Set(["simulated"]));
    const output = Object.fromEntries(steps.map((step) => [step.step_id, step.output]));
    expect(output.contact).toMatchObject({
      created: true,
      contact: { full_name: "Mario Rossi", phone: PHONE },
    });
    expect(output.send).toMatchObject({
      simulated: true,
      to: PHONE,
      text: "Buongiorno Mario Rossi, ecco il preventivo RC auto. Messaggio automatico.",
      warnings: [],
    });
    expect(output.deal).toMatchObject({
      deal: { title: "Preventivo RC auto · Mario Rossi", stage: "quote_sent" },
    });
    expect(output.pause).toMatchObject({ skipped: "2d" });
    expect(steps.find((step) => step.step_id === "wait")!.outlet).toBe("onReply");
    expect(output.answer).toMatchObject({ simulated: true, turns: 1, lastReply: "Risposta 1" });
    expect(output.crm).toMatchObject({ simulated: true, data: { name: "Mario Rossi" } });
    expect(output.approve).toMatchObject({ decision: "approved" });

    // Nothing left the platform and no customer data was written.
    expect(h.calls).toHaveLength(0);
    for (const table of CUSTOMER_TABLES) {
      expect([table, (await h.one(`select count(*)::int as n from ia_connect.${table}`)).n]).toEqual([
        table,
        0,
      ]);
    }
    expect((await audited()).n).toBe(before);
    expect(
      await h.all("select * from ia_connect.scheduled_jobs where kind in ('wait_timeout', 'resume_run')"),
    ).toHaveLength(0);
    // AI steps really ran and were metered; messages and flow runs were not counted.
    expect(
      (await h.all("select purpose from ia_connect.ai_calls order by created_at")).map((row) => row.purpose),
    ).toEqual(["ai.extract", "ai.reply"]);
    expect(await h.all("select metric from ia_connect.usage_counters")).toEqual([{ metric: "ai_credits" }]);

    // Simulating again replaces the previous simulation.
    await h.addJob("simulate_flow", { flow_version_id: versionId });
    await drain(h.deps);
    expect(await h.all("select * from ia_connect.flow_runs")).toHaveLength(1);
  });

  it("warns when the real send would be refused, and still runs without events", async () => {
    h = await createHarness();
    await h.addTemplate("preventivo", "Ciao {{1}}");
    const { versionId } = await h.addFlow(
      {
        trigger: { event: "manual.test", filters: [] },
        steps: [
          { id: "contact", block: "contact.upsert", params: { phone: PHONE } },
          { id: "text", block: "whatsapp.send_text", params: { text: "Salve" } },
        ],
      },
      { status: "draft" },
    );
    await h.addJob("simulate_flow", { flow_version_id: versionId });
    await drain(h.deps);
    const step = await h.one("select output from ia_connect.flow_run_steps where step_id = 'text'");
    expect(step.output.warnings.join(" ")).toContain("consenso");
    expect(step.output.text).toContain("Questo è un messaggio automatico.");
    expect((await h.one("select event_id, status from ia_connect.flow_runs")).status).toBe("completed");
  });
});
