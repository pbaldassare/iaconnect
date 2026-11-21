/**
 * Public restore sheet for a WhatsApp QR connection (waWebApi / Futureflow).
 * Pure: no I/O, no secrets. The gateway token stays in the Vault and never
 * enters this object. Unit tested in apps/web/test/recovery.test.ts.
 *
 * The session-status address is the one the operator opens to restore the
 * line: `<base>/sessionStatus/<instance id>`. It is not the connector's
 * assumed gateway API (`/sessions/…`).
 */
import { PLATFORM_CONFIG_KEYS } from "./catalog";
import { isSecretField } from "./form-fields";

const PLATFORM_KEYS = new Set<string>(PLATFORM_CONFIG_KEYS);

/** True for the QR WhatsApp connector, and for any other connector whose mode is QR. */
export function showsRecoverySheet(connectorType: string, connectMode: string): boolean {
  return connectorType === "whatsapp_wawebapi" || connectMode === "qr";
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** http(s) URL with no userinfo. Anything else is not turned into a link. */
export function publicHttpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Session-status URL: gateway base + `/sessionStatus/` + instance id.
 * Missing id, missing base, or a base that is not a public http(s) URL → no link.
 */
export function sessionStatusUrl(
  baseUrl: string | null | undefined,
  instanceId: string | null | undefined,
): string | null {
  const id = instanceId?.trim() ?? "";
  if (!id) return null;
  const base = publicHttpUrl(baseUrl);
  if (!base) return null;
  return `${base}/sessionStatus/${encodeURIComponent(id)}`;
}

/** Italian mobile (+39 and 10 digits starting with 3) grouped for display. Other numbers stay as stored. */
export function formatLinePhone(phone: string): string {
  const trimmed = phone.trim();
  const match = /^\+39(\d{10})$/.exec(trimmed.replace(/[\s-]/g, ""));
  const digits = match?.[1];
  if (!digits || !digits.startsWith("3")) return trimmed;
  return `+39 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

export interface RecoveryNote {
  label: string;
  value: string;
}

export interface RecoveryExtra {
  key: string;
  label: string;
  value: string;
}

export interface RecoverySheet {
  phone: string | null;
  lineName: string | null;
  baseUrl: string | null;
  instanceId: string | null;
  /** Null when the instance id or a public base URL is missing. */
  sessionStatusUrl: string | null;
  inboundWebhookUrl: string | null;
  notes: RecoveryNote[];
  extras: RecoveryExtra[];
}

const EXTRA_LABELS: Record<string, string> = {
  email: "Indirizzo",
  fromName: "Nome mittente",
  username: "Nome utente",
  phone: "Numero",
  displayPhoneNumber: "Numero visualizzato",
  phoneLabel: "Nome della linea",
  lineName: "Nome della linea",
  sessionId: "Sessione",
  instanceId: "Istanza",
  baseUrl: "Indirizzo del gateway",
  pageName: "Pagina",
  sender: "Mittente",
  externalAccountId: "Account esterno",
  inboundWebhookUrl: "Webhook in ingresso",
  webhookUrl: "Webhook in ingresso",
};

function labelFor(key: string): string {
  return EXTRA_LABELS[key] ?? key;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Drops credential-shaped keys. Values are not walked: objects such as `cursor` stay out of the sheet. */
function publicConfig(config: unknown): Record<string, unknown> {
  const record = asRecord(config);
  if (!record) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isSecretField(key) || value === undefined || value === null) continue;
    out[key] = value;
  }
  return out;
}

function firstField(
  config: Record<string, unknown>,
  keys: readonly string[],
): { key: string; value: string } | null {
  for (const key of keys) {
    const value = text(config[key]);
    if (value) return { key, value };
  }
  return null;
}

function readNotes(config: Record<string, unknown>): RecoveryNote[] {
  const out: RecoveryNote[] = [];
  if (Array.isArray(config.notes)) {
    for (const item of config.notes) {
      const record = asRecord(item);
      if (!record) continue;
      const label = text(record.label);
      const value = text(record.value);
      if (!label || !value || isSecretField(label)) continue;
      out.push({ label, value });
    }
  }
  const single = text(config.note);
  if (single) out.push({ label: "Nota", value: single });
  return out;
}

/** Shown text for a base URL: the public http(s) form, or a non-URL note. Credentialed URLs are dropped. */
function visibleBase(value: string | null): string | null {
  if (!value) return null;
  const http = publicHttpUrl(value);
  if (http) return http;
  if (/^https?:\/\//i.test(value)) return null;
  return value.replace(/\/+$/, "");
}

/**
 * Facts the operator needs to restore a QR WhatsApp line.
 * Secret keys are omitted. Platform keys (`cursor`, `pollIntervalMinutes`,
 * `statusCallbackUrl`) stay in the database and are not restore facts.
 */
export function recoverySheet(input: {
  externalAccountId?: string | null;
  config: unknown;
}): RecoverySheet {
  const config = publicConfig(input.config);
  const phone = firstField(config, ["phone", "displayPhoneNumber"]);
  const lineName = firstField(config, ["lineName", "phoneLabel"]);
  const baseField = firstField(config, ["baseUrl"]);
  const instanceField = firstField(config, ["instanceId", "sessionId"]);
  const externalAccountId = text(input.externalAccountId);
  const instanceId = instanceField?.value ?? externalAccountId;
  const webhookField = firstField(config, ["inboundWebhookUrl", "webhookUrl"]);
  const baseUrl = baseField ? visibleBase(baseField.value) : null;

  const consumed = new Set<string>(["notes", "note"]);
  if (phone) consumed.add(phone.key);
  if (lineName) consumed.add(lineName.key);
  if (baseField) consumed.add(baseField.key);
  if (instanceField) consumed.add(instanceField.key);
  if (webhookField) consumed.add(webhookField.key);

  const extras: RecoveryExtra[] = [];
  const pushExtra = (key: string, value: string) => {
    if (!value || consumed.has(key) || PLATFORM_KEYS.has(key) || isSecretField(key)) return;
    if (extras.some((item) => item.key === key)) return;
    extras.push({ key, label: labelFor(key), value });
  };

  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      pushExtra(key, String(value));
      continue;
    }
    const shown = text(value);
    if (!shown) continue;
    if (/^https?:\/\//i.test(shown)) {
      const http = publicHttpUrl(shown);
      if (http) pushExtra(key, http);
      continue;
    }
    pushExtra(key, shown);
  }

  const alternate = (chosen: { key: string; value: string } | null, keys: readonly string[]) => {
    if (!chosen) return;
    for (const key of keys) {
      if (key === chosen.key) continue;
      const value = text(config[key]);
      if (!value || value === chosen.value) continue;
      if (/^https?:\/\//i.test(value)) {
        const http = publicHttpUrl(value);
        if (http) pushExtra(key, http);
        continue;
      }
      pushExtra(key, value);
    }
  };
  alternate(phone, ["phone", "displayPhoneNumber"]);
  alternate(lineName, ["lineName", "phoneLabel"]);
  alternate(instanceField, ["instanceId", "sessionId"]);
  alternate(webhookField, ["inboundWebhookUrl", "webhookUrl"]);
  if (externalAccountId && externalAccountId !== instanceId) {
    pushExtra("externalAccountId", externalAccountId);
  }
  extras.sort((a, b) => a.key.localeCompare(b.key, "it"));

  return {
    phone: phone?.value ?? null,
    lineName: lineName?.value ?? null,
    baseUrl,
    instanceId,
    sessionStatusUrl: sessionStatusUrl(baseUrl, instanceId),
    inboundWebhookUrl: webhookField ? publicHttpUrl(webhookField.value) : null,
    notes: readNotes(config),
    extras,
  };
}

/** A connection row the settings page can place on the restore list. */
export interface RecoveryCandidate {
  id: string;
  connectorType: string;
  connectMode: string;
}

/**
 * What Impostazioni shows for WhatsApp restore.
 * No qualifying connection → empty, unless an id was asked for (then missing).
 * One qualifying connection → its sheet.
 * Several → the list, or one sheet when `selectedId` is one of them.
 * A selected id that is not a qualifying connection → missing (the page answers 404).
 */
export type RecoverySettingsView<T extends RecoveryCandidate> =
  | { kind: "empty" }
  | { kind: "list"; connections: T[] }
  | { kind: "sheet"; connection: T; total: number }
  | { kind: "missing" };

export function recoverySettingsView<T extends RecoveryCandidate>(
  rows: readonly T[],
  selectedId: string | null,
): RecoverySettingsView<T> {
  const connections = rows.filter((row) => showsRecoverySheet(row.connectorType, row.connectMode));
  const selected = selectedId?.trim() ? selectedId.trim() : null;

  if (connections.length === 0) {
    return selected ? { kind: "missing" } : { kind: "empty" };
  }

  const only = connections[0];
  if (connections.length === 1 && only) {
    if (selected && selected !== only.id) return { kind: "missing" };
    return { kind: "sheet", connection: only, total: 1 };
  }

  if (!selected) return { kind: "list", connections };
  const connection = connections.find((row) => row.id === selected);
  if (!connection) return { kind: "missing" };
  return { kind: "sheet", connection, total: connections.length };
}
