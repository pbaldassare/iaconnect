import {
  type BusinessProfile,
  BusinessProfileSchema,
  type Json,
  parseBusinessProfile,
} from "@ia-connect/core";

export type { BusinessProfile };

export function businessProfileFormValues(raw: unknown): BusinessProfile {
  return parseBusinessProfile(raw);
}

const list = (formData: FormData, name: string) =>
  formData.getAll(name).map((value) => (typeof value === "string" ? value : ""));

export function buildBusinessProfileFromForm(
  formData: FormData,
): { ok: true; profile: BusinessProfile } | { ok: false; errors: Record<string, string> } {
  const summary = String(formData.get("summary") ?? "").trim();
  const hourLabels = list(formData, "hour_label");
  const hourValues = list(formData, "hour_value");
  const locNames = list(formData, "loc_name");
  const locAddresses = list(formData, "loc_address");
  const locPhones = list(formData, "loc_phone");
  const locHours = list(formData, "loc_hours");
  const locNotes = list(formData, "loc_notes");
  const services = list(formData, "service_line")
    .map((s) => s.trim())
    .filter(Boolean);
  const whatsappTopics = list(formData, "wa_topic")
    .map((s) => s.trim())
    .filter(Boolean);

  const openingHours = hourLabels
    .map((label, index) => ({
      label: label.trim(),
      hours: (hourValues[index] ?? "").trim(),
    }))
    .filter((row) => row.label || row.hours);

  const locations = locNames
    .map((name, index) => ({
      name: name.trim(),
      address: (locAddresses[index] ?? "").trim(),
      phone: (locPhones[index] ?? "").trim() || undefined,
      hours: (locHours[index] ?? "").trim() || undefined,
      notes: (locNotes[index] ?? "").trim() || undefined,
    }))
    .filter((row) => row.name || row.address);

  const candidate = {
    summary: summary || undefined,
    openingHours,
    locations,
    services,
    whatsappTopics,
  };

  const parsed = BusinessProfileSchema.safeParse(candidate);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      errors[key || "form"] = "Controlla i valori inseriti.";
    }
    return { ok: false, errors };
  }
  return { ok: true, profile: parsed.data };
}

export function businessProfileToJson(profile: BusinessProfile): Json {
  return profile as unknown as Json;
}
