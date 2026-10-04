/** Readable Italian descriptions of `audit_log` rows. Pure, unit tested. */

const ENTITY: Record<string, string> = {
  organizations: "Azienda",
  memberships: "Utente dell'azienda",
  invitations: "Invito",
  org_settings: "Personalizzazioni",
  org_features: "Funzione",
  connections: "Collegamento",
  flows: "Flusso",
  flow_versions: "Versione di un flusso",
  message_templates: "Modello di messaggio",
  deal_stages: "Fase delle trattative",
  deals: "Trattativa",
  contacts: "Contatto",
  scrape_recipes: "Lettura da sito",
  approvals: "Approvazione",
  support_sessions: "Accesso in assistenza",
  messages: "Messaggio",
  access_requests: "Richiesta di accesso",
};

const OPERATION: Record<string, string> = {
  insert: "creazione",
  update: "modifica",
  delete: "eliminazione",
};

/** Explicit actions written through lib/audit.ts (not by the database triggers). */
const EXPLICIT: Record<string, string> = {
  "organization.export": "Esportazione dei dati dell'azienda",
  "contact.export": "Esportazione dei dati di un contatto",
  "organization.invite_sent": "Invito inviato via mail",
  "support.enter": "Ingresso in assistenza",
  "support.exit": "Uscita dall'assistenza",
  "flow.test_event": "Evento di prova inserito per un flusso",
  // Written by the database function decide_access_request.
  "access_request.approve": "Richiesta di accesso approvata: azienda creata",
  "access_request.reject": "Richiesta di accesso rifiutata",
};

/** Jobs requested for the worker through lib/jobs.ts (`job.<kind>`). */
const JOB: Record<string, string> = {
  send_message: "invio di un messaggio",
  approval_decided: "decisione su un'approvazione",
  simulate_flow: "simulazione di un flusso",
  scrape_run: "lettura di un sito",
  scrape_trace: "tracciatura di un sito",
  verify_connection: "verifica di un collegamento",
};

export function describeAuditAction(action: string): string {
  const explicit = EXPLICIT[action];
  if (explicit) return explicit;
  if (action.startsWith("job.")) {
    const kind = action.slice(4);
    return `Richiesta al motore: ${JOB[kind] ?? kind}`;
  }
  if (action === "support_sessions.insert") return "Accesso in assistenza: inizio";
  if (action === "support_sessions.update") return "Accesso in assistenza: fine";
  const [table, operation] = action.split(".");
  const entity = table ? ENTITY[table] : undefined;
  const op = operation ? OPERATION[operation] : undefined;
  if (entity && op) return `${entity}: ${op}`;
  return action;
}

const ACTOR: Record<string, string> = {
  user: "Utente dell'azienda",
  admin: "Assistenza",
  automation: "Automazione",
  system: "Sistema",
};
export const AUDIT_ACTOR_TYPES = ["user", "admin", "automation", "system"] as const;
export function actorTypeLabel(value: string): string {
  return ACTOR[value] ?? value;
}

/**
 * True for rows the customer must be able to spot: anything done by platform
 * or reseller staff inside the organization, and the support sessions themselves.
 */
export function isSupportRow(row: {
  is_support_access: boolean;
  entity_type: string | null;
  action: string;
}): boolean {
  return row.is_support_access || row.entity_type === "support_sessions" || row.action.startsWith("support.");
}

/** Field names changed by an update, from the `data.changed` array written by the trigger. */
export function changedFields(data: unknown): string[] {
  if (typeof data !== "object" || data === null) return [];
  const changed = (data as Record<string, unknown>).changed;
  return Array.isArray(changed) ? changed.filter((v): v is string => typeof v === "string") : [];
}
