import { z } from "zod";
import { CHANNELS, type ConnectorCategory } from "../domain.ts";
import { isDuration } from "../duration.ts";
import { FILTER_OPERATORS, type Outlet } from "./schema.ts";

/**
 * The block catalog. Every block is our own tested code; a flow can only
 * reference keys listed here. Param values may contain `{{path}}` templates,
 * so numeric params also accept strings.
 */
export type BlockCategory = "logic" | "data" | "channel" | "people" | "ai" | "calendar" | "payment";

export interface BlockDefinition {
  key: string;
  category: BlockCategory;
  /** Italian, shown in the UI and given to the flow assistant. */
  title: string;
  description: string;
  params: z.ZodType;
  outlets: readonly Outlet[];
  /** AI blocks are declared, metered and quota-checked. */
  usesAi: boolean;
  /** none = pure; internal = writes our tables; external = leaves the platform (skipped in simulation). */
  effect: "none" | "internal" | "external";
  /** Connector category that must have an active connection. */
  requires?: ConnectorCategory;
  /** Usage metric consumed by each execution. */
  consumes?: "messages" | "ai_credits";
  /** Channel whose consent must be valid before sending to the contact. */
  consentChannel?: (typeof CHANNELS)[number];
  /** Names of the output fields, for `{{steps.<id>.output.<field>}}`. */
  output: readonly string[];
}

const Text = z.string().min(1);
const OptionalText = z.string().optional();
const NumberOrTemplate = z.union([z.number(), z.string().min(1)]);
const Duration = z.string().refine(isDuration, 'Durata non valida: usa ad esempio "30m", "48h", "2d"');
const ConnectionRef = z.string().uuid().optional();
const Fields = z.record(z.string(), z.unknown());

const defs: BlockDefinition[] = [
  // ── Logic ────────────────────────────────────────────────────────────
  {
    key: "logic.condition",
    category: "logic",
    title: "Condizione",
    description: "Confronta un valore e prosegue su onTrue oppure onFalse.",
    params: z.object({
      left: z.unknown(),
      operator: z.enum(FILTER_OPERATORS),
      right: z.unknown().optional(),
    }),
    outlets: ["onTrue", "onFalse"],
    usesAi: false,
    effect: "none",
    output: ["result"],
  },
  {
    key: "logic.switch",
    category: "logic",
    title: "Diramazione",
    description:
      "Sceglie il passo successivo in base al valore. Senza corrispondenza usa `default` o prosegue.",
    params: z.object({
      value: z.unknown(),
      cases: z.array(z.object({ equals: z.unknown(), goto: Text })).min(1),
      default: OptionalText,
    }),
    outlets: ["next"],
    usesAi: false,
    effect: "none",
    output: ["matched"],
  },
  {
    key: "logic.for_each",
    category: "logic",
    title: "Ciclo su elenco",
    description:
      "Per ogni elemento dell'elenco emette un evento `custom.*`. Un altro flusso con quel trigger gestisce ogni elemento con la propria esecuzione.",
    params: z.object({
      items: z.unknown(),
      emitEvent: z.string().regex(/^custom\.[a-z0-9_.]+$/, "L'evento deve iniziare con custom."),
      payload: Fields.default({}),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    outlets: ["next"],
    usesAi: false,
    effect: "internal",
    output: ["emitted"],
  },
  {
    key: "wait.delay",
    category: "logic",
    title: "Attesa",
    description: "Sospende il flusso per la durata indicata.",
    params: z.object({ duration: Duration }),
    outlets: ["next"],
    usesAi: false,
    effect: "none",
    output: [],
  },
  {
    key: "wait.for_reply",
    category: "logic",
    title: "Attesa di risposta",
    description: "Attende un messaggio del contatto. Prosegue su onReply, oppure su onTimeout alla scadenza.",
    params: z.object({ timeout: Duration, channel: z.enum(CHANNELS).optional() }),
    outlets: ["onReply", "onTimeout"],
    usesAi: false,
    effect: "none",
    output: ["text", "messageId"],
  },
  // ── Data ─────────────────────────────────────────────────────────────
  {
    key: "contact.upsert",
    category: "data",
    title: "Crea o aggiorna contatto",
    description: "Cerca il contatto per telefono o mail; lo crea se manca. Può registrare un consenso.",
    params: z.object({
      name: OptionalText,
      phone: OptionalText,
      email: OptionalText,
      fields: Fields.optional(),
      consent: z.object({ channel: z.enum(CHANNELS), source: Text }).optional(),
    }),
    outlets: ["next"],
    usesAi: false,
    effect: "internal",
    output: ["contactId", "created"],
  },
  {
    key: "contact.find_matching",
    category: "data",
    title: "Trova contatti corrispondenti",
    description: "Elenca i contatti i cui campi extra rispettano tutte le regole (es. zona, budget).",
    params: z.object({
      rules: z
        .array(z.object({ field: Text, operator: z.enum(FILTER_OPERATORS), value: z.unknown().optional() }))
        .min(1),
      limit: z.number().int().min(1).max(500).default(50),
    }),
    outlets: ["next"],
    usesAi: false,
    effect: "none",
    output: ["contacts", "count"],
  },
  {
    key: "deal.create",
    category: "data",
    title: "Crea trattativa",
    description: "Apre una trattativa per il contatto del flusso.",
    params: z.object({
      title: Text,
      stage: OptionalText,
      value: NumberOrTemplate.optional(),
      nextAction: OptionalText,
      fields: Fields.optional(),
    }),
    outlets: ["next"],
    usesAi: false,
    effect: "internal",
    output: ["dealId"],
  },
  {
    key: "deal.update_stage",
    category: "data",
    title: "Cambia fase della trattativa",
    description: "Sposta la trattativa del flusso in un'altra fase.",
    params: z.object({ stage: Text, nextAction: OptionalText }),
    outlets: ["next"],
    usesAi: false,
    effect: "internal",
    output: ["dealId", "stage"],
  },
  {
    key: "crm.read",
    category: "data",
    title: "Leggi dal gestionale",
    description: "Legge record dal gestionale o dal database collegato.",
    params: z.object({ connection: ConnectionRef, resource: Text, query: Fields.default({}) }),
    outlets: ["next"],
    usesAi: false,
    effect: "none",
    requires: "crm",
    output: ["records", "count"],
  },
  {
    key: "crm.write",
    category: "data",
    title: "Scrivi sul gestionale",
    description: "Crea o aggiorna un record nel gestionale collegato.",
    params: z.object({ connection: ConnectionRef, resource: Text, id: OptionalText, data: Fields }),
    outlets: ["next"],
    usesAi: false,
    effect: "external",
    requires: "crm",
    output: ["id"],
  },
  // ── Channels ─────────────────────────────────────────────────────────
  {
    key: "whatsapp.send_template",
    category: "channel",
    title: "Invia WhatsApp da modello",
    description: "Invia un modello approvato. È l'unico invio ammesso fuori dalla finestra di 24 ore.",
    params: z.object({
      connection: ConnectionRef,
      template: Text,
      variables: z.record(z.string(), z.unknown()).default({}),
      to: OptionalText,
    }),
    outlets: ["next"],
    usesAi: false,
    effect: "external",
    requires: "whatsapp",
    consumes: "messages",
    consentChannel: "whatsapp",
    output: ["messageId"],
  },
  {
    key: "whatsapp.send_text",
    category: "channel",
    title: "Invia WhatsApp libero",
    description: "Invia testo libero. Ammesso solo con la finestra di 24 ore aperta.",
    params: z.object({ connection: ConnectionRef, text: Text, to: OptionalText }),
    outlets: ["next"],
    usesAi: false,
    effect: "external",
    requires: "whatsapp",
    consumes: "messages",
    consentChannel: "whatsapp",
    output: ["messageId"],
  },
  {
    key: "mail.send",
    category: "channel",
    title: "Invia mail",
    description: "Invia una mail dal mittente dell'azienda.",
    params: z.object({ connection: ConnectionRef, to: OptionalText, subject: Text, body: Text }),
    outlets: ["next"],
    usesAi: false,
    effect: "external",
    requires: "mail",
    consumes: "messages",
    consentChannel: "mail",
    output: ["messageId"],
  },
  {
    key: "sms.send",
    category: "channel",
    title: "Invia SMS",
    description: "Invia un SMS al contatto.",
    params: z.object({ connection: ConnectionRef, text: Text, to: OptionalText }),
    outlets: ["next"],
    usesAi: false,
    effect: "external",
    requires: "sms",
    consumes: "messages",
    consentChannel: "sms",
    output: ["messageId"],
  },
  {
    key: "social.send_message",
    category: "channel",
    title: "Invia messaggio social",
    description: "Risponde in privato su Facebook o Instagram.",
    params: z.object({ connection: ConnectionRef, text: Text, to: OptionalText }),
    outlets: ["next"],
    usesAi: false,
    effect: "external",
    requires: "social",
    consumes: "messages",
    consentChannel: "social",
    output: ["messageId"],
  },
  {
    key: "social.publish_post",
    category: "channel",
    title: "Pubblica post social",
    description: "Pubblica un post sulla pagina dell'azienda.",
    params: z.object({ connection: ConnectionRef, text: Text, mediaUrl: OptionalText }),
    outlets: ["next"],
    usesAi: false,
    effect: "external",
    requires: "social",
    output: ["postId"],
  },
  // ── People ───────────────────────────────────────────────────────────
  {
    key: "human.request_approval",
    category: "people",
    title: "Richiesta di approvazione",
    description: "Ferma il flusso finché una persona approva o rifiuta.",
    params: z.object({ summary: Text, timeout: Duration.default("48h") }),
    outlets: ["onApproved", "onRejected", "onTimeout"],
    usesAi: false,
    effect: "internal",
    output: ["approvalId", "decision"],
  },
  {
    key: "human.handoff",
    category: "people",
    title: "Passaggio a operatore",
    description: "Assegna la conversazione a una persona e chiude l'automazione su quella conversazione.",
    params: z.object({ note: OptionalText }),
    outlets: ["next"],
    usesAi: false,
    effect: "internal",
    output: [],
  },
  {
    key: "human.notify_owner",
    category: "people",
    title: "Avviso al titolare",
    description: "Avvisa il titolare nell'applicazione e, se richiesto, su WhatsApp o mail.",
    params: z.object({ message: Text, via: z.enum(["app", "whatsapp", "mail"]).default("app") }),
    outlets: ["next"],
    usesAi: false,
    effect: "internal",
    output: ["notificationId"],
  },
  // ── AI (declared, metered) ───────────────────────────────────────────
  {
    key: "ai.extract",
    category: "ai",
    title: "IA: estrai dati dal testo",
    description: "Legge un testo libero e ne ricava i campi richiesti.",
    params: z.object({
      text: Text,
      fields: z
        .array(
          z.object({
            name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
            type: z.enum(["string", "number", "boolean", "date"]).default("string"),
            description: OptionalText,
            required: z.boolean().default(false),
          }),
        )
        .min(1)
        .max(30),
      instructions: OptionalText,
    }),
    outlets: ["next"],
    usesAi: true,
    effect: "none",
    consumes: "ai_credits",
    output: ["data", "missing"],
  },
  {
    key: "ai.classify",
    category: "ai",
    title: "IA: classifica",
    description: "Assegna il testo a una delle categorie indicate.",
    params: z.object({
      text: Text,
      categories: z
        .array(z.object({ key: Text, description: OptionalText }))
        .min(2)
        .max(20),
    }),
    outlets: ["next"],
    usesAi: true,
    effect: "none",
    consumes: "ai_credits",
    output: ["category"],
  },
  {
    key: "ai.reply",
    category: "ai",
    title: "IA: rispondi al contatto",
    description:
      "Conversa con il contatto in un ambito chiuso. Esce su `next` a conversazione conclusa, su onHandoff oltre il limite di turni o fuori ambito, su onTimeout se il contatto tace.",
    params: z.object({
      scope: Text,
      maxTurns: z.number().int().min(1).max(20).default(6),
      idleTimeout: Duration.default("24h"),
      /** Read-only CRM resources the model may query. */
      readResources: z
        .array(z.object({ connection: ConnectionRef, resource: Text, description: Text }))
        .default([]),
      channel: z.enum(CHANNELS).optional(),
    }),
    outlets: ["next", "onHandoff", "onTimeout"],
    usesAi: true,
    effect: "external",
    consumes: "ai_credits",
    output: ["turns", "outcome", "lastReply"],
  },
  {
    key: "ai.summarize",
    category: "ai",
    title: "IA: riassumi",
    description: "Riassume un testo o la conversazione in corso.",
    params: z.object({ text: Text, maxWords: z.number().int().min(10).max(500).default(80) }),
    outlets: ["next"],
    usesAi: true,
    effect: "none",
    consumes: "ai_credits",
    output: ["summary"],
  },
  // ── Calendar, payments, signature ────────────────────────────────────
  {
    key: "calendar.find_slots",
    category: "calendar",
    title: "Trova orari liberi",
    description: "Legge il calendario collegato e propone orari liberi.",
    params: z.object({
      connection: ConnectionRef,
      durationMinutes: z.number().int().min(10).max(480).default(30),
      days: z.number().int().min(1).max(30).default(7),
      max: z.number().int().min(1).max(10).default(3),
    }),
    outlets: ["next"],
    usesAi: false,
    effect: "none",
    requires: "calendar",
    output: ["slots"],
  },
  {
    key: "calendar.create_event",
    category: "calendar",
    title: "Crea appuntamento",
    description: "Fissa un appuntamento nel calendario collegato.",
    params: z.object({
      connection: ConnectionRef,
      title: Text,
      start: Text,
      end: Text,
      location: OptionalText,
    }),
    outlets: ["next"],
    usesAi: false,
    effect: "external",
    requires: "calendar",
    output: ["appointmentId", "externalEventId"],
  },
  {
    key: "payment.request",
    category: "payment",
    title: "Richiesta di pagamento",
    description: "Crea un link di pagamento per il contatto.",
    params: z.object({ connection: ConnectionRef, amount: NumberOrTemplate, description: Text }),
    outlets: ["next"],
    usesAi: false,
    effect: "external",
    requires: "payment",
    output: ["paymentRequestId", "url"],
  },
  {
    key: "signature.request",
    category: "payment",
    title: "Richiesta di firma",
    description: "Invia un documento da firmare.",
    params: z.object({ connection: ConnectionRef, documentUrl: Text, title: Text }),
    outlets: ["next"],
    usesAi: false,
    effect: "external",
    requires: "signature",
    output: ["signatureRequestId", "url"],
  },
];

export const BLOCK_CATALOG: ReadonlyMap<string, BlockDefinition> = new Map(defs.map((def) => [def.key, def]));

export function getBlock(key: string): BlockDefinition | undefined {
  return BLOCK_CATALOG.get(key);
}

export function listBlocks(): BlockDefinition[] {
  return [...BLOCK_CATALOG.values()];
}

/** Catalog as plain JSON (with JSON Schema params) for the flow assistant and the UI. */
export function describeCatalog() {
  return listBlocks().map((block) => ({
    key: block.key,
    category: block.category,
    title: block.title,
    description: block.description,
    outlets: block.outlets,
    usesAi: block.usesAi,
    requires: block.requires ?? null,
    output: block.output,
    params: z.toJSONSchema(block.params, { io: "input", unrepresentable: "any" }),
  }));
}
