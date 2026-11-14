import { z } from "zod";

const hoursRow = z.object({
  label: z.string().trim().min(1).max(80),
  hours: z.string().trim().min(1).max(120),
});

const locationRow = z.object({
  name: z.string().trim().min(1).max(80),
  address: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40).optional(),
  hours: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(300).optional(),
});

export const BusinessProfileSchema = z.object({
  summary: z.string().trim().max(500).optional(),
  openingHours: z.array(hoursRow).max(14).default([]),
  locations: z.array(locationRow).max(20).default([]),
  services: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  whatsappTopics: z
    .array(z.string().trim().min(1).max(160))
    .max(20)
    .default([]),
});

export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

const trainingEntry = z.object({
  id: z.string().uuid(),
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(1000),
  topic: z.string().trim().max(80).optional(),
  active: z.boolean().default(true),
});

export const AiTrainingSchema = z.object({
  entries: z.array(trainingEntry).max(100).default([]),
  notes: z.string().trim().max(1000).optional(),
});

export type AiTraining = z.infer<typeof AiTrainingSchema>;
export type AiTrainingEntry = AiTraining["entries"][number];

export function parseBusinessProfile(raw: unknown): BusinessProfile {
  const parsed = BusinessProfileSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  return BusinessProfileSchema.parse({});
}

export function parseAiTraining(raw: unknown): AiTraining {
  const parsed = AiTrainingSchema.safeParse(raw ?? { entries: [] });
  if (parsed.success) return parsed.data;
  return { entries: [] };
}

function section(title: string, body: string): string {
  const text = body.trim();
  return text ? `### ${title}\n${text}` : "";
}

/** Formats structured profile + Q&A for the model (WhatsApp auto-replies and ai.reply). */
export function formatBusinessProfileForAi(profile: BusinessProfile): string {
  const parts: string[] = [];
  if (profile.summary?.trim()) parts.push(section("Chi siamo", profile.summary.trim()));
  if (profile.openingHours.length > 0) {
    const lines = profile.openingHours.map((row) => `- ${row.label}: ${row.hours}`);
    parts.push(section("Orari di apertura", lines.join("\n")));
  }
  if (profile.locations.length > 0) {
    const blocks = profile.locations.map((loc) => {
      const bits = [`**${loc.name}** — ${loc.address}`];
      if (loc.phone?.trim()) bits.push(`Tel. ${loc.phone.trim()}`);
      if (loc.hours?.trim()) bits.push(`Orari: ${loc.hours.trim()}`);
      if (loc.notes?.trim()) bits.push(loc.notes.trim());
      return bits.join(". ");
    });
    parts.push(section("Sedi e sportelli", blocks.map((line) => `- ${line}`).join("\n")));
  }
  if (profile.services.length > 0) {
    parts.push(section("Servizi principali", profile.services.map((s) => `- ${s}`).join("\n")));
  }
  if (profile.whatsappTopics.length > 0) {
    parts.push(
      section(
        "Cosa può spiegare da sola su WhatsApp",
        profile.whatsappTopics.map((s) => `- ${s}`).join("\n"),
      ),
    );
  }
  return parts.join("\n\n");
}

export function formatAiTrainingForAi(training: AiTraining): string {
  const active = training.entries.filter((e) => e.active);
  const parts: string[] = [];
  if (training.notes?.trim()) parts.push(section("Note interne per l'IA", training.notes.trim()));
  if (active.length > 0) {
    const lines = active.map((e) => {
      const topic = e.topic?.trim() ? ` (${e.topic})` : "";
      return `- Domanda${topic}: ${e.question}\n  Risposta da dare: ${e.answer}`;
    });
    parts.push(section("Risposte addestrate", lines.join("\n")));
  }
  return parts.join("\n\n");
}

export function buildOrgAiInstructions(input: {
  manual?: string | null;
  businessProfile?: unknown;
  aiTraining?: unknown;
}): string | undefined {
  const blocks: string[] = [];
  const manual = input.manual?.trim();
  if (manual) blocks.push(manual);
  const profile = formatBusinessProfileForAi(parseBusinessProfile(input.businessProfile));
  if (profile) blocks.push(profile);
  const training = formatAiTrainingForAi(parseAiTraining(input.aiTraining));
  if (training) blocks.push(training);
  const combined = blocks.join("\n\n");
  return combined.trim() ? combined : undefined;
}