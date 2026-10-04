import type { ExtractStep } from "@ia-connect/core";
import { type Browser, type LaunchOptions, type Page, chromium } from "playwright";
import type { ClosableBrowser } from "../deps.ts";

export interface PlaywrightOptions {
  launch?: LaunchOptions;
  timeoutMs?: number;
  /** Recipes come from customers and from the AI: private addresses are refused unless a test allows them. */
  allowPrivateHosts?: boolean;
}

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd])/i;

export function assertPublicUrl(raw: string, allowPrivate = false): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Indirizzo non valido: ${raw}`);
  }
  if (allowPrivate && (url.protocol === "data:" || url.protocol === "file:")) return;
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Indirizzo non ammesso: ${url.protocol}`);
  }
  if (!allowPrivate && PRIVATE_HOST.test(url.hostname)) {
    throw new Error("Indirizzo non ammesso: rete interna.");
  }
}

/** Runs in the page: reads one row per `listSelector` match, honoring `attr` and `transform`. */
function extractInPage(step: ExtractStep): Record<string, unknown>[] {
  const read = (row: Element, field: ExtractStep["fields"][string]): unknown => {
    const target = field.selector ? row.querySelector(field.selector) : row;
    if (!target) return null;
    const raw = field.attr === "text" ? (target.textContent ?? "") : (target.getAttribute(field.attr) ?? "");
    const value = raw.replace(/\s+/g, " ").trim();
    if (value === "") return null;
    if (field.transform === "number") {
      // "€ 250.000", "1.234,56", "85 m²" → 250000, 1234.56, 85
      const match = /-?\d[\d.,\s]*/.exec(value);
      if (!match) return null;
      let digits = match[0].replace(/\s/g, "");
      if (digits.includes(",")) digits = digits.replace(/\./g, "").replace(",", ".");
      else if (/^-?\d{1,3}(\.\d{3})+$/.test(digits)) digits = digits.replace(/\./g, "");
      const parsed = Number(digits);
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (field.transform === "absolute_url") {
      try {
        return new URL(value, document.baseURI).href;
      } catch {
        return null;
      }
    }
    return value;
  };
  return Array.from(document.querySelectorAll(step.listSelector)).map((row) => {
    const out: Record<string, unknown> = {};
    for (const [name, field] of Object.entries(step.fields)) out[name] = read(row, field);
    return out;
  });
}

/** Runs in the page: a short outline the AI tracer can choose selectors from. */
function snapshotInPage(): string {
  const clip = (text: string | null | undefined, max = 80) =>
    (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const visible = (element: Element) => {
    const box = (element as HTMLElement).getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const selectorOf = (element: Element): string => {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const name = element.getAttribute("name");
    const tag = element.tagName.toLowerCase();
    if (name) return `${tag}[name="${name}"]`;
    const classes = Array.from(element.classList)
      .slice(0, 2)
      .map((item) => `.${CSS.escape(item)}`)
      .join("");
    return `${tag}${classes}`;
  };
  const lines: string[] = [`title: ${clip(document.title)}`, `url: ${location.href}`];
  for (const heading of Array.from(document.querySelectorAll("h1, h2, h3")).slice(0, 12)) {
    lines.push(`${heading.tagName.toLowerCase()}: ${clip(heading.textContent)}`);
  }
  for (const form of Array.from(document.forms).slice(0, 5)) {
    lines.push(`form ${selectorOf(form)}`);
    for (const control of Array.from(form.querySelectorAll("input, select, textarea, button")).slice(0, 15)) {
      const type = control.getAttribute("type") ?? control.tagName.toLowerCase();
      if (type === "hidden") continue;
      const label =
        control.getAttribute("placeholder") ??
        control.getAttribute("aria-label") ??
        clip(control.textContent, 40);
      lines.push(`  ${type} ${selectorOf(control)}${label ? ` "${clip(label, 40)}"` : ""}`);
    }
  }
  // Repeated blocks: siblings sharing tag and classes are the likely rows of a list.
  const seen = new Set<string>();
  for (const parent of Array.from(document.querySelectorAll("body *"))) {
    const groups = new Map<string, Element[]>();
    for (const child of Array.from(parent.children)) {
      const key = selectorOf(child).replace(/^#.*/, child.tagName.toLowerCase());
      groups.set(key, [...(groups.get(key) ?? []), child]);
    }
    for (const [key, items] of groups) {
      if (items.length < 3 || !visible(items[0]!)) continue;
      const selector = `${selectorOf(parent)} > ${key}`;
      if (seen.has(selector) || seen.size >= 12) continue;
      seen.add(selector);
      lines.push(`list ${selector} ×${items.length}`);
      const sample = items[0]!;
      lines.push(`  sample: ${clip(sample.textContent, 160)}`);
      for (const part of Array.from(sample.querySelectorAll("[class], a[href], img[src]")).slice(0, 10)) {
        const href = part.getAttribute("href");
        lines.push(
          `  field ${selectorOf(part)}${href ? ` href=${clip(href, 60)}` : ""}: ${clip(part.textContent, 60)}`,
        );
      }
    }
  }
  for (const link of Array.from(document.querySelectorAll("a[href]")).filter(visible).slice(0, 25)) {
    lines.push(
      `link ${selectorOf(link)} "${clip(link.textContent, 40)}" → ${clip(link.getAttribute("href"), 80)}`,
    );
  }
  for (const button of Array.from(document.querySelectorAll("button, [role=button]"))
    .filter(visible)
    .slice(0, 15)) {
    lines.push(`button ${selectorOf(button)} "${clip(button.textContent, 40)}"`);
  }
  return lines.join("\n").slice(0, 8000);
}

export function pagePort(page: Page, options: PlaywrightOptions = {}): Omit<ClosableBrowser, "close"> {
  const timeout = options.timeoutMs ?? 20_000;
  return {
    async goto(url) {
      assertPublicUrl(url, options.allowPrivateHosts);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    },
    async currentUrl() {
      return page.url();
    },
    snapshot: () => page.evaluate(snapshotInPage),
    async click(selector) {
      await page.click(selector, { timeout });
      await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined);
    },
    async fill(selector, value) {
      await page.fill(selector, value, { timeout });
    },
    async waitFor({ selector, ms }) {
      if (selector) await page.waitForSelector(selector, { timeout: ms ?? timeout });
      else if (ms) await page.waitForTimeout(ms);
    },
    extractRows: (step) => page.evaluate(extractInPage, step),
    async exists(selector) {
      const element = page.locator(selector).first();
      return (await element.count()) > 0 && (await element.isVisible()) && (await element.isEnabled());
    },
  };
}

/** One fresh, isolated browser per scrape run. */
export async function openPlaywrightBrowser(options: PlaywrightOptions = {}): Promise<ClosableBrowser> {
  const browser: Browser = await chromium.launch({ headless: true, ...options.launch });
  try {
    const context = await browser.newContext({ locale: "it-IT" });
    const page = await context.newPage();
    return { ...pagePort(page, options), close: () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
