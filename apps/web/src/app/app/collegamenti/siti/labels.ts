import { type StatusInfo, scrapeRecipeStatus } from "@/lib/labels";

/** Recipe status as the customer reads it in this section ("guasta" for a recipe the repairs could not fix). */
export function recipeStatus(value: string): StatusInfo {
  return value === "broken" ? { label: "Guasta", tone: "error" } : scrapeRecipeStatus(value);
}

export const TRACE_LINE =
  "L'IA traccia il percorso una sola volta; poi è il server a ripeterlo all'intervallo scelto, senza altra IA.";
