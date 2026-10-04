import { type RecipeStep, type ScrapeRecipe, ScrapeRecipeSchema } from "@ia-connect/core";

/** Readable Italian view of a scraping recipe. Pure, unit tested. */

/** `{{secrets.password}}` must never be shown as anything but a placeholder (it already is one). */
function show(value: string, max = 80): string {
  const flat = value
    .replace(/\{\{\s*secrets\.([a-zA-Z0-9_]+)\s*\}\}/g, "[credenziale: $1]")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function describeRecipeStep(step: RecipeStep): string {
  switch (step.action) {
    case "goto":
      return `Apre la pagina ${show(step.url)}`;
    case "fill":
      return `Scrive ${show(step.value, 40)} nel campo ${show(step.selector, 60)}`;
    case "click":
      return `Fa clic su ${show(step.selector, 60)}`;
    case "wait_for":
      if (step.selector) return `Aspetta che compaia ${show(step.selector, 60)}`;
      return `Aspetta ${step.ms ? `${Math.round(step.ms / 100) / 10} secondi` : "il caricamento"}`;
    case "extract": {
      const fields = Object.keys(step.fields);
      const pages = step.paginate ? `, fino a ${step.paginate.maxPages} pagine` : "";
      return `Legge l'elenco ${show(step.listSelector, 60)} e per ogni riga prende: ${fields.join(", ") || "—"}${pages}`;
    }
  }
}

export interface RecipeView {
  steps: string[];
  /** "name (testo, obbligatorio)" … */
  fields: string[];
  keyField: string;
  eventType: string;
}

const FIELD_TYPES: Record<string, string> = { string: "testo", number: "numero", url: "indirizzo" };

/** Null when the stored recipe does not pass the schema (shown as "non leggibile"). */
export function describeRecipe(value: unknown): RecipeView | null {
  const parsed = ScrapeRecipeSchema.safeParse(value);
  if (!parsed.success) return null;
  const recipe: ScrapeRecipe = parsed.data;
  return {
    steps: recipe.steps.map(describeRecipeStep),
    fields: recipe.output.fields.map(
      (field) =>
        `${field.name} (${FIELD_TYPES[field.type] ?? field.type}${field.required ? ", obbligatorio" : ""})`,
    ),
    keyField: recipe.output.keyField,
    eventType: recipe.output.eventType,
  };
}

/** "ogni 15 minuti", "ogni 2 ore", "ogni giorno". */
export function intervalLabel(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? "ogni giorno" : `ogni ${minutes / 1440} giorni`;
  if (minutes % 60 === 0) return minutes === 60 ? "ogni ora" : `ogni ${minutes / 60} ore`;
  return `ogni ${minutes} minuti`;
}

const RUN_STATUS: Record<string, { label: string; tone: "ok" | "error" | "neutral" }> = {
  running: { label: "In corso", tone: "neutral" },
  succeeded: { label: "Riuscita", tone: "ok" },
  failed: { label: "Fallita", tone: "error" },
};
export function scrapeRunStatus(value: string): { label: string; tone: "ok" | "error" | "neutral" } {
  return RUN_STATUS[value] ?? { label: value, tone: "neutral" };
}
