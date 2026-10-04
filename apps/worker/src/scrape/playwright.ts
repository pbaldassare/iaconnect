import { type ExtractStep, type HostResolver, isPublicHostname } from "@ia-connect/core";
import { type Browser, type BrowserContext, type LaunchOptions, type Page, chromium } from "playwright";
import type { ClosableBrowser } from "../deps.ts";
import { type EgressPolicy, publicOnly, startEgressProxy } from "./egress.ts";

export interface PlaywrightOptions {
  launch?: LaunchOptions;
  timeoutMs?: number;
  /** Recipes come from customers and from the AI: private addresses are refused unless a test allows them. */
  allowPrivateHosts?: boolean;
  /** DNS lookup behind the default egress policy (default: the system resolver). */
  resolveHost?: HostResolver;
  /**
   * Which hosts the browser may connect to, and at which address (see `egress.ts`).
   * Default: every address the host resolves to must be public. Tests replace it to map
   * made-up names onto local servers.
   */
  egress?: EgressPolicy;
}

/**
 * String-level check of an address the recipe navigates to, for a clear error before any
 * request. The real boundary is the egress proxy, which vets every connection the browser
 * makes (redirects and subresources included) after resolving the name.
 */
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
  if (!allowPrivate && (!isPublicHostname(url.hostname) || url.username || url.password)) {
    throw new Error("Indirizzo non ammesso: rete interna.");
  }
}

/**
 * First layer inside the browser: every request Playwright shows us (navigations and
 * subresources; not the hops of a redirect, which only the proxy sees) must be http(s)
 * towards a host the policy accepts. Anything else is aborted before it leaves.
 */
export async function guardRequests(context: BrowserContext, policy: EgressPolicy): Promise<void> {
  await context.route("**/*", async (route) => {
    let allowed = false;
    try {
      const url = new URL(route.request().url());
      if (url.protocol === "http:" || url.protocol === "https:") {
        await policy(url.hostname.replace(/^\[|\]$/g, ""));
        allowed = true;
      }
    } catch {
      allowed = false;
    }
    await (allowed ? route.continue() : route.abort("blockedbyclient")).catch(() => undefined);
  });
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

/**
 * One fresh, isolated browser per scrape run. Unless a test allows private hosts, all its
 * traffic goes through the egress proxy and nothing bypasses it (no direct connections, no
 * service workers, no extra pages).
 */
export async function openPlaywrightBrowser(options: PlaywrightOptions = {}): Promise<ClosableBrowser> {
  const base = options.allowPrivateHosts ? undefined : (options.egress ?? publicOnly(options.resolveHost));
  // Counts the refusals of both layers, to tell the customer why a navigation failed.
  let refusals = 0;
  const policy: EgressPolicy | undefined = base
    ? async (hostname) => {
        try {
          return await base(hostname);
        } catch (error) {
          refusals += 1;
          throw error;
        }
      }
    : undefined;
  const proxy = policy ? await startEgressProxy(policy) : undefined;
  let browser: Browser | undefined;
  const close = async () => {
    await browser?.close().catch(() => undefined);
    await proxy?.close();
  };
  try {
    browser = await chromium.launch({
      headless: true,
      ...options.launch,
      ...(proxy
        ? {
            // `<-loopback>`: Chromium would otherwise connect to localhost and to link-local
            // addresses (the cloud metadata service) directly, without asking the proxy.
            proxy: { server: proxy.url, bypass: "<-loopback>" },
            args: [
              ...(options.launch?.args ?? []),
              // WebRTC would open UDP sockets that no proxy sees.
              "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
              "--disable-quic",
            ],
          }
        : {}),
    });
    const context = await browser.newContext({
      locale: "it-IT",
      ...(policy ? { serviceWorkers: "block" as const } : {}),
    });
    if (policy) await guardRequests(context, policy);
    const page = await context.newPage();
    const port = pagePort(page, options);
    return {
      ...port,
      async goto(url) {
        const refusedBefore = refusals;
        try {
          await port.goto(url);
        } catch (error) {
          // A host was refused on the way: the address itself, or a redirect.
          if (refusals > refusedBefore) throw new Error("Indirizzo non ammesso: rete interna.");
          throw error;
        }
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
