/**
 * Feature flags per organization (`org_features`). The table only stores
 * exceptions: a feature without a row uses `defaultEnabled`.
 * Add a key here before reading it anywhere, so the admin page can toggle it.
 */
export interface FeatureDefinition {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

export const KNOWN_FEATURES: readonly FeatureDefinition[] = [
  {
    key: "flow_assistant",
    label: "Assistente IA dei flussi",
    description: "Il cliente può creare e modificare i flussi descrivendoli a parole.",
    defaultEnabled: true,
  },
  {
    key: "flow_editor",
    label: "Modifica dei flussi",
    description: "Il cliente può modificare i propri flussi. Se spento, li vede soltanto.",
    defaultEnabled: true,
  },
  {
    key: "scraping",
    label: "Lettura da siti e portali",
    description: "Collegamenti di tipo «Sito o portale» e flussi che partono dalle novità lette.",
    defaultEnabled: true,
  },
  {
    key: "inbox",
    label: "Inbox",
    description: "Conversazioni di tutti i canali e presa in carico da operatore.",
    defaultEnabled: true,
  },
  {
    key: "deals",
    label: "Trattative",
    description: "Vista a colonne delle trattative.",
    defaultEnabled: true,
  },
  {
    key: "reports",
    label: "Report",
    description: "Risultati e ritorno economico.",
    defaultEnabled: true,
  },
  {
    key: "social",
    label: "Canali social",
    description: "Facebook, Instagram e GoHighLevel come collegamenti e canali di invio.",
    defaultEnabled: false,
  },
  {
    key: "payments_signature",
    label: "Pagamenti e firma",
    description: "Link di pagamento e documenti da firmare dentro i flussi.",
    defaultEnabled: false,
  },
];

/** Resolves one flag from the organization's `org_features` rows. Unknown keys are off. */
export function isFeatureEnabled(
  rows: readonly { feature_key: string; enabled: boolean }[],
  key: string,
): boolean {
  const stored = rows.find((r) => r.feature_key === key);
  if (stored) return stored.enabled;
  return KNOWN_FEATURES.find((f) => f.key === key)?.defaultEnabled ?? false;
}
