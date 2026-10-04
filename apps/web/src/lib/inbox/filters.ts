/** Inbox list filters. Pure, unit tested: the page loads recent conversations and filters them here. */
import { type ChannelKey, isChannel } from "../customer-labels";

export const INBOX_VIEWS = ["tutte", "da-gestire", "automatiche", "non-lette", "chiuse"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export const INBOX_VIEW_LABELS: Record<InboxView, string> = {
  tutte: "Tutte",
  "da-gestire": "Da gestire",
  automatiche: "Automatiche",
  "non-lette": "Non lette",
  chiuse: "Chiuse",
};

export interface InboxFilter {
  view: InboxView;
  channel: ChannelKey | null;
  search: string;
}

type Param = string | string[] | undefined;
const first = (value: Param) => ((Array.isArray(value) ? value[0] : value) ?? "").trim();

export function parseInboxFilter(params: { vista?: Param; canale?: Param; q?: Param }): InboxFilter {
  const view = first(params.vista);
  const channel = first(params.canale);
  return {
    view: (INBOX_VIEWS as readonly string[]).includes(view) ? (view as InboxView) : "tutte",
    channel: isChannel(channel) ? channel : null,
    search: first(params.q).slice(0, 80),
  };
}

/** Query params for a link that keeps the current filters (defaults are dropped). */
export function inboxFilterParams(filter: InboxFilter): Record<string, string | null> {
  return {
    vista: filter.view === "tutte" ? null : filter.view,
    canale: filter.channel,
    q: filter.search || null,
  };
}

export interface InboxConversation {
  status: string;
  channel: string;
  assignee_type: string;
  unread_count: number;
  contact: { full_name: string; phones: readonly string[]; emails: readonly string[] } | null;
}

const digits = (value: string) => value.replace(/\D/g, "");

/** Name (case and accents ignored), phone (digits only, any part) or mail (any part). */
export function matchesSearch(contact: InboxConversation["contact"], search: string): boolean {
  const query = search.trim();
  if (query === "") return true;
  if (!contact) return false;
  const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const needle = fold(query);
  if (fold(contact.full_name).includes(needle)) return true;
  if (contact.emails.some((mail) => mail.toLowerCase().includes(needle))) return true;
  const numeric = digits(query);
  // "333 12" must match "+3933312…": compare digits, and only when the query is a number.
  if (numeric.length >= 3 && /^[\d\s+().-]+$/.test(query)) {
    return contact.phones.some((phone) => digits(phone).includes(numeric.replace(/^00/, "")));
  }
  return false;
}

/**
 * "Da gestire" = open and assigned to a person; "Automatiche" = open and handled by
 * the automation; "Non lette" = with unread messages; "Chiuse" = closed.
 * "Tutte" lists the open and the closed ones.
 */
export function matchesInboxFilter(row: InboxConversation, filter: InboxFilter): boolean {
  if (filter.channel && row.channel !== filter.channel) return false;
  switch (filter.view) {
    case "da-gestire":
      if (row.status !== "open" || row.assignee_type !== "user") return false;
      break;
    case "automatiche":
      if (row.status !== "open" || row.assignee_type !== "automation") return false;
      break;
    case "non-lette":
      if (row.unread_count <= 0) return false;
      break;
    case "chiuse":
      if (row.status !== "closed") return false;
      break;
    case "tutte":
      break;
  }
  return matchesSearch(row.contact, filter.search);
}

export function filterConversations<T extends InboxConversation>(
  rows: readonly T[],
  filter: InboxFilter,
): T[] {
  return rows.filter((row) => matchesInboxFilter(row, filter));
}

/** Counters shown on the view tabs (channel and search are ignored on purpose). */
export function inboxCounts(rows: readonly InboxConversation[]): Record<InboxView, number> {
  const base: InboxFilter = { view: "tutte", channel: null, search: "" };
  const out = {} as Record<InboxView, number>;
  for (const view of INBOX_VIEWS) {
    out[view] = rows.filter((row) => matchesInboxFilter(row, { ...base, view })).length;
  }
  return out;
}

/** One line of text for the list: no line breaks, cut at `max` characters. */
export function messagePreview(content: string | null | undefined, max = 90): string {
  const text = (content ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
