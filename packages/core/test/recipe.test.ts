import { describe, expect, it } from "vitest";
import { type BrowserPort, ScrapeRecipeSchema, isSameSite, registrableDomain, runRecipe } from "../src/index";

describe("runRecipe", () => {
  it("replays steps, fills secrets and follows pagination", async () => {
    const log: string[] = [];
    let page = 1;
    const browser: BrowserPort = {
      goto: async (url) => void log.push(`goto ${url}`),
      currentUrl: async () => "https://portale.test",
      snapshot: async () => "",
      click: async (selector) => {
        log.push(`click ${selector}`);
        if (selector === "a.next") page++;
      },
      fill: async (selector, value) => void log.push(`fill ${selector}=${value}`),
      waitFor: async () => {},
      extractRows: async () => [{ url: `https://portale.test/${page}` }],
      exists: async () => page < 3,
    };
    const recipe = ScrapeRecipeSchema.parse({
      steps: [
        { action: "goto", url: "https://portale.test/login" },
        { action: "fill", selector: "#user", value: "{{secrets.username}}" },
        { action: "click", selector: "button[type=submit]" },
        {
          action: "extract",
          listSelector: ".card",
          fields: { url: { selector: "a", attr: "href" } },
          paginate: { nextSelector: "a.next", maxPages: 5 },
        },
      ],
      output: { keyField: "url", fields: [{ name: "url", type: "url", required: true }] },
    });
    const rows = await runRecipe(recipe, browser, { username: "paolo" });
    expect(rows.map((row) => row.url)).toEqual([
      "https://portale.test/1",
      "https://portale.test/2",
      "https://portale.test/3",
    ]);
    expect(log).toContain("fill #user=paolo");
  });

  /** A browser whose address follows `goto`, and a login step after it. */
  function credentialsRun(gotoUrl: string) {
    const log: string[] = [];
    let url = "about:blank";
    const browser: BrowserPort = {
      goto: async (target) => {
        url = target;
        log.push(`goto ${target}`);
      },
      currentUrl: async () => url,
      snapshot: async () => "",
      click: async () => {},
      fill: async (selector, value) => void log.push(`fill ${selector}=${value}`),
      waitFor: async () => {},
      extractRows: async () => [],
      exists: async () => false,
    };
    const recipe = ScrapeRecipeSchema.parse({
      steps: [
        { action: "goto", url: gotoUrl },
        { action: "fill", selector: "#pass", value: "{{secrets.password}}" },
        { action: "extract", listSelector: ".card", fields: { url: { selector: "a", attr: "href" } } },
      ],
      output: { keyField: "url", fields: [{ name: "url", type: "url", required: true }] },
    });
    return { browser, log, recipe };
  }

  it("types credentials only on the site the recipe reads", async () => {
    const target = "https://www.portale.test/annunci";
    const secrets = { password: "s3greta-pw" };

    const elsewhere = credentialsRun("https://login.evil.test/");
    await expect(
      runRecipe(elsewhere.recipe, elsewhere.browser, secrets, { targetUrl: target }),
    ).rejects.toThrow(/non appartiene al sito/);
    expect(elsewhere.log.join("\n")).not.toContain("s3greta-pw");

    // Another host of the same site (a login subdomain) is fine; plain http of an https site is not.
    const sameSite = credentialsRun("https://accesso.portale.test/login");
    await runRecipe(sameSite.recipe, sameSite.browser, secrets, { targetUrl: target });
    expect(sameSite.log).toContain("fill #pass=s3greta-pw");
    const downgraded = credentialsRun("http://www.portale.test/login");
    await expect(
      runRecipe(downgraded.recipe, downgraded.browser, secrets, { targetUrl: target }),
    ).rejects.toThrow(/non appartiene al sito/);

    // Without an explicit target the recipe's first address is the site.
    const implicit = credentialsRun("https://www.portale.test/login");
    await runRecipe(implicit.recipe, implicit.browser, secrets);
    expect(implicit.log).toContain("fill #pass=s3greta-pw");
  });

  it("never puts a secret into an address", async () => {
    const run = credentialsRun("https://www.portale.test/?t={{secrets.password}}");
    await expect(
      run.browser && runRecipe(run.recipe, run.browser, { password: "s3greta-pw" }),
    ).rejects.toThrow(/non possono comparire in un indirizzo/);
    expect(run.log).toEqual([]);
  });

  it("compares sites by registrable domain", () => {
    expect(registrableDomain("www.shop.example.com")).toBe("example.com");
    expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("example.com.au")).toBe("example.com.au");
    expect(registrableDomain("203.0.113.7")).toBe("203.0.113.7");
    expect(isSameSite("https://a.example.co.uk/x", "https://b.example.co.uk/")).toBe(true);
    expect(isSameSite("https://evil.co.uk/x", "https://example.co.uk/")).toBe(false);
    expect(isSameSite("https://example.com.evil.test/", "https://example.com/")).toBe(false);
    expect(isSameSite("about:blank", "https://example.com/")).toBe(false);
    expect(isSameSite("data:text/html,x", "https://example.com/")).toBe(false);
  });
});
