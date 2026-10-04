import { z } from "zod";

export const SECTORS = ["insurance", "ecommerce", "real_estate", "other"] as const;
export type Sector = (typeof SECTORS)[number];

export const ROLES = ["platform_admin", "reseller_admin", "org_owner", "org_member"] as const;
export type Role = (typeof ROLES)[number];

export const CHANNELS = ["whatsapp", "mail", "sms", "social"] as const;
export const ChannelSchema = z.enum(CHANNELS);
export type Channel = z.infer<typeof ChannelSchema>;

export const CONNECTOR_CATEGORIES = [
  "mail",
  "whatsapp",
  "crm",
  "social",
  "scraper",
  "sms",
  "calendar",
  "payment",
  "signature",
] as const;
export type ConnectorCategory = (typeof CONNECTOR_CATEGORIES)[number];

export const CONNECTION_STATUSES = ["active", "expired", "error", "disconnected"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const FLOW_STATUSES = ["draft", "active", "paused"] as const;
export type FlowStatus = (typeof FLOW_STATUSES)[number];

export const RUN_MODES = ["live", "simulation"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const RUN_STATUSES = ["running", "waiting", "completed", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Metrics counted in `usage_counters` and limited by `plans.limits`. */
export const USAGE_METRICS = ["messages", "ai_credits", "flow_runs", "scrape_runs"] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export interface PlanLimits {
  active_flows: number;
  messages_per_month: number;
  scrape_runs_per_month: number;
  ai_credits_per_month: number;
}

/** Consent for one channel, stored in `contacts.consents[channel]`. */
export interface ChannelConsent {
  granted: boolean;
  at: string;
  source: string;
}
export type ContactConsents = Partial<Record<Channel, ChannelConsent>>;

export function hasValidConsent(consents: ContactConsents | null | undefined, channel: Channel): boolean {
  return consents?.[channel]?.granted === true;
}
