/**
 * Organization brand stored in `org_settings.brand`: the shared `{ name, logoUrl, accent }`
 * (validated by lib/brand.ts) plus `ownerPhone` and `ownerEmail`, where the flows send
 * the alerts for the owner. Pure, unit tested.
 */
import { brandToJson, parseBrand } from "../brand";

export interface OrgBrandForm {
  name: string;
  logoUrl: string;
  accent: string;
  ownerPhone: string;
  ownerEmail: string;
}

/** Stored JSON → values for the form. */
export function orgBrandFormValues(stored: unknown): OrgBrandForm {
  const brand = parseBrand(stored);
  const record = (typeof stored === "object" && stored !== null ? stored : {}) as Record<string, unknown>;
  return {
    name: brand.name ?? "",
    logoUrl: brand.logoUrl ?? "",
    accent: brand.accent ?? "",
    ownerPhone: typeof record.ownerPhone === "string" ? record.ownerPhone : "",
    ownerEmail: typeof record.ownerEmail === "string" ? record.ownerEmail : "",
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Form → stored JSON, or per-field Italian errors. Keys this form does not know are
 * kept, so nothing written elsewhere in `brand` gets lost.
 */
export function buildOrgBrand(
  input: OrgBrandForm,
  stored: unknown,
  normalizePhone: (raw: string) => string | null,
): { ok: true; brand: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const base = brandToJson({ name: input.name, logoUrl: input.logoUrl, accent: input.accent });
  if (input.logoUrl.trim() !== "" && !base.logoUrl) {
    errors.logoUrl = "L'indirizzo del logo deve iniziare con https://";
  }
  if (input.accent.trim() !== "" && !base.accent) {
    errors.accent = "Il colore va scritto come #rrggbb, per esempio #1f7a4d.";
  }
  let ownerPhone: string | null = null;
  if (input.ownerPhone.trim() !== "") {
    ownerPhone = normalizePhone(input.ownerPhone);
    const digits = ownerPhone?.replace(/\D/g, "") ?? "";
    if (!ownerPhone || digits.length < 8 || digits.length > 15) {
      errors.ownerPhone = "Scrivi un numero di telefono valido, con il prefisso (es. +39 333 1234567).";
    }
  }
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (ownerEmail !== "" && !EMAIL.test(ownerEmail)) errors.ownerEmail = "Scrivi un indirizzo mail valido.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const known = new Set(["name", "logoUrl", "accent", "ownerPhone", "ownerEmail"]);
  const rest: Record<string, unknown> = {};
  if (typeof stored === "object" && stored !== null && !Array.isArray(stored)) {
    for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
      if (!known.has(key)) rest[key] = value;
    }
  }
  const brand: Record<string, unknown> = { ...rest, ...base };
  if (ownerPhone) brand.ownerPhone = ownerPhone;
  if (ownerEmail) brand.ownerEmail = ownerEmail;
  return { ok: true, brand };
}
