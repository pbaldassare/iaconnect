/**
 * Formatting helpers, always it-IT and Europe/Rome (the server runs in UTC).
 * Every helper accepts null/undefined and returns "—", so tables stay tidy.
 */
const LOCALE = "it-IT";
const TIME_ZONE = "Europe/Rome";
const EMPTY = "—";

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TIME_ZONE,
});
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});
const monthFormat = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: TIME_ZONE });
// it-IT groups only from five digits ("1234"); a working tool reads better with "1.234".
const numberFormat = new Intl.NumberFormat(LOCALE, { useGrouping: "always" });
const relativeFormat = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

/** "4 ott 2026" */
export function formatDate(value: DateInput): string {
  const date = toDate(value);
  return date ? dateFormat.format(date) : EMPTY;
}

/** "4 ott 2026, 09:30" */
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  return date ? dateTimeFormat.format(date) : EMPTY;
}

/** "ottobre 2026" */
export function formatMonth(value: DateInput): string {
  const date = toDate(value);
  return date ? monthFormat.format(date) : EMPTY;
}

/** "1.234" */
export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? EMPTY : numberFormat.format(value);
}

/** Amount in cents → "1.234,50 €". Whole amounts drop the decimals: "99 €". */
export function formatMoney(cents: number | null | undefined, currency = "EUR"): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return EMPTY;
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    useGrouping: "always",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** AI cost in millionths of a euro/dollar (`cost_micros`) → "0,0123 €" style amount. */
export function formatMicros(micros: number | null | undefined, currency = "USD"): string {
  if (micros === null || micros === undefined || Number.isNaN(micros)) return EMPTY;
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    useGrouping: "always",
    minimumFractionDigits: 2,
    maximumFractionDigits: micros !== 0 && Math.abs(micros) < 1_000_000 ? 4 : 2,
  }).format(micros / 1_000_000);
}

const RELATIVE_STEPS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: "year", seconds: 365 * 24 * 3600 },
  { unit: "month", seconds: 30 * 24 * 3600 },
  { unit: "week", seconds: 7 * 24 * 3600 },
  { unit: "day", seconds: 24 * 3600 },
  { unit: "hour", seconds: 3600 },
  { unit: "minute", seconds: 60 },
];

/** "3 ore fa", "tra 2 giorni", "adesso". `now` is injectable for tests. */
export function formatRelative(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  const diff = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return "adesso";
  for (const step of RELATIVE_STEPS) {
    if (abs >= step.seconds) return relativeFormat.format(Math.trunc(diff / step.seconds), step.unit);
  }
  return relativeFormat.format(diff < 0 ? -1 : 1, "minute");
}

/** First 8 characters of a uuid, for compact display in tables. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : EMPTY;
}
