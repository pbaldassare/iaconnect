import type { PlanLimits } from "@ia-connect/core";

/** The four limits of a plan, in the order shown in the form. */
export const LIMIT_FIELDS: readonly { key: keyof PlanLimits; label: string }[] = [
  { key: "active_flows", label: "Flussi attivi" },
  { key: "messages_per_month", label: "Messaggi al mese" },
  { key: "ai_credits_per_month", label: "Crediti IA al mese" },
  { key: "scrape_runs_per_month", label: "Letture da siti al mese" },
];
