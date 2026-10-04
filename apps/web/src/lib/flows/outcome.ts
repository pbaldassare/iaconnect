import { channelLabel } from "../customer-labels";
import { formatDateTime, formatMoney } from "../format";
import { durationLabel } from "./describe";

/**
 * What a step did — or, in a simulation, what it would have done — read from the
 * `flow_run_steps.output` the worker really writes for each block
 * (apps/worker/src/engine/blocks/*). Pure, unit tested against outputs captured from the
 * worker's executors (apps/web/test/fixtures/simulated-steps.json).
 */

export interface OutcomeDetail {
  label: string;
  value: string;
}

export interface StepOutcome {
  /** One Italian sentence; null when there is nothing to say beyond the status (e.g. a failed step). */
  headline: string | null;
  details: OutcomeDetail[];
  /** Reasons a real run would refuse or only partly do this step. */
  warnings: string[];
}

export interface OutcomeInput {
  block: string;
  status: string;
  outlet: string | null;
  output: unknown;
  input?: unknown;
}

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Bag) : {};
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** Compact JSON for small objects (custom fields, CRM data); long ones are cut. */
function compact(value: unknown, max = 400): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return text(value);
  if (Object.keys(value as object).length === 0) return "";
  const entries = Array.isArray(value)
    ? value.map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item)))
    : Object.entries(value as Bag).map(
        ([key, item]) =>
          `${key}: ${typeof item === "object" && item !== null ? JSON.stringify(item) : String(item)}`,
      );
  const joined = entries.join(Array.isArray(value) ? "\n" : " · ");
  return joined.length > max ? `${joined.slice(0, max - 1)}…` : joined;
}

function euros(value: unknown): string {
  const amount = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(amount)) return "";
  // formatMoney takes cents and groups thousands the Italian way ("1.250,50 €").
  return formatMoney(Math.round(amount * 100));
}

function when(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  return Number.isNaN(new Date(value).getTime()) ? value : formatDateTime(value);
}

class Builder {
  details: OutcomeDetail[] = [];
  warnings: string[] = [];
  add(label: string, value: string): this {
    if (value !== "") this.details.push({ label, value });
    return this;
  }
  warn(value: unknown): this {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "string" && item.trim() !== "") this.warnings.push(item.trim());
    }
    return this;
  }
  done(headline: string | null): StepOutcome {
    return { headline, details: this.details, warnings: this.warnings };
  }
}

const SEND_BLOCKS: Record<string, string> = {
  "whatsapp.send_template": "whatsapp",
  "whatsapp.send_text": "whatsapp",
  "mail.send": "mail",
  "sms.send": "sms",
  "social.send_message": "social",
};

const AI_OUTCOMES: Record<string, string> = {
  continue: "attende la prossima risposta del contatto",
  done: "richiesta conclusa",
  handoff: "passa la conversazione a una persona",
  out_of_scope: "richiesta fuori dall'ambito: frase standard e passaggio a una persona",
  timeout: "il contatto non ha più risposto",
};

const APPROVAL_DECISIONS: Record<string, string> = {
  approved: "Approvata",
  rejected: "Rifiutata",
  expired: "Scaduta senza una decisione",
};

const VIA: Record<string, string> = { app: "nell'applicazione", whatsapp: "su WhatsApp", mail: "via mail" };

/** Consent channels marked as granted, e.g. "WhatsApp, Mail". */
function grantedConsents(value: unknown): string {
  return Object.entries(bag(value))
    .filter(([, entry]) => bag(entry).granted === true)
    .map(([channel]) => channelLabel(channel))
    .join(", ");
}

export function stepOutcome(step: OutcomeInput): StepOutcome {
  const out = bag(step.output);
  const b = new Builder();
  if (step.status === "failed") return b.done(null);
  if (step.status === "running") return b.done("In corso.");
  // Simulated steps of blocks without a `simulate` (conditions, AI extraction) ran for real.
  const sim = out.simulated === true;

  const channel = SEND_BLOCKS[step.block];
  if (channel) {
    if (sim) {
      const to = text(out.to);
      b.add("Destinatario", to || "nessun recapito")
        .add("Modello", text(out.template))
        .add("Oggetto", text(out.subject))
        .add("Testo", text(out.text))
        .warn(out.warnings);
      return b.done(
        `Verrebbe inviato un messaggio ${channelLabel(text(out.channel) || channel)}${to ? ` a ${to}` : ""}.`,
      );
    }
    b.add("Testo", text(out.text));
    return b.done(`Messaggio ${channelLabel(channel)} inviato.`);
  }

  switch (step.block) {
    case "social.publish_post":
      if (sim) {
        b.add("Testo", text(out.text)).add("Immagine o video", text(out.mediaUrl));
        return b.done("Verrebbe pubblicato un post sui social.");
      }
      return b.add("Post", text(out.postId)).done("Post pubblicato.");

    case "contact.upsert": {
      const created = out.created === true;
      if (sim) {
        const contact = bag(out.contact);
        b.add("Nome", text(contact.full_name))
          .add("Telefono", text(contact.phone))
          .add("Mail", text(contact.email))
          .add("Campi", compact(contact.custom_fields))
          .add("Consensi", grantedConsents(contact.consents));
        return b.done(
          created ? "Verrebbe creato un nuovo contatto." : "Verrebbe aggiornato un contatto già presente.",
        );
      }
      return b.done(created ? "Contatto creato." : "Contatto già presente: aggiornato.");
    }

    case "contact.find_matching": {
      const contacts = Array.isArray(out.contacts) ? out.contacts.map(bag) : [];
      const names = contacts
        .slice(0, 5)
        .map((contact) => text(contact.full_name) || text(contact.phone) || text(contact.email))
        .filter(Boolean);
      b.add("Primi contatti", names.join(", "));
      const count = typeof out.count === "number" ? out.count : contacts.length;
      return b.done(
        count === 1 ? "1 contatto corrisponde ai criteri." : `${count} contatti corrispondono ai criteri.`,
      );
    }

    case "deal.create":
      if (sim) {
        const deal = bag(out.deal);
        b.add("Titolo", text(deal.title))
          .add("Fase", text(deal.stage))
          .add("Valore", euros(deal.value))
          .add("Prossima azione", text(deal.next_action))
          .add("Campi", compact(deal.custom_fields));
        return b.done("Verrebbe aperta una trattativa.");
      }
      return b.done("Trattativa aperta.");

    case "deal.update_stage":
      b.add("Fase", text(out.stage));
      return b.done(sim ? "La trattativa passerebbe a un'altra fase." : "Trattativa spostata di fase.");

    case "crm.read": {
      const count = typeof out.count === "number" ? out.count : 0;
      if (sim) return b.done(text(out.note) || "In simulazione il gestionale non viene letto.");
      return b.done(count === 1 ? "1 record letto dal gestionale." : `${count} record letti dal gestionale.`);
    }

    case "crm.write":
      if (sim) {
        b.add("Risorsa", text(out.resource)).add("Record", text(out.id)).add("Dati", compact(out.data));
        return b.done(
          text(out.id)
            ? "Verrebbe aggiornato un record del gestionale."
            : "Verrebbe creato un record nel gestionale.",
        );
      }
      return b.add("Record", text(out.id)).done("Dati scritti sul gestionale.");

    case "logic.condition":
      return b.done(out.result === true ? "Condizione vera." : "Condizione falsa.");

    case "logic.switch":
      return out.matched === null || out.matched === undefined
        ? b.done("Nessun caso corrisponde: il flusso segue la strada predefinita.")
        : b
            .add("Valore riconosciuto", text(out.matched) || compact(out.matched))
            .done("Un caso corrisponde.");

    case "logic.for_each": {
      const emitted = typeof out.emitted === "number" ? out.emitted : 0;
      if (sim) {
        b.add("Evento", text(out.event)).add("Primi elementi", compact(out.sample));
        return b.done(
          emitted === 1
            ? "Verrebbe emesso 1 evento, uno per elemento dell'elenco."
            : `Verrebbero emessi ${emitted} eventi, uno per elemento dell'elenco.`,
        );
      }
      return b.done(`Eventi emessi: ${emitted} su ${typeof out.total === "number" ? out.total : emitted}.`);
    }

    case "wait.delay":
      if (sim)
        return b.done(`Attesa di ${durationLabel(out.skipped)} saltata: in simulazione non si aspetta.`);
      return b.done(
        step.status === "waiting" ? "In attesa che passi il tempo previsto." : "Attesa terminata.",
      );

    case "wait.for_reply":
      if (sim) {
        b.add("Risposta", text(out.text));
        return b.done("In simulazione il contatto «risponde» subito con una risposta di prova.");
      }
      if (step.status === "waiting") return b.done("In attesa della risposta del contatto.");
      if (step.outlet === "onTimeout") return b.done("Nessuna risposta entro il tempo previsto.");
      return b.add("Risposta", text(out.text)).done("Il contatto ha risposto.");

    case "human.request_approval":
      if (sim) {
        b.add("Richiesta", text(out.summary));
        return b.done("Verrebbe chiesta un'approvazione: in simulazione vale come approvata.");
      }
      if (step.status === "waiting") return b.done("In attesa della decisione di una persona.");
      return b.done(APPROVAL_DECISIONS[text(out.decision)] ?? "Decisione registrata.");

    case "human.handoff":
      if (sim) return b.add("Nota", text(out.note)).done("La conversazione passerebbe a una persona.");
      return b.done(
        text(out.conversationId)
          ? "Conversazione passata a una persona."
          : "Avviso inviato: non c'era una conversazione da passare.",
      );

    case "human.notify_owner": {
      const via = VIA[text(out.via)] ?? "";
      if (sim) {
        b.add("Messaggio", text(out.message));
        return b.done(`Verrebbe avvisato il titolare${via ? ` ${via}` : ""}.`);
      }
      if (out.sent === false) b.warn(out.reason);
      return b.done(
        out.sent === true
          ? `Titolare avvisato ${via || "nell'applicazione"}.`
          : "Titolare avvisato nell'applicazione.",
      );
    }

    case "ai.extract": {
      for (const [key, value] of Object.entries(bag(out.data))) b.add(key, text(value) || compact(value));
      const missing = Array.isArray(out.missing)
        ? out.missing.filter((item) => typeof item === "string")
        : [];
      if (missing.length > 0) b.warn(`Dati non trovati nel testo: ${missing.join(", ")}.`);
      return b.done("Dati estratti dall'IA.");
    }

    case "ai.classify":
      return b.add("Categoria", text(out.category)).done("Testo classificato dall'IA.");

    case "ai.summarize":
      return b.add("Riassunto", text(out.summary)).done("Riassunto scritto dall'IA.");

    case "ai.reply": {
      if (step.status === "waiting" && !text(out.lastReply)) {
        return b.done("In attesa del primo messaggio del contatto.");
      }
      b.add("Risposta", text(out.lastReply)).add(
        "Esito",
        AI_OUTCOMES[text(out.outcome)] ?? text(out.outcome),
      );
      if (!sim) b.add("Motivo", text(out.reason));
      if (sim) return b.done("L'IA risponderebbe così (in simulazione la risposta non viene inviata).");
      const turns = typeof out.turns === "number" ? out.turns : 0;
      return b.done(turns === 1 ? "L'IA ha inviato 1 risposta." : `L'IA ha inviato ${turns} risposte.`);
    }

    case "calendar.find_slots": {
      const slots = Array.isArray(out.slots) ? out.slots.map(bag) : [];
      b.add("Orari", slots.map((slot) => `${when(slot.start)} – ${when(slot.end)}`).join("\n"));
      if (sim) return b.done("Orari di esempio: in simulazione il calendario non viene letto.");
      return b.done(
        slots.length === 1 ? "1 orario libero trovato." : `${slots.length} orari liberi trovati.`,
      );
    }

    case "calendar.create_event":
      if (sim) {
        const appointment = bag(out.appointment);
        b.add("Titolo", text(appointment.title))
          .add("Inizio", when(appointment.start))
          .add("Fine", when(appointment.end))
          .add("Luogo", text(appointment.location));
        return b.done("Verrebbe fissato un appuntamento sul calendario.");
      }
      return b.done("Appuntamento fissato sul calendario.");

    case "payment.request":
      if (sim) {
        b.add("Importo", euros(out.amount)).add("Descrizione", text(out.description));
        return b.done("Verrebbe creata una richiesta di pagamento.");
      }
      return b.add("Indirizzo", text(out.url)).done("Richiesta di pagamento creata.");

    case "signature.request":
      if (sim) return b.add("Documento", text(out.title)).done("Verrebbe creata una richiesta di firma.");
      return b.add("Indirizzo", text(out.url)).done("Richiesta di firma creata.");
  }
  return b.done(null);
}
