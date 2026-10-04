/** Contact form parsing: phones, mails, custom fields, search filter. Pure, unit tested. */

/** Splits a textarea (one per line, commas and semicolons accepted) into trimmed, non-empty items. */
export function splitList(input: string | null | undefined): string[] {
  return (input ?? "")
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/**
 * Normalizes each phone with the given function (`normalizePhone` from packages/core).
 * Returns the unique normalized numbers and the inputs that are not phone numbers.
 */
export function parsePhones(
  input: string | null | undefined,
  normalize: (raw: string) => string | null,
): { phones: string[]; invalid: string[] } {
  const phones: string[] = [];
  const invalid: string[] = [];
  for (const item of splitList(input)) {
    const normalized = normalize(item);
    const digits = normalized?.replace(/\D/g, "") ?? "";
    if (!normalized || digits.length < 8 || digits.length > 15 || /[a-z]/i.test(item)) invalid.push(item);
    else if (!phones.includes(normalized)) phones.push(normalized);
  }
  return { phones, invalid };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseEmails(input: string | null | undefined): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const item of splitList(input)) {
    const mail = item.toLowerCase();
    if (!EMAIL.test(mail)) invalid.push(item);
    else if (!emails.includes(mail)) emails.push(mail);
  }
  return { emails, invalid };
}

const KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** "Budget max" → "budget_max": the form in which flows read a custom field. */
export function fieldKey(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** "250000" and "1500,50" become numbers so flows can compare them; everything else stays text. */
export function fieldValue(input: string): string | number | boolean {
  const text = input.trim();
  if (/^(0|[1-9]\d{0,14})([.,]\d+)?$/.test(text) || /^-(0|[1-9]\d{0,14})([.,]\d+)?$/.test(text)) {
    return Number(text.replace(",", "."));
  }
  if (text === "true") return true;
  if (text === "false") return false;
  return text;
}

type FieldValue = string | number | boolean;

/**
 * Key/value rows from the editor → the object stored in `custom_fields`.
 * Rows with an empty key and value are skipped. Errors are Italian messages.
 */
export function parseCustomFields(
  keys: readonly string[],
  values: readonly string[],
): { fields: Record<string, FieldValue>; errors: string[] } {
  const fields: Record<string, FieldValue> = {};
  const errors: string[] = [];
  keys.forEach((rawKey, index) => {
    const rawValue = (values[index] ?? "").trim();
    if (rawKey.trim() === "" && rawValue === "") return;
    const key = fieldKey(rawKey);
    if (!KEY.test(key)) {
      errors.push(`«${rawKey.trim() || "(vuoto)"}» non è un nome di campo valido: usa lettere, numeri e _.`);
      return;
    }
    if (key in fields) {
      errors.push(`Il campo «${key}» compare due volte.`);
      return;
    }
    if (rawValue === "") return;
    fields[key] = fieldValue(rawValue.slice(0, 500));
  });
  return { fields, errors };
}

/** Stored custom fields → rows for the editor and for display. Nested values are shown as JSON. */
export function customFieldRows(value: unknown): { key: string; value: string }[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([key, v]) => ({
      key,
      value:
        typeof v === "string"
          ? v
          : typeof v === "number"
            ? String(v).replace(".", ",")
            : typeof v === "boolean"
              ? String(v)
              : JSON.stringify(v),
    }));
}

/**
 * PostgREST `or` filter for the contact search: part of the name, or a whole
 * phone number, or a whole mail address (phones and mails are arrays: the API
 * can only match a complete element). Null when there is nothing to search.
 */
export function contactSearchFilter(
  search: string,
  normalize: (raw: string) => string | null,
): string | null {
  const query = search.trim().slice(0, 80);
  if (query === "") return null;
  // Inside or(): the value is double-quoted; `\` and `"` are escaped, and so are the LIKE wildcards.
  const like = query.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[\\"]/g, (c) => `\\${c}`);
  const parts = [`full_name.ilike."%${like}%"`];
  if (/^[\d\s+().-]+$/.test(query)) {
    const phone = normalize(query);
    if (phone && /^\+\d{6,15}$/.test(phone)) parts.push(`phones.cs.{${phone}}`);
  }
  const mail = query.toLowerCase();
  if (/^[a-z0-9._+-]+@[a-z0-9.-]+$/.test(mail)) parts.push(`emails.cs.{"${mail}"}`);
  return parts.join(",");
}
