/** Small parsers for form input. Pure, unit tested. */

/** "249", "249,5", "1.249,00", "249.50" → cents. Null when it is not a non-negative amount. */
export function eurosToCents(input: string): number | null {
  let text = input.trim().replace(/\s|€/g, "");
  if (text === "") return null;
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number.parseFloat(text) * 100);
}

/** Cents → the text shown in a price input: 24900 → "249", 24950 → "249,50". */
export function centsToEurosInput(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return rest === 0 ? String(whole) : `${whole},${String(rest).padStart(2, "0")}`;
}

/** "Agenzia Rossi & C." → "agenzia-rossi-c". */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** A plan limit from a form: integer ≥ -1 (-1 = unlimited). Null when invalid. */
export function parseLimit(input: string): number | null {
  const text = input.trim();
  if (!/^-?\d+$/.test(text)) return null;
  const value = Number.parseInt(text, 10);
  return value >= -1 && value <= 100_000_000 ? value : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Validates a `YYYY-MM-DD` filter value. */
export function parseIsoDate(input: string | undefined): string | null {
  if (!input || !ISO_DATE.test(input)) return null;
  const date = new Date(`${input}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input ? null : input;
}

/** The day after a `YYYY-MM-DD` date, for "up to and including" filters. */
export function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
