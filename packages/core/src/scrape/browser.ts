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

/** Second-level suffixes under which the registrable domain has three labels (a short, common list). */
const MULTI_PART_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.jp",
  "co.kr",
  "co.in",
  "co.za",
  "com.br",
  "com.mx",
  "com.ar",
  "com.tr",
  "com.cn",
  "com.hk",
  "com.sg",
  "com.tw",
  "gov.it",
  "edu.it",
]);

/**
 * Registrable domain of a host: the last two labels, or three under a known multi-part
 * suffix (`shop.example.co.uk` → `example.co.uk`). An IP address is returned whole.
 * A simple suffix match, not the Public Suffix List.
 */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (/^[\d.]+$/.test(host) || host.includes(":")) return host;
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const take = MULTI_PART_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/**
 * True when `current` is a page of the same site as `target`: same registrable domain, and
 * not a downgrade from https to http. Anything unparsable is not the same site.
 */
export function isSameSite(current: string, target: string): boolean {
  try {
    const a = new URL(current);
    const b = new URL(target);
    if (a.protocol !== "http:" && a.protocol !== "https:") return false;
    if (b.protocol === "https:" && a.protocol !== "https:") return false;
    return registrableDomain(a.hostname) === registrableDomain(b.hostname);
  } catch {
    return false;
  }
}

const USES_SECRET = /\{\{\s*secrets\./;

/** Says why a step may not use the stored credentials here; null when it may. */
export async function secretUseProblem(browser: BrowserPort, targetUrl: string): Promise<string | null> {
  const current = await browser.currentUrl();
  if (isSameSite(current, targetUrl)) return null;
  let host = "sconosciuta";
  try {
    host = new URL(current).hostname || host;
  } catch {
    // keep the placeholder
  }
  return `Credenziali non inserite: la pagina corrente (${host}) non appartiene al sito della lettura.`;
}

export interface RunRecipeOptions {
  /**
   * The site the recipe reads. `{{secrets.<name>}}` values are typed only while the browser
   * is on a page of that site (same registrable domain): a recipe, or a page that steers the
   * AI tracer, cannot make the worker type the customer's credentials somewhere else.
   * Default: the address of the recipe's first `goto`.
   */
  targetUrl?: string;
}

/**
 * Replays a recipe without any AI. `secrets` feed the `{{secrets.<name>}}` placeholders of
 * `fill` steps; they are never put into an address.
 */
export async function runRecipe(
  recipe: ScrapeRecipe,
  browser: BrowserPort,
  secrets: Record<string, unknown> = {},
  options: RunRecipeOptions = {},
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const render = (value: string) => String(renderString(value, { secrets }) ?? "");
  const firstGoto = recipe.steps.find((step) => step.action === "goto");
  const targetUrl = options.targetUrl ?? (firstGoto?.action === "goto" ? firstGoto.url : undefined);
  for (const step of recipe.steps) {
    switch (step.action) {
      case "goto":
        if (USES_SECRET.test(step.url)) {
          throw new Error("Le credenziali non possono comparire in un indirizzo.");
        }
        await browser.goto(step.url);
        break;
      case "fill":
        if (USES_SECRET.test(step.value)) {
          const problem = targetUrl ? await secretUseProblem(browser, targetUrl) : null;
          if (problem) throw new Error(problem);
        }
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
