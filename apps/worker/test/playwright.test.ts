import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type ScrapeRecipe, runRecipe, validateRows } from "@ia-connect/core";
import type { LaunchOptions } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertPublicUrl, openPlaywrightBrowser } from "../src/scrape/playwright.ts";

/**
 * Integration test of the Playwright BrowserPort against a local static page (no internet).
 * Uses Playwright's Chromium when installed, else the system Chrome; skipped when neither starts.
 */
async function findBrowser(): Promise<LaunchOptions | undefined> {
  for (const launch of [{}, { channel: "chrome" }] as LaunchOptions[]) {
    try {
      const browser = await openPlaywrightBrowser({ launch });
      await browser.close();
      return launch;
    } catch {
      // try the next one
    }
  }
  return undefined;
}
const launch = await findBrowser();
if (!launch)
  console.warn("Playwright test skipped: no Chromium available (run `npx playwright install chromium`).");

const page = (n: number, next?: string) => `<!doctype html><html><head><title>Annunci</title></head><body>
  <h1>Annunci pagina ${n}</h1>
  <form id="search"><input name="q" placeholder="Cerca"><button type="submit">Cerca</button></form>
  <ul id="results">
    ${[1, 2, 3]
      .map((i) => {
        const id = (n - 1) * 3 + i;
        return `<li class="card"><a class="title" href="/annunci/${id}">  Trilocale ${id} </a>
          <span class="price">€ ${200 + id}.000</span><span class="sqm">${80 + id},5 m²</span></li>`;
      })
      .join("")}
  </ul>
  ${next ? `<a id="next" href="${next}">Successiva</a>` : ""}
</body></html>`;

const RECIPE = (base: string): ScrapeRecipe => ({
  steps: [
    { action: "goto", url: `${base}/` },
    { action: "fill", selector: "input[name=q]", value: "{{secrets.query}}" },
    { action: "wait_for", selector: "#results .card" },
    {
      action: "extract",
      listSelector: "#results .card",
      fields: {
        title: { selector: ".title", attr: "text", transform: "trim" },
        url: { selector: "a", attr: "href", transform: "absolute_url" },
        price: { selector: ".price", attr: "text", transform: "number" },
        sqm: { selector: ".sqm", attr: "text", transform: "number" },
        missing: { selector: ".nope", attr: "text", transform: "trim" },
      },
      paginate: { nextSelector: "#next", maxPages: 5 },
    },
  ],
  output: {
    eventType: "listing.published",
    keyField: "url",
    fields: [
      { name: "title", type: "string", required: true },
      { name: "url", type: "url", required: true },
      { name: "price", type: "number", required: true },
    ],
  },
});

describe.skipIf(!launch)("Playwright BrowserPort", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(request.url === "/p2" ? page(2) : page(1, "/p2"));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("replays a recipe: fill, extract with attr and transform, pagination, snapshot", async () => {
    const browser = await openPlaywrightBrowser({ launch, allowPrivateHosts: true });
    try {
      const recipe = RECIPE(base);
      const rows = await runRecipe(recipe, browser, { query: "trilocale" });
      expect(rows).toHaveLength(6);
      expect(rows[0]).toEqual({
        title: "Trilocale 1",
        url: `${base}/annunci/1`,
        price: 201000,
        sqm: 81.5,
        missing: null,
      });
      expect(rows[5]).toMatchObject({ title: "Trilocale 6", url: `${base}/annunci/6`, price: 206000 });
      expect(validateRows(recipe, rows).errors).toEqual([]);
      expect(await browser.currentUrl()).toBe(`${base}/p2`);
      expect(await browser.exists("#next")).toBe(false);

      await browser.goto(`${base}/`);
      const snapshot = await browser.snapshot();
      expect(snapshot).toContain("h1: Annunci pagina 1");
      expect(snapshot).toContain('input[name="q"]');
      expect(snapshot).toContain("list #results > li.card ×3");
      expect(snapshot).toContain("#next");
    } finally {
      await browser.close();
    }
  });

  it("refuses private addresses unless explicitly allowed", async () => {
    const browser = await openPlaywrightBrowser({ launch });
    try {
      await expect(browser.goto(`${base}/`)).rejects.toThrow("rete interna");
    } finally {
      await browser.close();
    }
  });
});

describe("scrape address guard", () => {
  it("accepts public http(s) addresses only", () => {
    expect(() => assertPublicUrl("https://www.example.com/annunci")).not.toThrow();
    for (const url of [
      "file:///etc/passwd",
      "http://localhost:5432",
      "http://192.168.1.10/",
      "http://169.254.169.254/latest",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(() => assertPublicUrl(url)).toThrow();
    }
  });
});
