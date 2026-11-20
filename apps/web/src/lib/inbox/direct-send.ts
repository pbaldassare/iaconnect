import { parsePhones } from "@/lib/contacts/fields";
import type { Row } from "@ia-connect/core";
import { normalizePhone } from "@ia-connect/core";

export function parseDirectPhone(raw: string, normalize = normalizePhone): string | null {
  const parsed = parsePhones(raw, normalize);
  if (parsed.invalid.length > 0) return null;
  return parsed.phones[0] ?? null;
}

/** Same org + exact normalized phone on a contact row. */
export function contactMatchesPhone(contact: Pick<Row<"contacts">, "phones">, phone: string): boolean {
  return contact.phones.some((item) => item === phone);
}
