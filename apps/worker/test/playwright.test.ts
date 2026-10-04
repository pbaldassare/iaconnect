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

describe.skipIf(!launch)("egress of the scraping browser", () => {
  // Two local servers behind made-up names: "public.test" is the site being read,
  // "internal.test" stands for anything on our own network.
  const hits = { site: [] as string[], internal: [] as string[] };
  let site: Server;
  let internal: Server;
  let siteUrl = "";
  let internalUrl = "";
  let internalPort = 0;
  const egress = async (hostname: string) => {
    if (hostname === "public.test") return ["127.0.0.1"];
    throw new Error(`refused: ${hostname}`);
  };

  beforeAll(async () => {
    internal = createServer((request, response) => {
      hits.internal.push(request.url ?? "");
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<h1>segreto interno</h1>");
    });
    await new Promise<void>((resolve) => internal.listen(0, "127.0.0.1", resolve));
    internalPort = (internal.address() as AddressInfo).port;
    internalUrl = `http://internal.test:${internalPort}`;
    site = createServer((request, response) => {
      hits.site.push(request.url ?? "");
      if (request.url === "/redirect") {
        response.writeHead(302, { location: `${internalUrl}/via-redirect` });
        response.end();
        return;
      }
      if (request.url === "/chain") {
        response.writeHead(302, { location: "/redirect" });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body><h1>Annunci</h1>
        <ul><li class="card"><a class="title" href="/annunci/1">Trilocale 1</a></li></ul>
        <img src="${internalUrl}/img">
        <img src="http://127.0.0.1:${internalPort}/loopback-ip">
        <img src="http://localhost:${internalPort}/loopback-name">
        <iframe src="${internalUrl}/frame"></iframe>
        <script>
          fetch("${internalUrl}/fetch").catch(() => {});
          fetch("http://[::1]:${internalPort}/v6").catch(() => {});
          navigator.sendBeacon && navigator.sendBeacon("http://127.0.0.1:${internalPort}/beacon", "x");
        </script>
      </body></html>`);
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    siteUrl = `http://public.test:${(site.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => site?.close(resolve));
    await new Promise((resolve) => internal?.close(resolve));
  });

  it("reads the site through the proxy and lets no subresource reach the internal network", async () => {
    const browser = await openPlaywrightBrowser({ launch, egress });
    try {
      await browser.goto(`${siteUrl}/`);
      await browser.waitFor({ ms: 500 });
      const rows = await browser.extractRows({
        action: "extract",
        listSelector: ".card",
        fields: { title: { selector: ".title", attr: "text", transform: "trim" } },
      });
      expect(rows).toEqual([{ title: "Trilocale 1" }]);
      expect(hits.site).toContain("/");
      // Images, frames, fetch and beacons towards internal names, loopback and ::1: none arrived.
      expect(hits.internal).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("does not follow a redirect from the public site to an internal address", async () => {
    const browser = await openPlaywrightBrowser({ launch, egress });
    try {
      for (const path of ["/redirect", "/chain"]) {
        await expect(browser.goto(`${siteUrl}${path}`), path).rejects.toThrow("rete interna");
      }
      expect(hits.site).toEqual(expect.arrayContaining(["/redirect", "/chain"]));
      expect(hits.internal).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("with the default policy refuses loopback, private and metadata addresses and names that resolve to them", async () => {
    const browser = await openPlaywrightBrowser({
      launch,
      // "rebind.test" has a public and a private address: one private address is enough.
      resolveHost: async (hostname) =>
        hostname === "rebind.test" ? ["93.184.216.34", "127.0.0.1"] : ["127.0.0.1"],
    });
    try {
      for (const url of [
        `http://127.0.0.1:${internalPort}/a`,
        `http://[::ffff:127.0.0.1]:${internalPort}/b`,
        "http://169.254.169.254/latest/meta-data/",
        `http://host.docker.internal:${internalPort}/c`,
        `http://rebind.test:${internalPort}/d`,
        `http://looks-public.test:${internalPort}/e`,
      ]) {
        await expect(browser.goto(url), url).rejects.toThrow("rete interna");
      }
      expect(hits.internal).toEqual([]);
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
      "http://[::ffff:127.0.0.1]/",
      "http://100.64.0.1/",
      "http://host.docker.internal/",
      "http://[::]/",
      "http://2130706433/",
      "https://user:pw@www.example.com/",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(() => assertPublicUrl(url)).toThrow();
    }
  });
});
