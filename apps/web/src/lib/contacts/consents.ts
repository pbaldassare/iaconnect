/**
 * Consent per channel, stored in `contacts.consents[channel]` as
 * `{ granted, at, source }` (see ChannelConsent in packages/core). A revocation
 * is kept as `{ granted: false, at, source }`: when and how it was withdrawn
 * stays on record. Pure, unit tested.
 */
import { CHANNEL_KEYS, type ChannelKey } from "../customer-labels";

export interface ConsentEntry {
  granted: boolean;
  at: string;
  source: string;
}
export type Consents = Partial<Record<ChannelKey, ConsentEntry>>;

/** Reads the stored JSON defensively: malformed entries are dropped. */
export function parseConsents(value: unknown): Consents {
  const out: Consents = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  const record = value as Record<string, unknown>;
  for (const channel of CHANNEL_KEYS) {
    const raw = record[channel];
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.granted !== "boolean") continue;
    out[channel] = {
      granted: entry.granted,
      at: typeof entry.at === "string" ? entry.at : "",
      source: typeof entry.source === "string" ? entry.source : "",
    };
  }
  return out;
}

/** Same rule as `hasValidConsent` in packages/core: only an explicit grant counts. */
export function hasConsent(consents: Consents, channel: string): boolean {
  return consents[channel as ChannelKey]?.granted === true;
}

export type ConsentState = "granted" | "revoked" | "missing";

export interface ConsentRow {
  channel: ChannelKey;
  state: ConsentState;
  at: string | null;
  source: string | null;
}

/** One row per channel, in a fixed order, for the contact page and the inbox side panel. */
export function consentRows(consents: Consents): ConsentRow[] {
  return CHANNEL_KEYS.map((channel) => {
    const entry = consents[channel];
    if (!entry) return { channel, state: "missing", at: null, source: null };
    return {
      channel,
      state: entry.granted ? "granted" : "revoked",
      at: entry.at || null,
      source: entry.source || null,
    };
  });
}

/** Stored JSON with the other keys untouched and `channel` replaced. */
function withEntry(stored: unknown, channel: ChannelKey, entry: ConsentEntry): Record<string, unknown> {
  const base =
    typeof stored === "object" && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  return { ...base, [channel]: entry };
}

export function grantConsent(
  stored: unknown,
  channel: ChannelKey,
  source: string,
  now: Date = new Date(),
): Record<string, unknown> {
  return withEntry(stored, channel, { granted: true, at: now.toISOString(), source: source.trim() });
}

/** The entry stays, with `granted: false` and the date and source of the revocation. */
export function revokeConsent(
  stored: unknown,
  channel: ChannelKey,
  source: string,
  now: Date = new Date(),
): Record<string, unknown> {
  return withEntry(stored, channel, {
    granted: false,
    at: now.toISOString(),
    source: source.trim() || "Revocato dall'operatore",
  });
}
