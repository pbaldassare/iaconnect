import { CONNECTOR_CATEGORIES } from "@ia-connect/core";
import { isSecretField } from "./form-fields";

/**
 * Pure rules of the Collegamenti section: what the catalog offers, webhook
 * addresses, which generated secrets are shown once, readable errors.
 * Unit tested (apps/web/test/connections.test.ts).
 */

export type CatalogAvailability = "available" | "plan" | "coming";

export interface CatalogEntry {
  key: string;
  name: string;
  description: string;
  category: string;
  connectMode: string;
  /** available = can be connected now; plan = not in the organization's plan; coming = listed but not built yet. */
  availability: CatalogAvailability;
}

export interface CatalogGroup {
  category: string;
  entries: CatalogEntry[];
}

/**
 * Enabled connector types grouped by category, in the catalog's category order.
 * A type whose code is not in `implemented` is shown as "in arrivo".
 */
export function buildCatalog(
  types: readonly {
    key: string;
    name: string;
    description: string;
    category: string;
    connect_mode: string;
    allowed_plans: string[] | null;
    is_enabled: boolean;
  }[],
  planKey: string | null,
  implemented: ReadonlySet<string>,
  /** Categories switched off for the organization (feature flags). */
  blockedCategories: ReadonlySet<string> = new Set(),
): CatalogGroup[] {
  const groups = new Map<string, CatalogEntry[]>();
  for (const type of types) {
    if (!type.is_enabled) continue;
    const allowed =
      !blockedCategories.has(type.category) &&
      (type.allowed_plans === null || (planKey !== null && type.allowed_plans.includes(planKey)));
    const availability: CatalogAvailability = !implemented.has(type.key)
      ? "coming"
      : allowed
        ? "available"
        : "plan";
    const list = groups.get(type.category) ?? [];
    list.push({
      key: type.key,
      name: type.name,
      description: type.description,
      category: type.category,
      connectMode: type.connect_mode,
      availability,
    });
    groups.set(type.category, list);
  }
  const order = (category: string) => {
    const index = (CONNECTOR_CATEGORIES as readonly string[]).indexOf(category);
    return index === -1 ? CONNECTOR_CATEGORIES.length : index;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([category, entries]) => ({
      category,
      entries: entries.sort((a, b) => a.name.localeCompare(b.name, "it")),
    }));
}

/** Connector categories governed by a feature flag of `org_features` (lib/features.ts). */
const CATEGORY_FEATURES: Record<string, string> = {
  social: "social",
  scraper: "scraping",
  payment: "payments_signature",
  signature: "payments_signature",
};

/** Categories whose feature is off. `isEnabled` is `isFeatureEnabled` bound to the organization's rows. */
export function categoriesBlockedByFeatures(isEnabled: (featureKey: string) => boolean): Set<string> {
  const out = new Set<string>();
  for (const [category, feature] of Object.entries(CATEGORY_FEATURES)) {
    if (!isEnabled(feature)) out.add(category);
  }
  return out;
}

/** Base address of the webhook edge function: WEBHOOK_PUBLIC_URL, or the Supabase project's function. */
export function webhookBaseUrl(env: { webhookPublicUrl?: string; supabaseUrl: string }): string {
  const configured = env.webhookPublicUrl?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  return `${env.supabaseUrl.replace(/\/+$/, "")}/functions/v1/webhook`;
}

/** Webhook address of one connection: `<base>/c/<webhook_token>`. */
export function connectionWebhookUrl(base: string, webhookToken: string): string {
  return `${base}/c/${encodeURIComponent(webhookToken)}`;
}

/**
 * Secrets a connector generates by itself and the customer must copy into the
 * other system (see docs/moduli/connettori.md). Everything else in
 * `result.secrets` (tokens, passwords, keys typed by the customer) is never shown.
 */
const GENERATED_SECRETS: Record<string, { key: string; label: string; hint: string }[]> = {
  webhook_inbound: [
    {
      key: "signingSecret",
      label: "Segreto di firma",
      hint: "Serve a chi invia gli eventi per firmare ogni richiesta (intestazione x-ia-signature).",
    },
  ],
  signature_link: [
    {
      key: "signingSecret",
      label: "Segreto di firma",
      hint: "Serve per firmare la conferma di avvenuta firma (intestazione x-ia-signature).",
    },
  ],
  ghl_social: [
    {
      key: "webhookSecret",
      label: "Segreto del webhook",
      hint: "Va inserito nell'azione «Webhook» del workflow GoHighLevel, nell'intestazione x-ia-webhook-secret.",
    },
  ],
};

export interface RevealedSecret {
  label: string;
  hint: string;
  value: string;
}

/**
 * The generated secrets to show once after `connect`. A value the customer
 * typed in the form is not shown again: they already have it.
 */
export function revealableSecrets(
  connectorKey: string,
  input: Record<string, unknown>,
  secrets: Record<string, unknown>,
): RevealedSecret[] {
  const typed = new Set(Object.values(input).filter((value): value is string => typeof value === "string"));
  const out: RevealedSecret[] = [];
  for (const item of GENERATED_SECRETS[connectorKey] ?? []) {
    const value = secrets[item.key];
    if (typeof value !== "string" || !value || typed.has(value)) continue;
    out.push({ label: item.label, hint: item.hint, value });
  }
  return out;
}

/**
 * Last line of defence before `connections.config` is written: drops any entry
 * that looks like a credential or repeats a secret value. Connectors already
 * split config from secrets; this keeps a mistake there from reaching a
 * frontend-readable column.
 */
export function sanitizeConfig(
  config: Record<string, unknown>,
  secrets: Record<string, unknown>,
): Record<string, unknown> {
  const secretValues = new Set(
    Object.values(secrets).filter((value): value is string => typeof value === "string" && value !== ""),
  );
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;
    if (typeof value === "string" && (isSecretField(key) || secretValues.has(value))) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Entries of `connections.config` that `connector.connect` does not produce: the worker
 * (or the platform, after the row exists) writes them, and the worker reads them back.
 * - `cursor`: where the last poll stopped (`poll_connection`). Without it the next poll
 *   starts from scratch.
 * - `pollIntervalMinutes`: per-connection polling interval, set by the assistance.
 * - `statusCallbackUrl`: Twilio's delivery-status address (built from the webhook token).
 */
export const PLATFORM_CONFIG_KEYS = ["cursor", "pollIntervalMinutes", "statusCallbackUrl"] as const;

/**
 * The config to store when an existing connection is reconnected: what `connect` returned,
 * plus the platform's own entries of the previous config. The polling cursor is kept only
 * when the account is the same: on another account it would point nowhere.
 */
export function mergeReconnectConfig(
  previous: unknown,
  next: Record<string, unknown>,
  options: { sameAccount: boolean },
): Record<string, unknown> {
  const before =
    previous && typeof previous === "object" && !Array.isArray(previous)
      ? (previous as Record<string, unknown>)
      : {};
  const out: Record<string, unknown> = { ...next };
  for (const key of PLATFORM_CONFIG_KEYS) {
    if (key in out || before[key] === undefined) continue;
    if (key === "cursor" && !options.sameAccount) continue;
    out[key] = before[key];
  }
  return out;
}

/**
 * Environment variables handed to connectors by the web server (`ConnectorContext.env`).
 * The worker passes every variable starting with GOOGLE_, MICROSOFT_, META_, WAWEBAPI_,
 * WEBHOOK_ (`connectorEnv` in apps/worker/src/deps.ts): each name here must match that rule,
 * and a test checks that every variable the connectors read is covered on both sides.
 */
export const CONNECTOR_ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_GRAPH_VERSION",
  "WAWEBAPI_BASE_URL",
  "WEBHOOK_PUBLIC_URL",
] as const;

/** Example request for a connection that receives signed JSON (webhook_inbound). */
export function webhookExample(url: string): string {
  return [
    `BODY='{"type":"quote.requested","dedupeKey":"richiesta-1001","payload":{"name":"Maria Rossi","phone":"+393331234567","product":"RC auto"},"contact":{"name":"Maria Rossi","phone":"+393331234567"}}'`,
    `SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$IL_TUO_SEGRETO" | sed 's/^.* //')`,
    `curl -X POST '${url}' \\`,
    `  -H 'content-type: application/json' \\`,
    `  -H "x-ia-signature: sha256=$SIGNATURE" \\`,
    `  -d "$BODY"`,
  ].join("\n");
}

interface ConnectorErrorLike {
  name?: unknown;
  message?: unknown;
  options?: { code?: unknown; status?: unknown; retryable?: unknown };
}

/**
 * Message for a failed `connect`/`registerWebhook`. ConnectorError messages are
 * written in Italian and never contain provider responses or secrets, so they
 * can be shown; anything else gets a generic text.
 */
export function connectorErrorMessage(error: unknown): string {
  const e = (typeof error === "object" && error !== null ? error : {}) as ConnectorErrorLike;
  if (e.name === "MissingServiceKeyError" && typeof e.message === "string") return e.message;
  if (e.name !== "ConnectorError" || typeof e.message !== "string") {
    return "Il collegamento non è riuscito per un errore imprevisto. Riprova; se succede ancora, contatta l'assistenza.";
  }
  const code = typeof e.options?.code === "string" ? e.options.code : "";
  if (code === "missing_env") {
    const variable = e.message.split(":").pop()?.trim() ?? "";
    return `La piattaforma non è ancora configurata per questo collegamento${variable ? ` (manca ${variable} sul server)` : ""}. Contatta l'assistenza.`;
  }
  if (code === "invalid_input") {
    return `${e.message}. Controlla i campi e riprova.`;
  }
  if (e.options?.retryable === true) {
    return `${e.message}. Il servizio non ha risposto: riprova tra qualche minuto.`;
  }
  if (code === "auth_expired" || e.options?.status === 401 || e.options?.status === 403) {
    return `${e.message}. Le credenziali sono state rifiutate: controllale e riprova.`;
  }
  return `${e.message}.`.replace(/\.\.$/, ".");
}

const CONFIG_LABELS: Record<string, string> = {
  email: "Indirizzo",
  fromName: "Nome mittente",
  username: "Nome utente",
  imapHost: "Server IMAP",
  smtpHost: "Server SMTP",
  phoneNumberId: "ID del numero",
  wabaId: "ID account WhatsApp Business",
  displayPhoneNumber: "Numero",
  sessionId: "Sessione",
  baseUrl: "Indirizzo dell'API",
  pageName: "Pagina Facebook",
  pageId: "ID della pagina",
  instagramAccountId: "Account Instagram",
  locationId: "Location ID",
  accountSid: "Account SID",
  sender: "Mittente",
  siteUrl: "Sito",
  accountId: "Account",
  calendarId: "Calendario",
  timeZone: "Fuso orario",
  statusCallbackUrl: "Indirizzo per lo stato di consegna",
};

/** Short, non-technical view of `connections.config` for the detail page: only known scalar entries. */
export function configSummary(config: unknown): { label: string; value: string }[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const out: { label: string; value: string }[] = [];
  for (const [key, label] of Object.entries(CONFIG_LABELS)) {
    const value = (config as Record<string, unknown>)[key];
    if (typeof value === "string" && value) out.push({ label, value });
    else if (typeof value === "number") out.push({ label, value: String(value) });
  }
  return out;
}

/** Facebook pages offered by `meta_social` after the authorization. */
export function availablePages(config: unknown): { id: string; name: string }[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const pages = (config as Record<string, unknown>).availablePages;
  if (!Array.isArray(pages)) return [];
  const out: { id: string; name: string }[] = [];
  for (const page of pages) {
    if (!page || typeof page !== "object") continue;
    const { id, name } = page as Record<string, unknown>;
    if (typeof id === "string" && id) out.push({ id, name: typeof name === "string" && name ? name : id });
  }
  return out;
}

const MODE_LABELS: Record<string, string> = {
  oauth: "Autorizzazione dal sito del fornitore",
  api_key: "Chiave di accesso",
  credentials: "Nome utente e password",
  qr: "Codice QR",
  webhook: "Indirizzo da chiamare",
};
export function connectModeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? mode;
}

/** Default name of a new connection: the connector's name plus the account, when known. */
export function defaultConnectionName(connectorName: string, externalAccountId?: string | null): string {
  const account = externalAccountId?.trim();
  return account ? `${connectorName} · ${account}`.slice(0, 120) : connectorName;
}
