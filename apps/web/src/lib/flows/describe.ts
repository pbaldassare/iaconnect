import { EVENT_TYPES, type FlowDefinition, type Outlet, type Step, getBlock } from "@ia-connect/core";
import { fieldName, fieldPathName } from "./field-labels";

/**
 * Readable Italian descriptions of a flow definition: trigger, steps, exits.
 * Pure functions, unit tested (apps/web/test/flows.test.ts).
 */

export interface DescribeNames {
  /** deal stage key → name shown to the customer. */
  stages?: ReadonlyMap<string, string>;
  /** connection id → name. */
  connections?: ReadonlyMap<string, string>;
  /** step id → its number in the schema, so a reference reads «passo 1» instead of the id. */
  steps?: ReadonlyMap<string, number>;
}

const OUTLET_LABELS: Record<Outlet, string> = {
  next: "poi",
  onReply: "se risponde",
  onTimeout: "alla scadenza",
  onTrue: "se è vero",
  onFalse: "se è falso",
  onApproved: "se viene approvata",
  onRejected: "se viene rifiutata",
  onHandoff: "se serve una persona",
};

export function outletLabel(outlet: Outlet): string {
  return OUTLET_LABELS[outlet];
}

/** Italian title of an event type; `custom.*` and unknown types are shown as they are. */
export function eventTitle(type: string | null | undefined): string {
  if (!type) return "—";
  const known = (EVENT_TYPES as Record<string, { title: string }>)[type];
  if (known) return known.title;
  if (type.startsWith("custom.")) return `Evento interno «${type.slice(7)}»`;
  return type;
}

const OPERATORS: Record<string, string> = {
  eq: "è uguale a",
  neq: "è diverso da",
  contains: "contiene",
  not_contains: "non contiene",
  starts_with: "inizia con",
  gt: "è maggiore di",
  gte: "è almeno",
  lt: "è minore di",
  lte: "è al massimo",
  exists: "è presente",
  not_exists: "manca",
  in: "è uno tra",
};

const CHANNELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  mail: "mail",
  sms: "SMS",
  social: "social",
  app: "nell'app",
};

const ROOTS: Record<string, string> = {
  event: "evento",
  contact: "contatto",
  deal: "trattativa",
  org: "azienda",
  reply: "risposta",
};

const MAX_TEXT = 120;

function truncate(text: string, max = MAX_TEXT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * `{{event.payload.subject}}` → `[evento: oggetto]`, `{{contact.full_name}}` → `[contatto: nome]`,
 * `{{steps.extract.output.data.name}}` → `[passo 1: nome]` (the step id when its number is unknown).
 */
export function humanizeRefs(text: string, names: DescribeNames = {}): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.[\]-]+)\s*\}\}/g, (_, path: string) => {
    const parts = path.split(".");
    const root = parts[0] ?? "";
    if (root === "steps") {
      const id = parts[1] ?? "?";
      const rest = parts.slice(2).join(".");
      return `[passo ${names.steps?.get(id) ?? id}${rest ? `: ${fieldPathName(rest)}` : ""}]`;
    }
    const label = ROOTS[root];
    if (!label) return `[${path}]`;
    const rest = parts.slice(1).join(".");
    return rest ? `[${label}: ${fieldPathName(rest)}]` : `[${label}]`;
  });
}

/** Any param value as short readable text. */
export function showValue(value: unknown, max = MAX_TEXT, names: DescribeNames = {}): string {
  if (value === undefined || value === null || value === "") return "(vuoto)";
  if (typeof value === "string") return truncate(humanizeRefs(value, names), max);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return truncate(value.map((item) => showValue(item, 40, names)).join(", "), max);
  return truncate(humanizeRefs(JSON.stringify(value), names), max);
}

const UNIT_NAMES: Record<string, [string, string]> = {
  s: ["secondo", "secondi"],
  m: ["minuto", "minuti"],
  h: ["ora", "ore"],
  d: ["giorno", "giorni"],
};

/** "48h" → "48 ore", "1d" → "1 giorno". Anything else is returned as it is. */
export function durationLabel(value: unknown): string {
  if (typeof value !== "string") return showValue(value);
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match) return showValue(value);
  const amount = Number(match[1]);
  const names = UNIT_NAMES[match[2]!]!;
  return `${amount} ${amount === 1 ? names[0] : names[1]}`;
}

function fieldLabel(path: unknown): string {
  if (typeof path !== "string") return showValue(path);
  return fieldPathName(path);
}

/** One filter or rule: "subject contiene «preventivo»". */
export function describeCondition(input: { field?: unknown; operator?: unknown; value?: unknown }): string {
  const operator = OPERATORS[String(input.operator)] ?? String(input.operator ?? "?");
  const field = fieldLabel(input.field);
  if (input.operator === "exists" || input.operator === "not_exists") return `${field} ${operator}`;
  return `${field} ${operator} «${showValue(input.value, 60)}»`;
}

/** "Mail ricevuta, se subject contiene «preventivo»". */
export function describeTrigger(trigger: FlowDefinition["trigger"], names: DescribeNames = {}): string {
  const parts = [eventTitle(trigger.event)];
  if (trigger.connection) {
    parts.push(`dal collegamento ${names.connections?.get(trigger.connection) ?? "indicato"}`);
  }
  const filters = trigger.filters ?? [];
  if (filters.length) parts.push(`se ${filters.map(describeCondition).join(" e ")}`);
  return parts.join(", ");
}

function channelName(value: unknown): string {
  return CHANNELS[String(value)] ?? String(value);
}

function stageName(value: unknown, names: DescribeNames): string {
  if (typeof value !== "string") return showValue(value);
  return `«${names.stages?.get(value) ?? humanizeRefs(value, names)}»`;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** One-line Italian summary of what a step does with its parameters. Never throws on odd params. */
export function describeStep(step: Pick<Step, "block" | "params">, names: DescribeNames = {}): string {
  const p = record(step.params);
  const show = (value: unknown, max = MAX_TEXT) => showValue(value, max, names);
  const quoted = (value: unknown, max = MAX_TEXT) => `«${show(value, max)}»`;
  const recipient = (to: unknown) =>
    to === undefined || to === null || to === "" ? "al contatto" : `a ${show(to, 60)}`;
  switch (step.block) {
    case "logic.condition": {
      const operator = OPERATORS[String(p.operator)] ?? String(p.operator ?? "?");
      if (p.operator === "exists" || p.operator === "not_exists") {
        return `Controlla se ${show(p.left, 60)} ${operator}`;
      }
      return `Controlla se ${show(p.left, 60)} ${operator} ${quoted(p.right, 60)}`;
    }
    case "logic.switch": {
      const cases = list(p.cases);
      return `Sceglie la strada in base a ${show(p.value, 60)} (${cases.length} ${cases.length === 1 ? "caso" : "casi"})`;
    }
    case "logic.for_each":
      return `Per ogni elemento di ${show(p.items, 60)} avvia l'evento interno «${String(p.emitEvent ?? "?").replace(/^custom\./, "")}»${typeof p.limit === "number" ? ` (al massimo ${p.limit})` : ""}`;
    case "wait.delay":
      return `Aspetta ${durationLabel(p.duration)}`;
    case "wait.for_reply":
      return `Aspetta la risposta del contatto${p.channel ? ` su ${channelName(p.channel)}` : ""} per al massimo ${durationLabel(p.timeout)}`;
    case "contact.upsert": {
      const keys = [p.name, p.phone, p.email].filter((item) => item !== undefined && item !== "");
      const consent = record(p.consent);
      return `Cerca il contatto e lo crea se manca${keys.length ? ` (${keys.map((item) => show(item, 40)).join(", ")})` : ""}${consent.channel ? `; registra il consenso per ${channelName(consent.channel)}` : ""}`;
    }
    case "contact.find_matching": {
      const rules = list(p.rules).map((rule) => describeCondition(record(rule)));
      return `Cerca i contatti con ${rules.join(" e ") || "le regole indicate"}${typeof p.limit === "number" ? ` (al massimo ${p.limit})` : ""}`;
    }
    case "deal.create":
      return `Apre la trattativa ${quoted(p.title, 70)}${p.stage ? ` nella fase ${stageName(p.stage, names)}` : ""}${p.value !== undefined ? `, valore ${show(p.value, 30)}` : ""}`;
    case "deal.update_stage":
      return `Sposta la trattativa nella fase ${stageName(p.stage, names)}`;
    case "crm.read":
      return `Legge ${quoted(p.resource, 40)} dal gestionale`;
    case "crm.write":
      return `${p.id ? "Aggiorna" : "Crea"} un record in ${quoted(p.resource, 40)} sul gestionale`;
    case "whatsapp.send_template":
      return `Invia su WhatsApp il modello ${quoted(p.template, 50)} ${recipient(p.to)}`;
    case "whatsapp.send_text":
      return `Invia su WhatsApp ${recipient(p.to)}: ${quoted(p.text)}`;
    case "mail.send":
      return `Invia una mail ${recipient(p.to)} con oggetto ${quoted(p.subject, 70)}`;
    case "sms.send":
      return `Invia un SMS ${recipient(p.to)}: ${quoted(p.text)}`;
    case "social.send_message":
      return `Risponde in privato sui social ${recipient(p.to)}: ${quoted(p.text)}`;
    case "social.publish_post":
      return `Pubblica un post: ${quoted(p.text)}`;
    case "human.request_approval":
      return `Chiede l'approvazione di una persona: ${quoted(p.summary, 80)} (scade dopo ${durationLabel(p.timeout ?? "48h")})`;
    case "human.handoff":
      return `Passa la conversazione a una persona${p.note ? `: ${quoted(p.note, 80)}` : ""}`;
    case "human.notify_owner":
      return `Avvisa il titolare${p.via && p.via !== "app" ? ` su ${channelName(p.via)}` : " nell'app"}: ${quoted(p.message, 80)}`;
    case "ai.extract": {
      const fields = list(p.fields).map((field) => fieldName(String(record(field).name ?? "?")));
      return `Ricava dal testo: ${fields.join(", ") || "i campi indicati"}`;
    }
    case "ai.classify": {
      const categories = list(p.categories).map((item) => String(record(item).key ?? "?"));
      return `Classifica il testo tra: ${categories.join(", ") || "le categorie indicate"}`;
    }
    case "ai.reply":
      return `Conversa con il contatto (al massimo ${show(p.maxTurns ?? 6)} scambi) su: ${show(p.scope, 110)}`;
    case "ai.summarize":
      return `Riassume in al massimo ${show(p.maxWords ?? 80)} parole`;
    case "calendar.find_slots":
      return `Cerca fino a ${show(p.max ?? 3)} orari liberi da ${show(p.durationMinutes ?? 30)} minuti nei prossimi ${show(p.days ?? 7)} giorni`;
    case "calendar.create_event":
      return `Fissa l'appuntamento ${quoted(p.title, 70)} (${show(p.start, 40)})`;
    case "payment.request":
      return `Crea un link di pagamento di ${show(p.amount, 30)} €: ${quoted(p.description, 70)}`;
    case "signature.request":
      return `Invia da firmare ${quoted(p.title, 70)}`;
    default:
      return getBlock(step.block)?.description ?? `Blocco sconosciuto «${step.block}»`;
  }
}

/** Title of a step's block, or the raw key when it is not in the catalog. */
export function blockTitle(blockKey: string): string {
  return getBlock(blockKey)?.title ?? blockKey;
}
