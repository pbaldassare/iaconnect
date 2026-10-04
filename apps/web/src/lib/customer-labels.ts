/**
 * Italian labels for the customer sections (inbox, contacts, deals, settings).
 * Pure: kept apart from lib/labels.ts so the two can change independently.
 */
import type { StatusInfo } from "./labels";

export const CHANNEL_KEYS = ["whatsapp", "mail", "sms", "social"] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

const CHANNEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  mail: "Mail",
  sms: "SMS",
  social: "Social",
};
export const channelLabel = (value: string | null | undefined) => (value ? (CHANNEL[value] ?? value) : "—");
export function isChannel(value: unknown): value is ChannelKey {
  return typeof value === "string" && (CHANNEL_KEYS as readonly string[]).includes(value);
}

function lookup(map: Record<string, StatusInfo>, value: string | null | undefined): StatusInfo {
  if (!value) return { label: "—", tone: "neutral" };
  return map[value] ?? { label: value, tone: "neutral" };
}

const DELIVERY: Record<string, StatusInfo> = {
  queued: { label: "In coda", tone: "neutral" },
  sent: { label: "Inviato", tone: "neutral" },
  delivered: { label: "Consegnato", tone: "ok" },
  read: { label: "Letto", tone: "ok" },
  failed: { label: "Non riuscito", tone: "error" },
  received: { label: "Ricevuto", tone: "neutral" },
  simulated: { label: "Simulato", tone: "neutral" },
};
export const deliveryStatus = (value: string | null | undefined) => lookup(DELIVERY, value);

const TEMPLATE_APPROVAL: Record<string, StatusInfo> = {
  draft: { label: "Bozza", tone: "neutral" },
  pending: { label: "In approvazione", tone: "warning" },
  approved: { label: "Approvato", tone: "ok" },
  rejected: { label: "Rifiutato", tone: "error" },
};
export const TEMPLATE_APPROVAL_KEYS = ["draft", "pending", "approved", "rejected"] as const;
export const templateApprovalStatus = (value: string | null | undefined) => lookup(TEMPLATE_APPROVAL, value);

const APPROVAL: Record<string, StatusInfo> = {
  pending: { label: "In attesa", tone: "warning" },
  approved: { label: "Approvata", tone: "ok" },
  rejected: { label: "Rifiutata", tone: "error" },
  expired: { label: "Scaduta", tone: "neutral" },
};
export const approvalStatus = (value: string | null | undefined) => lookup(APPROVAL, value);

const STAGE_KIND: Record<string, StatusInfo> = {
  open: { label: "Aperta", tone: "neutral" },
  won: { label: "Vinta", tone: "ok" },
  lost: { label: "Persa", tone: "error" },
};
export const STAGE_KINDS = ["open", "won", "lost"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];
export const stageKind = (value: string | null | undefined) => lookup(STAGE_KIND, value);

const CONVERSATION: Record<string, StatusInfo> = {
  open: { label: "Aperta", tone: "ok" },
  closed: { label: "Chiusa", tone: "neutral" },
};
export const conversationStatus = (value: string | null | undefined) => lookup(CONVERSATION, value);

const APPOINTMENT: Record<string, StatusInfo> = {
  booked: { label: "Fissato", tone: "ok" },
  cancelled: { label: "Annullato", tone: "neutral" },
  done: { label: "Svolto", tone: "neutral" },
};
export const appointmentStatus = (value: string | null | undefined) => lookup(APPOINTMENT, value);

const REQUEST: Record<string, StatusInfo> = {
  pending: { label: "In attesa", tone: "warning" },
  paid: { label: "Pagato", tone: "ok" },
  signed: { label: "Firmato", tone: "ok" },
  cancelled: { label: "Annullato", tone: "neutral" },
  simulated: { label: "Simulato", tone: "neutral" },
};
/** Status of `payment_requests` and `signature_requests`. */
export const requestStatus = (value: string | null | undefined) => lookup(REQUEST, value);

const DEAL_EVENT: Record<string, string> = {
  created: "Trattativa creata",
  stage_changed: "Cambio di fase",
  updated: "Dati modificati",
  note: "Nota",
};
export const dealEventLabel = (value: string) => DEAL_EVENT[value] ?? value;

const ACTOR: Record<string, string> = { user: "Una persona", admin: "Assistenza", automation: "Automazione" };
export const dealActorLabel = (value: string) => ACTOR[value] ?? value;

/** Only in-app paths are followed from a notification: anything else is ignored. */
export function safeInternalLink(link: string | null | undefined): string | null {
  if (!link) return null;
  return /^\/(?![/\\])[\w\-./?=&%#:@+~]*$/.test(link) ? link : null;
}
