import { z } from "zod";

/**
 * A scraping recipe: traced once by the AI, replayed by the worker with
 * Playwright and no AI. Values may reference `{{secrets.<name>}}`.
 */
const Selector = z.string().min(1);

export const RecipeStepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("goto"), url: z.string().min(1) }),
  z.object({ action: z.literal("fill"), selector: Selector, value: z.string() }),
  z.object({ action: z.literal("click"), selector: Selector }),
  z.object({
    action: z.literal("wait_for"),
    selector: Selector.optional(),
    ms: z.number().int().max(30_000).optional(),
  }),
  z.object({
    action: z.literal("extract"),
    /** Each match is one row. */
    listSelector: Selector,
    fields: z.record(
      z.string(),
      z.object({
        /** Relative to the row. Empty string = the row element itself. */
        selector: z.string(),
        /** "text" or an attribute name such as "href". */
        attr: z.string().default("text"),
        transform: z.enum(["trim", "number", "absolute_url"]).default("trim"),
      }),
    ),
    paginate: z
      .object({ nextSelector: Selector, maxPages: z.number().int().min(1).max(20).default(3) })
      .optional(),
  }),
]);
export type RecipeStep = z.infer<typeof RecipeStepSchema>;

export const RecipeOutputFieldSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "url"]),
  required: z.boolean().default(false),
});

export const ScrapeRecipeSchema = z.object({
  steps: z.array(RecipeStepSchema).min(1).max(40),
  output: z.object({
    /** Event emitted for each new row. */
    eventType: z.string().default("scrape.item.found"),
    /** Field that identifies a row; used to build the `dedupe_key`. */
    keyField: z.string(),
    fields: z.array(RecipeOutputFieldSchema).min(1),
  }),
});
export type ScrapeRecipe = z.infer<typeof ScrapeRecipeSchema>;

export interface RowValidation {
  valid: Record<string, unknown>[];
  errors: string[];
}

/** Checks extracted rows against the recipe's output schema. */
export function validateRows(recipe: ScrapeRecipe, rows: Record<string, unknown>[]): RowValidation {
  const valid: Record<string, unknown>[] = [];
  const errors: string[] = [];
  rows.forEach((row, index) => {
    const problems: string[] = [];
    for (const field of recipe.output.fields) {
      const value = row[field.name];
      const empty = value === undefined || value === null || value === "";
      if (empty) {
        if (field.required || field.name === recipe.output.keyField) problems.push(`${field.name} mancante`);
        continue;
      }
      if (field.type === "number" && (typeof value !== "number" || Number.isNaN(value))) {
        problems.push(`${field.name} non è un numero`);
      }
      if (field.type === "url" && !/^https?:\/\//.test(String(value)))
        problems.push(`${field.name} non è un indirizzo`);
    }
    if (problems.length) errors.push(`riga ${index + 1}: ${problems.join(", ")}`);
    else valid.push(row);
  });
  return { valid, errors };
}
