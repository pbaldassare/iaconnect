/**
 * Branding stored in `org_settings.brand` and `resellers.brand`:
 * `{ name?, logoUrl?, accent? }`. Values come from a form, so they are
 * validated before they reach the page (accent goes into a style attribute).
 */
export interface Brand {
  name: string | null;
  logoUrl: string | null;
  accent: string | null;
}

export const EMPTY_BRAND: Brand = { name: null, logoUrl: null, accent: null };

const HEX = /^#[0-9a-f]{6}$/i;

export function parseAccent(value: unknown): string | null {
  return typeof value === "string" && HEX.test(value.trim()) ? value.trim().toLowerCase() : null;
}

export function parseLogoUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseBrand(value: unknown): Brand {
  if (typeof value !== "object" || value === null) return EMPTY_BRAND;
  const record = value as Record<string, unknown>;
  const name =
    typeof record.name === "string" && record.name.trim() !== "" ? record.name.trim().slice(0, 60) : null;
  return { name, logoUrl: parseLogoUrl(record.logoUrl), accent: parseAccent(record.accent) };
}

/** Organization brand first, then the reseller's, field by field. */
export function mergeBrand(organization: Brand, reseller: Brand): Brand {
  return {
    name: organization.name ?? reseller.name,
    logoUrl: organization.logoUrl ?? reseller.logoUrl,
    accent: organization.accent ?? reseller.accent,
  };
}

/** Brand fields from a form → the JSON stored in the database (empty fields are dropped). */
export function brandToJson(input: { name?: string; logoUrl?: string; accent?: string }): Record<
  string,
  string
> {
  const brand = parseBrand(input);
  const out: Record<string, string> = {};
  if (brand.name) out.name = brand.name;
  if (brand.logoUrl) out.logoUrl = brand.logoUrl;
  if (brand.accent) out.accent = brand.accent;
  return out;
}
