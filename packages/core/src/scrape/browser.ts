import { renderString } from "../template.ts";
import type { RecipeStep, ScrapeRecipe } from "./recipe.ts";

export type ExtractStep = Extract<RecipeStep, { action: "extract" }>;

/**
 * The few browser operations a recipe needs. Implemented with Playwright in
 * the worker and by fakes in tests; the AI tracer drives the same interface.
 */
export interface BrowserPort {
  goto(url: string): Promise<void>;
  currentUrl(): Promise<string>;
  /** Compact outline of the page for the AI tracer: headings, forms, links and repeated blocks with CSS selectors. */
  snapshot(): Promise<string>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  waitFor(input: { selector?: string; ms?: number }): Promise<void>;
  /** Reads the rows of the current page only; pagination is handled by `runRecipe`. */
  extractRows(step: ExtractStep): Promise<Record<string, unknown>[]>;
  /** True when the selector matches a visible, enabled element. */
  exists(selector: string): Promise<boolean>;
}

/** Replays a recipe without any AI. `secrets` feed `{{secrets.<name>}}` placeholders. */
export async function runRecipe(
  recipe: ScrapeRecipe,
  browser: BrowserPort,
  secrets: Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const render = (value: string) => String(renderString(value, { secrets }) ?? "");
  for (const step of recipe.steps) {
    switch (step.action) {
      case "goto":
        await browser.goto(render(step.url));
        break;
      case "fill":
        await browser.fill(step.selector, render(step.value));
        break;
      case "click":
        await browser.click(step.selector);
        break;
      case "wait_for":
        await browser.waitFor({ selector: step.selector, ms: step.ms });
        break;
      case "extract": {
        rows.push(...(await browser.extractRows(step)));
        const pages = step.paginate?.maxPages ?? 1;
        for (let page = 1; page < pages && step.paginate; page++) {
          if (!(await browser.exists(step.paginate.nextSelector))) break;
          await browser.click(step.paginate.nextSelector);
          await browser.waitFor({ selector: step.listSelector });
          rows.push(...(await browser.extractRows(step)));
        }
        break;
      }
    }
  }
  return rows;
}
