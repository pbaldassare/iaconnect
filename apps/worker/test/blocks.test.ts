import { afterEach, describe, expect, it } from "vitest";
import { drain } from "../src/worker.ts";
import { type Harness, PHONE, createHarness } from "./helpers.ts";

let h: Harness;
afterEach(async () => {
  await h?.db.close().catch(() => undefined);
});

const outputs = async (harness: Harness) =>
  Object.fromEntries(
    (
      await harness.all(
        "select idempotency_key, output, outlet, status from ia_connect.flow_run_steps order by created_at",
      )
    ).map((step) => [step.idempotency_key, step]),
  );

describe("blocks", () => {
  it("runs logic, data, calendar, payment, signature and the other channels through connectors", async () => {
    h = await createHarness();
    await h.sql.query(
      `update ia_connect.org_settings set brand = '{"ownerPhone": "+393470000000"}' where organization_id = $1`,
      [h.orgId],
    );
    await h.addFlow({
      trigger: { event: "order.created", filters: [{ field: "payload.total", operator: "gt", value: 10 }] },
      steps: [
        {
          id: "contact",
          block: "contact.upsert",
          params: {
            name: "{{event.payload.name}}",
            phone: "{{event.payload.phone}}",
            email: "{{event.payload.email}}",
            fields: { zona: "Centro" },
            consent: { channel: "mail", source: "Ordine" },
          },
        },
        {
          id: "again",
          block: "contact.upsert",
          params: { email: "{{event.payload.email}}", consent: { channel: "sms", source: "Ordine" } },
        },
        {
          id: "big",
          block: "logic.condition",
          params: { left: "{{event.payload.total}}", operator: "gte", right: 100 },
          onTrue: "kind",
          onFalse: "end",
        },
        {
          id: "kind",
          block: "logic.switch",
          params: {
            value: "{{event.payload.status}}",
            cases: [{ equals: "paid", goto: "class" }],
            default: "end",
          },
        },
        { id: "skipped", block: "human.notify_owner", params: { message: "non deve succedere" } },
        {
          id: "class",
          block: "ai.classify",
          params: { text: "{{event.payload.note}}", categories: [{ key: "urgente" }, { key: "normale" }] },
        },
        { id: "sum", block: "ai.summarize", params: { text: "{{event.payload.note}}" } },
        {
          id: "deal",
          block: "deal.create",
          params: { title: "Ordine {{event.payload.orderNumber}}", value: "{{event.payload.total}}" },
        },
        { id: "stage", block: "deal.update_stage", params: { stage: "won", nextAction: "Spedire" } },
        {
          id: "read",
          block: "crm.read",
          params: { resource: "orders", query: { number: "{{event.payload.orderNumber}}" } },
        },
        {
          id: "write",
          block: "crm.write",
          params: {
            resource: "orders",
            id: "{{event.payload.orderNumber}}",
            data: { status: "{{steps.read.output.records[0].status}}" },
          },
        },
        {
          id: "mail",
          block: "mail.send",
          params: {
            subject: "Ordine {{event.payload.orderNumber}}",
            body: "Grazie {{contact.full_name}}, {{steps.sum.output.summary}}",
          },
        },
        { id: "sms", block: "sms.send", params: { text: "Ordine ricevuto. Messaggio automatico." } },
        { id: "slots", block: "calendar.find_slots", params: { durationMinutes: 30 } },
        {
          id: "event",
          block: "calendar.create_event",
          params: {
            title: "Consegna",
            start: "{{steps.slots.output.slots[0].start}}",
            end: "{{steps.slots.output.slots[0].end}}",
          },
        },
        {
          id: "pay",
          block: "payment.request",
          params: { amount: "{{event.payload.total}}", description: "Saldo ordine" },
        },
        {
          id: "sign",
          block: "signature.request",
          params: { documentUrl: "https://example.com/contratto.pdf", title: "Contratto" },
        },
        { id: "post", block: "social.publish_post", params: { text: "Nuovo ordine evaso!" } },
        {
          id: "match",
          block: "contact.find_matching",
          params: { rules: [{ field: "zona", operator: "eq", value: "centro" }] },
        },
        {
          id: "fan",
          block: "logic.for_each",
          params: {
            items: "{{steps.match.output.contacts}}",
            emitEvent: "custom.order.matched",
            payload: { order: "{{event.payload.orderNumber}}" },
          },
        },
        {
          id: "owner",
          block: "human.notify_owner",
          params: { message: "Ordine {{event.payload.orderNumber}} gestito", via: "whatsapp" },
        },
        { id: "handoff", block: "human.handoff", params: { note: "Seguire la consegna" } },
      ],
    });
    await h.addEvent("order.created", {
      name: "Lucia Verdi",
      phone: PHONE,
      email: "Lucia@Example.com",
      total: 150,
      status: "paid",
      orderNumber: "A-42",
      note: "Consegna rapida",
    });
    // Does not pass the trigger filter.
    await h.addEvent("order.created", { name: "Piccolo", total: 5 });
    await drain(h.deps);

    const runs = await h.all("select * from ia_connect.flow_runs");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "completed", error: null });
    const out = await outputs(h);
    expect(out.skipped).toBeUndefined();
    expect(out.again.output).toMatchObject({ created: false });
    expect(out.big).toMatchObject({ outlet: "onTrue", output: { result: true } });
    expect(out.class.output).toEqual({ category: "urgente" });
    expect(out.match.output).toMatchObject({ count: 1 });
    expect(out.fan.output).toEqual({ emitted: 1, total: 1 });
    expect(out.owner.output).toMatchObject({ via: "whatsapp", sent: true });

    const contact = await h.one("select * from ia_connect.contacts");
    expect(contact).toMatchObject({
      full_name: "Lucia Verdi",
      phones: [PHONE],
      emails: ["lucia@example.com"],
      custom_fields: { zona: "Centro" },
    });
    expect(Object.keys(contact.consents).sort()).toEqual(["mail", "sms"]);
    const deal = await h.one(
      "select d.*, s.key as stage from ia_connect.deals d join ia_connect.deal_stages s on s.id = d.stage_id",
    );
    expect(deal).toMatchObject({ title: "Ordine A-42", stage: "won", next_action: "Spedire" });
    expect(Number(deal.estimated_value_cents)).toBe(15000);
    expect(deal.closed_at).not.toBeNull();
    expect(
      (await h.all("select type from ia_connect.deal_events order by created_at")).map((row) => row.type),
    ).toEqual(["created", "stage_changed"]);

    expect(h.calls.map((call) => `${call.connector}.${call.action}`)).toEqual([
      "crm_rest.read",
      "crm_rest.write",
      "gmail.send",
      "sms_twilio.send",
      "google_calendar.findSlots",
      "google_calendar.createEvent",
      "payment_stripe.createLink",
      "signature_link.createRequest",
      "meta_social.publishPost",
      "whatsapp_meta.sendText",
    ]);
    const call = (name: string) => h.calls.find((item) => `${item.connector}.${item.action}` === name)!.input;
    expect(call("crm_rest.write")).toEqual({ resource: "orders", id: "A-42", data: { status: "spedito" } });
    expect(call("gmail.send")).toMatchObject({
      to: "lucia@example.com",
      subject: "Ordine A-42",
      text: "Grazie Lucia Verdi, Riassunto di prova.\n\nQuesto è un messaggio automatico.",
    });
    expect(call("sms_twilio.send")).toEqual({ to: PHONE, text: "Ordine ricevuto. Messaggio automatico." });
    expect(call("payment_stripe.createLink")).toMatchObject({ amountCents: 15000, currency: "EUR" });
    expect(call("signature_link.createRequest")).toMatchObject({
      signerName: "Lucia Verdi",
      signerEmail: "lucia@example.com",
    });
    expect(call("whatsapp_meta.sendText")).toEqual({ to: "+393470000000", text: "Ordine A-42 gestito" });

    expect(await h.one("select title, external_event_id, contact_id from ia_connect.appointments")).toEqual({
      title: "Consegna",
      external_event_id: "cal-1",
      contact_id: contact.id,
    });
    expect(
      await h.one("select amount_cents::int as cents, url, status from ia_connect.payment_requests"),
    ).toEqual({ cents: 15000, url: "https://pay.example/1", status: "pending" });
    expect((await h.one("select url from ia_connect.signature_requests")).url).toBe("https://sign.example/1");
    expect(
      (await h.all("select channel from ia_connect.messages order by created_at")).map((row) => row.channel),
    ).toEqual(["mail", "sms"]);
    // Two contact messages and the owner's alert were counted.
    expect(
      (await h.one("select value::int as value from ia_connect.usage_counters where metric = 'messages'"))
        .value,
    ).toBe(3);

    // The emitted event carries the item and a deterministic dedupe key.
    const emitted = await h.one("select * from ia_connect.events where type = 'custom.order.matched'");
    expect(emitted.payload).toMatchObject({
      order: "A-42",
      item: { id: contact.id, full_name: "Lucia Verdi", phone: PHONE },
    });
    expect(emitted.dedupe_key).toBe(`${runs[0].id}:fan:0`);
    expect(
      (await h.one("select assignee_type from ia_connect.conversations where channel = 'sms'")).assignee_type,
    ).toBe("user");
  });

  it("fails with a clear message on invalid params or a missing connection", async () => {
    h = await createHarness();
    await h.sql.query("update ia_connect.connections set status = 'expired' where id = $1", [
      h.connections.sms,
    ]);
    await h.addFlow({
      trigger: { event: "manual.test", filters: [] },
      steps: [
        {
          id: "contact",
          block: "contact.upsert",
          params: { phone: PHONE, consent: { channel: "sms", source: "Prova" } },
        },
        { id: "sms", block: "sms.send", params: { text: "{{event.payload.text}}" } },
      ],
    });
    await h.addEvent("manual.test", { text: "ciao" });
    await h.addEvent("manual.test", {});
    await drain(h.deps);
    const errors = (await h.all("select error from ia_connect.flow_runs order by created_at")).map(
      (run) => run.error,
    );
    expect(errors[0]).toContain("Nessun collegamento attivo di tipo SMS");
    expect(errors[1]).toContain("Parametri non validi (text");
    expect(h.calls).toHaveLength(0);
  });

  it("stops a flow that loops forever", async () => {
    h = await createHarness({ config: { maxStepsPerRun: 12 } });
    await h.addFlow({
      trigger: { event: "manual.test", filters: [] },
      steps: [
        { id: "a", block: "logic.condition", params: { left: 1, operator: "eq", right: 1 }, onTrue: "b" },
        { id: "b", block: "logic.condition", params: { left: 1, operator: "eq", right: 1 }, onTrue: "a" },
      ],
    });
    await h.addEvent("manual.test", {});
    await drain(h.deps);
    const run = await h.one("select status, error from ia_connect.flow_runs");
    expect(run.status).toBe("failed");
    expect(run.error).toContain("ciclo");
    const keys = (
      await h.all("select idempotency_key from ia_connect.flow_run_steps order by created_at")
    ).map((step) => step.idempotency_key);
    expect(keys.slice(0, 4)).toEqual(["a", "b", "a#2", "b#2"]);
  });
});
