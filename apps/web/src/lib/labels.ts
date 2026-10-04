/**
 * Italian labels and semantic tones for the status values stored in the
 * database. Use them with <StatusPill tone=… /> so the same status always
 * looks the same. Unknown values fall back to the raw value, neutral.
 */
export type Tone = "ok" | "warning" | "error" | "neutral" | "ai";

export interface StatusInfo {
  label: string;
  tone: Tone;
}

function lookup(map: Record<string, StatusInfo>, value: string | null | undefined): StatusInfo {
  if (!value) return { label: "—", tone: "neutral" };
  return map[value] ?? { label: value, tone: "neutral" };
}

const CONNECTION: Record<string, StatusInfo> = {
  active: { label: "Attivo", tone: "ok" },
  expired: { label: "Scaduto", tone: "warning" },
  error: { label: "In errore", tone: "error" },
  disconnected: { label: "Scollegato", tone: "neutral" },
};
const FLOW: Record<string, StatusInfo> = {
  draft: { label: "Bozza", tone: "neutral" },
  active: { label: "Attivo", tone: "ok" },
  paused: { label: "In pausa", tone: "warning" },
};
const RUN: Record<string, StatusInfo> = {
  running: { label: "In corso", tone: "ok" },
  waiting: { label: "In attesa", tone: "neutral" },
  completed: { label: "Completata", tone: "ok" },
  failed: { label: "Fallita", tone: "error" },
  cancelled: { label: "Annullata", tone: "neutral" },
};
const QUEUE: Record<string, StatusInfo> = {
  pending: { label: "In coda", tone: "neutral" },
  processing: { label: "In lavorazione", tone: "ok" },
  running: { label: "In lavorazione", tone: "ok" },
  processed: { label: "Elaborato", tone: "ok" },
  done: { label: "Fatto", tone: "ok" },
  ignored: { label: "Ignorato", tone: "neutral" },
  failed: { label: "Fallito", tone: "error" },
  cancelled: { label: "Annullato", tone: "neutral" },
};
const ORGANIZATION: Record<string, StatusInfo> = {
  active: { label: "Attiva", tone: "ok" },
  suspended: { label: "Sospesa", tone: "warning" },
};
const INVITATION: Record<string, StatusInfo> = {
  pending: { label: "In attesa", tone: "warning" },
  accepted: { label: "Accettato", tone: "ok" },
  revoked: { label: "Revocato", tone: "neutral" },
};
const SCRAPE_RECIPE: Record<string, StatusInfo> = {
  draft: { label: "Bozza", tone: "neutral" },
  active: { label: "Attiva", tone: "ok" },
  paused: { label: "In pausa", tone: "warning" },
  broken: { label: "Da riparare", tone: "error" },
};

export const connectionStatus = (value: string | null | undefined) => lookup(CONNECTION, value);
export const flowStatus = (value: string | null | undefined) => lookup(FLOW, value);
export const runStatus = (value: string | null | undefined) => lookup(RUN, value);
/** Status of `events` and `scheduled_jobs`. */
export const queueStatus = (value: string | null | undefined) => lookup(QUEUE, value);
export const organizationStatus = (value: string | null | undefined) => lookup(ORGANIZATION, value);
export const invitationStatus = (value: string | null | undefined) => lookup(INVITATION, value);
export const scrapeRecipeStatus = (value: string | null | undefined) => lookup(SCRAPE_RECIPE, value);

const SECTOR: Record<string, string> = {
  insurance: "Assicurazioni",
  ecommerce: "E-commerce",
  real_estate: "Immobiliare",
  other: "Altro",
};
export const sectorLabel = (value: string | null | undefined) => (value ? (SECTOR[value] ?? value) : "—");

const ROLE: Record<string, string> = {
  platform_admin: "Amministratore della piattaforma",
  reseller_admin: "Amministratore del rivenditore",
  org_owner: "Titolare",
  org_member: "Collaboratore",
};
export const roleLabel = (value: string | null | undefined) => (value ? (ROLE[value] ?? value) : "—");

const CONNECTOR_CATEGORY: Record<string, string> = {
  mail: "Mail",
  whatsapp: "WhatsApp",
  crm: "Gestionale",
  social: "Social",
  scraper: "Siti e portali",
  sms: "SMS",
  calendar: "Calendario",
  payment: "Pagamenti",
  signature: "Firma",
};
export const connectorCategoryLabel = (value: string | null | undefined) =>
  value ? (CONNECTOR_CATEGORY[value] ?? value) : "—";

const BLOCK_CATEGORY: Record<string, string> = {
  logic: "Logica",
  data: "Dati",
  channel: "Canali",
  people: "Persone",
  ai: "Intelligenza artificiale",
  calendar: "Calendario",
  payment: "Pagamenti e firma",
};
export const blockCategoryLabel = (value: string) => BLOCK_CATEGORY[value] ?? value;

const AI_PURPOSE: Record<string, string> = {
  flow_assistant: "Assistente dei flussi",
  scrape_trace: "Tracciatura di un sito",
  scrape_repair: "Riparazione di una lettura",
  "ai.extract": "Estrazione dati",
  "ai.classify": "Classificazione",
  "ai.reply": "Risposte ai clienti",
  "ai.summarize": "Riassunti",
  report: "Report",
};
export const aiPurposeLabel = (value: string) => AI_PURPOSE[value] ?? value;
