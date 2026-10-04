/**
 * The web side of the web ↔ worker contract.
 *
 * The step fixtures are written by the worker's own test
 * (apps/worker/test/web-contract.test.ts) from real executions of every block: when an
 * executor changes what it writes to `flow_run_steps.output`, that test fails first, the
 * fixture is refreshed, and these tests say whether the pages still read it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { USER_JOB_PAYLOADS, getBlock, listBlocks, readOperatorMessageMeta } from "@ia-connect/core";
import { describe, expect, it } from "vitest";
import { deliveryStatus, safeInternalLink } from "../src/lib/customer-labels";
import { type OutcomeInput, stepOutcome } from "../src/lib/flows/outcome";
import { stepStatus } from "../src/lib/flows/runs";
import { buildFreeMessage, buildTemplateMessage, outgoingMessageRow } from "../src/lib/inbox/outgoing";
import { runStatus } from "../src/lib/labels";
import { describeRecipe, scrapeRunStatus, traceState } from "../src/lib/scrape/describe";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
type CapturedStep = OutcomeInput & { step_id: string; error: string | null; ai_cost_micros: number };
const load = (name: string): CapturedStep[] => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const simulated = load("simulated-steps.json");
const live = load("live-steps.json");
const sim = (stepId: string) => stepOutcome(simulated.find((step) => step.step_id === stepId)!);
const real = (stepId: string) => stepOutcome(live.find((step) => step.step_id === stepId)!);
const detail = (outcome: ReturnType<typeof stepOutcome>, label: string) =>
  outcome.details.find((item) => item.label === label)?.value;

describe("simulation view, on step rows written by the worker", () => {
  it("covers every block of the catalog, and says for each one what would have happened", () => {
    expect(simulated.map((step) => step.block).sort()).toEqual(
      listBlocks()
        .map((block) => block.key)
        .sort(),
    );
    for (const step of simulated) {
      expect(step.status, step.step_id).toBe("simulated");
      expect(stepStatus(step.status).label).toBe("Simulato");
      const outcome = stepOutcome(step);
      expect(outcome.headline, step.block).toBeTruthy();
      // Nothing the worker wrote is shown as a raw object.
      for (const item of outcome.details)
        expect(item.value, `${step.block} ${item.label}`).not.toContain("[object");
    }
  });

  it("uses the conditional only for what did not really happen", () => {
    for (const step of simulated) {
      const outcome = stepOutcome(step);
      const reallyRan =
        getBlock(step.block)?.usesAi || ["logic.condition", "logic.switch"].includes(step.block);
      // contact.find_matching only reads: it runs for real in a simulation too.
      if (step.block === "contact.find_matching" || step.block === "ai.reply") continue;
      if (reallyRan) expect(outcome.headline, step.block).not.toMatch(/rebbe|simulazione/);
      else expect(outcome.headline, step.block).toMatch(/rebbe|simulazione/i);
    }
  });

  it("shows the message that would be sent: recipient, text, template, subject", () => {
    const template = sim("wa_template");
    expect(template.headline).toBe("Verrebbe inviato un messaggio WhatsApp a +393331234567.");
    expect(template.details).toEqual([
      { label: "Destinatario", value: "+393331234567" },
      { label: "Modello", value: "preventivo" },
      { label: "Testo", value: "Buongiorno Maria Rossi, ecco il preventivo RC auto." },
    ]);
    expect(template.warnings).toEqual([]);

    const mail = sim("mail");
    expect(mail.headline).toBe("Verrebbe inviato un messaggio Mail a maria.rossi@example.com.");
    expect(detail(mail, "Oggetto")).toBe("Il suo preventivo RC auto");
    expect(detail(mail, "Testo")).toContain("Gentile Maria Rossi");
  });

  it("shows why a real send would be refused", () => {
    expect(sim("wa_text").warnings).toEqual([expect.stringContaining("finestra di 24 ore")]);
    expect(sim("mail").warnings).toEqual([expect.stringContaining("consenso per il canale mail")]);
    expect(sim("sms").warnings).toEqual([expect.stringContaining("consenso per il canale SMS")]);
    // A phone number is not a social address: no recipient, and the step says so.
    const social = sim("social");
    expect(social.headline).toBe("Verrebbe inviato un messaggio Social.");
    expect(detail(social, "Destinatario")).toBe("nessun recapito");
    expect(social.warnings[0]).toContain("non ha un recapito");
  });

  it("shows the contact and the deal that would be created", () => {
    const contact = sim("contact");
    expect(contact.headline).toBe("Verrebbe creato un nuovo contatto.");
    expect(contact.details).toEqual([
      { label: "Nome", value: "Maria Rossi" },
      { label: "Telefono", value: "+393331234567" },
      { label: "Mail", value: "maria.rossi@example.com" },
      { label: "Campi", value: "prodotto: RC auto" },
      { label: "Consensi", value: "WhatsApp" },
    ]);
    const deal = sim("deal");
    expect(deal.headline).toBe("Verrebbe aperta una trattativa.");
    expect(detail(deal, "Titolo")).toBe("Preventivo RC auto · Maria Rossi");
    expect(detail(deal, "Fase")).toBe("new");
    expect(detail(deal, "Valore")).toMatch(/^1\.250,50\s€$/);
    expect(detail(deal, "Prossima azione")).toBe("Richiamare");
    expect(detail(sim("stage"), "Fase")).toBe("quote_sent");
  });

  it("shows what would be written on the CRM and what was not read", () => {
    const write = sim("crm_write");
    expect(write.headline).toBe("Verrebbe creato un record nel gestionale.");
    expect(detail(write, "Risorsa")).toBe("quotes");
    expect(detail(write, "Dati")).toBe("name: Maria Rossi · product: RC auto");
    expect(sim("crm_read").headline).toContain("In simulazione il gestionale non viene letto");
  });

  it("shows logic, waits and people steps", () => {
    expect(sim("cond").headline).toBe("Condizione vera.");
    expect(detail(sim("choose"), "Valore riconosciuto")).toBe("preventivo");
    expect(sim("each").headline).toBe("Verrebbero emessi 2 eventi, uno per elemento dell'elenco.");
    expect(detail(sim("each"), "Evento")).toBe("custom.targa");
    expect(sim("pause").headline).toBe("Attesa di 2 giorni saltata: in simulazione non si aspetta.");
    expect(detail(sim("wait"), "Risposta")).toBe("(risposta di prova del contatto)");
    expect(sim("approve").headline).toContain("vale come approvata");
    expect(detail(sim("approve"), "Richiesta")).toBe("Inviare l'offerta a Maria Rossi?");
    expect(sim("notify").headline).toBe("Verrebbe avvisato il titolare su WhatsApp.");
    expect(detail(sim("handoff"), "Nota")).toBe("Il cliente vuole parlare con una persona");
    expect(sim("find").headline).toBe("0 contatti corrispondono ai criteri.");
  });

  it("shows AI steps with what the model produced", () => {
    expect(sim("extract").details).toEqual([
      { label: "nome", value: "Mario Rossi" },
      { label: "telefono", value: "3331234567" },
    ]);
    expect(detail(sim("classify"), "Categoria")).toBe("preventivo");
    expect(detail(sim("summarize"), "Riassunto")).toBe("Riassunto di prova.");
    const reply = sim("answer");
    expect(reply.headline).toContain("non viene inviata");
    expect(detail(reply, "Risposta")).toBe("Risposta 1");
    expect(detail(reply, "Esito")).toBe("attende la prossima risposta del contatto");
    // The AI is really called in a simulation: the cost is on the row.
    expect(simulated.filter((step) => step.ai_cost_micros > 0).map((step) => step.block)).toEqual([
      "ai.extract",
      "ai.classify",
      "ai.summarize",
      "ai.reply",
    ]);
  });

  it("shows calendar, payment and signature steps", () => {
    const slots = sim("slots");
    expect(slots.headline).toContain("Orari di esempio");
    expect(detail(slots, "Orari")?.split("\n")).toHaveLength(2);
    const event = sim("event");
    expect(detail(event, "Titolo")).toBe("Appuntamento con Maria Rossi");
    expect(detail(event, "Inizio")).toMatch(/16.*2030/);
    expect(detail(event, "Luogo")).toBe("In agenzia");
    expect(detail(sim("pay"), "Importo")).toMatch(/^120,50\s€$/);
    expect(detail(sim("pay"), "Descrizione")).toBe("Acconto polizza");
    expect(detail(sim("sign"), "Documento")).toBe("Contratto RC auto");
    expect(detail(sim("post"), "Testo")).toBe("Nuova offerta RC auto");
  });
});

describe("live run view, on step rows written by the worker", () => {
  it("describes every executed step in the past tense", () => {
    for (const step of live) {
      expect(step.status, step.step_id).toBe("succeeded");
      const outcome = stepOutcome(step);
      expect(outcome.headline, step.block).toBeTruthy();
      expect(outcome.headline, step.block).not.toMatch(/rebbe/);
      // Internal ids are not details for a customer.
      for (const item of outcome.details) expect(item.value).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  });

  it("reads the real output shapes", () => {
    expect(real("contact").headline).toBe("Contatto creato.");
    expect(real("wa_template")).toMatchObject({
      headline: "Messaggio WhatsApp inviato.",
      details: [{ label: "Testo", value: "Buongiorno Maria Rossi, ecco il preventivo RC auto." }],
    });
    expect(real("deal").headline).toBe("Trattativa aperta.");
    expect(detail(real("stage"), "Fase")).toBe("quote_sent");
    expect(real("crm_read").headline).toBe("1 record letto dal gestionale.");
    expect(detail(real("crm_write"), "Record")).toBe("crm-1");
    expect(real("each").headline).toBe("Eventi emessi: 2 su 2.");
    expect(real("slots").headline).toBe("1 orario libero trovato.");
    expect(detail(real("pay"), "Indirizzo")).toBe("https://pay.example/1");
    expect(detail(real("sign"), "Indirizzo")).toBe("https://sign.example/1");
    expect(real("notify").headline).toBe("Titolare avvisato su WhatsApp.");
    expect(real("handoff").headline).toBe("Conversazione passata a una persona.");
  });

  it("covers the states a finished fixture cannot contain", () => {
    const step = (block: string, status: string, outlet: string | null, output: unknown) =>
      stepOutcome({ block, status, outlet, output });
    // Shapes from apps/worker/src/engine/blocks: waits, decisions, timeouts, a failed copy to the owner.
    expect(step("wait.delay", "waiting", null, {}).headline).toBe("In attesa che passi il tempo previsto.");
    expect(step("wait.for_reply", "waiting", null, {}).headline).toBe(
      "In attesa della risposta del contatto.",
    );
    expect(step("wait.for_reply", "succeeded", "onTimeout", { text: null, messageId: null }).headline).toBe(
      "Nessuna risposta entro il tempo previsto.",
    );
    expect(
      step("wait.for_reply", "succeeded", "onReply", { text: "Sì grazie", messageId: "m" }).details,
    ).toEqual([{ label: "Risposta", value: "Sì grazie" }]);
    expect(step("human.request_approval", "waiting", null, { approvalId: "a" }).headline).toBe(
      "In attesa della decisione di una persona.",
    );
    expect(step("human.request_approval", "succeeded", "onRejected", { decision: "rejected" }).headline).toBe(
      "Rifiutata",
    );
    expect(step("human.request_approval", "succeeded", "onTimeout", { decision: "expired" }).headline).toBe(
      "Scaduta senza una decisione",
    );
    const notify = step("human.notify_owner", "succeeded", "next", {
      notificationId: "n",
      via: "mail",
      sent: false,
      reason: "Recapito del titolare non configurato: avviso solo nell'applicazione.",
    });
    expect(notify.headline).toBe("Titolare avvisato nell'applicazione.");
    expect(notify.warnings).toEqual([
      "Recapito del titolare non configurato: avviso solo nell'applicazione.",
    ]);
    const handoff = step("ai.reply", "succeeded", "onHandoff", {
      turns: 2,
      outcome: "handoff",
      lastReply: "La passo a un collega.",
      reason: "Il contatto ha bisogno di una persona.",
    });
    expect(handoff.headline).toBe("L'IA ha inviato 2 risposte.");
    expect(detail(handoff, "Esito")).toBe("passa la conversazione a una persona");
    expect(detail(handoff, "Motivo")).toBe("Il contatto ha bisogno di una persona.");
    expect(
      step("ai.extract", "succeeded", "next", { data: { name: "Mario" }, missing: ["phone"] }).warnings,
    ).toEqual(["Dati non trovati nel testo: phone."]);
    // A failed step has only its error (shown by the component); an unknown block only its JSON.
    expect(step("mail.send", "failed", null, {})).toEqual({ headline: null, details: [], warnings: [] });
    expect(step("future.block", "succeeded", "next", { x: 1 })).toEqual({
      headline: null,
      details: [],
      warnings: [],
    });
    expect(step("mail.send", "succeeded", "next", null).headline).toBe("Messaggio Mail inviato.");
  });
});

describe("statuses the worker writes have a label", () => {
  it("runs, steps, deliveries and scrape runs", () => {
    // Values of the CHECK constraints in supabase/migrations/20261004000100_tables.sql.
    for (const status of ["running", "waiting", "completed", "failed", "cancelled"]) {
      expect(runStatus(status).label, status).not.toBe(status);
    }
    for (const status of ["running", "succeeded", "failed", "simulated", "waiting"]) {
      expect(stepStatus(status).label, status).not.toBe(status);
    }
    for (const status of ["queued", "sent", "delivered", "read", "failed", "received", "simulated"]) {
      expect(deliveryStatus(status).label, status).not.toBe(status);
    }
    for (const status of ["running", "succeeded", "failed"]) {
      expect(scrapeRunStatus(status).label, status).not.toBe(status);
    }
  });
});

describe("what the web writes for the worker", () => {
  it("builds an operator message whose meta the worker reads back unchanged", () => {
    const template = {
      id: "t1",
      body: "Ciao {{1}}, a {{2}}",
      channel: "whatsapp",
      approval_status: "approved",
    };
    const built = buildTemplateMessage(template, ["Maria", "domani"]);
    if (!built.ok) throw new Error(built.error);
    const row = outgoingMessageRow({
      organizationId: "org",
      conversationId: "conv",
      channel: "whatsapp",
      userId: "user",
      message: built.message,
    });
    expect(row).toEqual({
      organization_id: "org",
      conversation_id: "conv",
      direction: "out",
      channel: "whatsapp",
      content: "Ciao Maria, a domani",
      meta: { variables: ["Maria", "domani"] },
      template_id: "t1",
      delivery_status: "queued",
      sent_by_user_id: "user",
    });
    expect(readOperatorMessageMeta(row.meta)).toEqual({ variables: ["Maria", "domani"], subject: undefined });
    const mail = buildFreeMessage("mail", "Testo", "Oggetto");
    if (!mail.ok) throw new Error(mail.error);
    expect(readOperatorMessageMeta(mail.message.meta)).toEqual({ variables: undefined, subject: "Oggetto" });
    // The worker adds its own key while sending: it must not confuse the reader.
    expect(readOperatorMessageMeta({ subject: "x", sending_at: "2026-10-04T10:00:00Z" }).subject).toBe("x");
    expect(readOperatorMessageMeta(null)).toEqual({ variables: undefined, subject: undefined });
  });

  it("rejects job payloads the worker would reject", () => {
    const id = "7d69efad-b09f-49ea-abf0-d32e5fd51c76";
    expect(USER_JOB_PAYLOADS.send_message.safeParse({ message_id: id }).success).toBe(true);
    expect(USER_JOB_PAYLOADS.send_message.safeParse({ message_id: "1; drop table" }).success).toBe(false);
    expect(USER_JOB_PAYLOADS.send_message.safeParse({ messageId: id }).success).toBe(false);
    expect(USER_JOB_PAYLOADS.simulate_flow.safeParse({ flow_version_id: id, limit: 5 }).success).toBe(true);
    expect(USER_JOB_PAYLOADS.simulate_flow.safeParse({ flow_version_id: id, limit: 500 }).success).toBe(
      false,
    );
    // Ids of test fixtures are not RFC versions: the check is on the shape only, as in the worker.
    expect(
      USER_JOB_PAYLOADS.scrape_run.safeParse({ recipe_id: "00000000-0000-0000-0000-0000000000aa" }).success,
    ).toBe(true);
  });
});

describe("what the worker writes for the web", () => {
  it("notification links are followed only when they are in-app paths", () => {
    expect(safeInternalLink("/app/collegamenti/7d69efad-b09f-49ea-abf0-d32e5fd51c76")).toBeTruthy();
    expect(safeInternalLink("/app/flussi/a/esecuzioni/b")).toBe("/app/flussi/a/esecuzioni/b");
    expect(safeInternalLink("https://example.com")).toBeNull();
    expect(safeInternalLink("//example.com")).toBeNull();
  });

  it("reads the trace outcome from the jobs", () => {
    const at = (minute: number) => `2026-10-04 10:0${minute}:00+00`;
    expect(traceState([])).toBe("idle");
    expect(traceState([{ kind: "scrape_trace", status: "running", created_at: at(1) }])).toBe("tracing");
    expect(traceState([{ kind: "scrape_trace", status: "done", created_at: at(1) }])).toBe("idle");
    expect(
      traceState([
        { kind: "scrape_trace", status: "done", created_at: at(1) },
        { kind: "scrape_run", status: "done", created_at: at(3) },
        { kind: "scrape_trace", status: "failed", created_at: at(2) },
      ]),
    ).toBe("failed");
    // A newer successful trace clears an older failure; a pending one wins over everything.
    expect(
      traceState([
        { kind: "scrape_trace", status: "failed", created_at: at(1) },
        { kind: "scrape_trace", status: "done", created_at: at(2) },
      ]),
    ).toBe("idle");
    expect(
      traceState([
        { kind: "scrape_trace", status: "failed", created_at: at(1) },
        { kind: "scrape_trace", status: "pending", created_at: at(2) },
      ]),
    ).toBe("tracing");
  });

  it("describes a recipe version as the worker saves it, credentials as placeholders", () => {
    const view = describeRecipe({
      steps: [
        { action: "goto", url: "https://portale.example/login" },
        { action: "fill", selector: "#password", value: "{{secrets.password}}" },
        { action: "extract", listSelector: ".card", fields: { title: { selector: ".title" } } },
      ],
      output: {
        eventType: "listing.published",
        keyField: "title",
        fields: [{ name: "title", type: "string", required: true }],
      },
    });
    expect(view?.steps[1]).toBe("Scrive [credenziale: password] nel campo #password");
    expect(view?.eventType).toBe("listing.published");
    expect(describeRecipe({ steps: "?" })).toBeNull();
  });
});
