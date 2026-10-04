import { describe, expect, it } from "vitest";
import { type BrowserPort, ScrapeRecipeSchema, runRecipe } from "../src/index";

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
});
