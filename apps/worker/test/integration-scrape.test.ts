import { traceScrapeRecipe } from "@ia-connect/ai";
import type { BrowserPort, ExtractStep, ScrapeRecipe } from "@ia-connect/core";
import { afterEach, describe, expect, it } from "vitest";
import { drain } from "../src/worker.ts";
import { type Integration, createIntegration, leaks, toolUse } from "./integration-helpers.ts";

/**
 * Scraping with the REAL `traceScrapeRecipe` (scripted Claude) and a fake, login-gated site.
 * Credentials live in the worker's secret store; the tracer receives them as `secrets`,
 * types them in the browser and never shows them to the model.
 */

let t: Integration;
afterEach(async () => {
  await t?.db.close().catch(() => undefined);
});

const LOGIN = "https://portale.example.com/login";
const LIST = "https://portale.example.com/annunci";
const USERNAME = "agenzia.rossi";
const PASSWORD = "s3greta-Passw0rd";
const ROWS = [
  { title: "Trilocale centro", url: `${LIST}/1`, price: 185000 },
  { title: "Bilocale stazione", url: `${LIST}/2`, price: 120000 },
];

const recipe = (listSelector: string, withLogin = true): ScrapeRecipe => ({
  steps: [
    ...(withLogin
      ? ([
          { action: "goto", url: LOGIN },
          { action: "fill", selector: "#user", value: "{{secrets.username}}" },
          { action: "fill", selector: "#pass", value: "{{secrets.password}}" },
          { action: "click", selector: "#login" },
        ] as const)
      : []),
    { action: "goto", url: LIST },
    {
      action: "extract",
      listSelector,
      fields: {
        title: { selector: ".title", attr: "text", transform: "trim" },
        url: { selector: "a", attr: "href", transform: "absolute_url" },
        price: { selector: ".price", attr: "text", transform: "number" },
      },
    },
  ],
  output: {
    eventType: "listing.published",
    keyField: "url",
    fields: [
      { name: "title", type: "string", required: true },
      { name: "url", type: "url", required: true },
      { name: "price", type: "number", required: false },
    ],
  },
});

/** A site whose list is visible only after a login with the right credentials. */
function gatedSite(site: { listSelector: string; fillError?: boolean }) {
  const log = { opened: 0, closed: 0, fills: [] as string[] };
  const open = async () => {
    log.opened += 1;
    const state = { url: "about:blank", user: "", pass: "", logged: false };
    const port: BrowserPort & { close(): Promise<void> } = {
      async goto(url) {
        state.url = url.startsWith(LIST) && !state.logged ? LOGIN : url;
      },
      currentUrl: async () => state.url,
      async snapshot() {
        return state.logged && state.url === LIST
          ? `title: Annunci\nh1: Benvenuto ${state.user}\nlist ${site.listSelector} ×2\n  field .title: Trilocale centro`
          : "title: Accesso\nform #login-form\n  text #user\n  password #pass\n  submit #login";
      },
      async click(selector) {
        if (selector !== "#login") return;
        if (state.user !== USERNAME || state.pass !== PASSWORD)
          throw new Error("Credenziali rifiutate dal sito");
        state.logged = true;
        state.url = LIST;
      },
      async fill(selector, value) {
        log.fills.push(value);
        if (site.fillError) {
          // What Playwright reports when a field cannot be filled: the call log quotes the value.
          throw new Error(`page.fill: Timeout 20000ms exceeded.\nCall log:\n  - fill("${value}")`);
        }
        if (selector === "#user") state.user = value;
        if (selector === "#pass") state.pass = value;
      },
      waitFor: async () => undefined,
      exists: async () => false,
      async extractRows(step: ExtractStep) {
        if (!state.logged || state.url !== LIST) return [];
        if (step.listSelector !== site.listSelector)
          throw new Error(`Timeout: ${step.listSelector} non trovato`);
        return ROWS;
      },
      close: async () => {
        log.closed += 1;
      },
    };
    return port;
  };
  return { open, log };
}

async function setup(site: ReturnType<typeof gatedSite>) {
  t = await createIntegration();
  t.deps.openBrowser = site.open;
  // Same wiring as src/main.ts, with the scripted client in place of the API key's.
  t.deps.tracer = (input) => traceScrapeRecipe({ apiKey: "test-key", client: t.claude.client, ...input });
  const connection = await t.connect("scraper_site", {
    config: { url: LOGIN },
    secrets: { username: USERNAME, password: PASSWORD },
  });
  return connection;
}

async function addRecipe(connectionId: string, definition: ScrapeRecipe | null, status: string) {
  const row = await t.one(
    `insert into ia_connect.scrape_recipes (organization_id, name, target_url, goal, connection_id, status, interval_minutes)
     values ($1, 'Portale annunci', $2, 'Nuovi annunci pubblicati', $3, $4, 60) returning id`,
    [t.orgId, LOGIN, connectionId, status],
  );
  if (definition) {
    const version = await t.one(
      `insert into ia_connect.scrape_recipe_versions (organization_id, recipe_id, version, recipe, generated_by)
       values ($1, $2, 1, $3::jsonb, 'manual') returning id`,
      [t.orgId, row.id, JSON.stringify(definition)],
    );
    await t.sql.query("update ia_connect.scrape_recipes set active_version_id = $2 where id = $1", [
      row.id,
      version.id,
    ]);
  }
  return row.id as string;
}

const loginCalls = () => [
  toolUse("goto", { url: LOGIN }, "t1"),
  toolUse("snapshot", {}, "t2"),
  toolUse("fill", { selector: "#user", value: "{{secrets.username}}" }, "t3"),
  toolUse("fill", { selector: "#pass", value: "{{secrets.password}}" }, "t4"),
  toolUse("click", { selector: "#login" }, "t5"),
  toolUse("snapshot", {}, "t6"),
];

describe("scrape_trace with the real tracer", () => {
  it("traces a login-gated site without showing the credentials to the model, and proves the recipe on a fresh browser", async () => {
    const site = gatedSite({ listSelector: ".card" });
    const connection = await setup(site);
    const recipeId = await addRecipe(connection.id, null, "draft");
    t.claude.push(...loginCalls(), toolUse("propose_recipe", { recipe: recipe(".card") }, "t7"));
    await t.addJob("scrape_trace", { recipe_id: recipeId });
    await drain(t.deps);

    // The model was told to use placeholders and never saw the values, not even echoed by the page.
    const conversation = JSON.stringify(t.claude.requests);
    expect(String(t.claude.requests[0]!.system)).toContain("{{secrets.username}}");
    expect(conversation).not.toContain(PASSWORD);
    expect(conversation).not.toContain(USERNAME);
    expect(conversation).toContain("Benvenuto [segreto]");
    // The browser received the real ones: while exploring, in the tracer's replay, in the worker's check.
    expect(site.log.fills.filter((value) => value === PASSWORD)).toHaveLength(3);
    expect(site.log.fills).not.toContain("{{secrets.password}}");
    expect(site.log).toMatchObject({ opened: 2, closed: 2 });

    const version = await t.one(
      "select version, generated_by, recipe from ia_connect.scrape_recipe_versions",
    );
    expect(version).toMatchObject({ version: 1, generated_by: "ai" });
    expect(version.recipe.steps[2]).toEqual({
      action: "fill",
      selector: "#pass",
      value: "{{secrets.password}}",
    });
    expect(
      await t.one("select status, active_version_id is not null as traced from ia_connect.scrape_recipes"),
    ).toEqual({ status: "draft", traced: true });
    const call = await t.one(
      "select purpose, model, input_tokens, output_tokens, credits from ia_connect.ai_calls",
    );
    expect(call).toEqual({
      purpose: "scrape_trace",
      model: "claude-opus-5-5",
      input_tokens: 7 * 900,
      output_tokens: 7 * 150,
      credits: 8,
    });
    expect((await t.one("select title, body from ia_connect.notifications")).body).toContain(
      "2 righe di esempio",
    );
    expect(await leaks(t, [PASSWORD, USERNAME])).toEqual([]);

    // Once active, the scheduled run replays it with Playwright's port and no AI.
    await t.sql.query("update ia_connect.scrape_recipes set status = 'active' where id = $1", [recipeId]);
    await t.addJob("scrape_run", { recipe_id: recipeId });
    await drain(t.deps);
    expect(t.claude.requests).toHaveLength(7);
    const events = await t.all(
      "select type, dedupe_key, payload, connection_id from ia_connect.events order by dedupe_key",
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "listing.published",
      dedupe_key: `scrape:${recipeId}:${LIST}/1`,
      connection_id: connection.id,
      payload: { title: "Trilocale centro", url: `${LIST}/1`, price: 185000, recipeId },
    });
  });

  it("refuses a recipe that only works on the browser the tracer had already logged in", async () => {
    const site = gatedSite({ listSelector: ".card" });
    const connection = await setup(site);
    const recipeId = await addRecipe(connection.id, null, "draft");
    // The model forgets the login steps: its replay passes because the session is still open.
    t.claude.push(...loginCalls(), toolUse("propose_recipe", { recipe: recipe(".card", false) }, "t7"));
    await t.addJob("scrape_trace", { recipe_id: recipeId });
    await drain(t.deps);

    expect(await t.all("select 1 from ia_connect.scrape_recipe_versions")).toHaveLength(0);
    const notification = await t.one("select title, body from ia_connect.notifications");
    expect(notification.title).toBe("Tracciatura non riuscita");
    expect(notification.body).toContain("browser appena aperto");
    // The tokens were spent: the call is metered anyway.
    expect((await t.one("select purpose from ia_connect.ai_calls")).purpose).toBe("scrape_trace");
  });
});

describe("scrape_run repair with the real tracer", () => {
  it("repairs a recipe after the site changed, logging in with the stored credentials", async () => {
    const site = gatedSite({ listSelector: ".listing" });
    const connection = await setup(site);
    const recipeId = await addRecipe(connection.id, recipe(".card"), "active");
    t.claude.push(...loginCalls(), toolUse("propose_recipe", { recipe: recipe(".listing") }, "t7"));
    await t.addJob("scrape_run", { recipe_id: recipeId });
    await drain(t.deps);

    // The tracer got the broken recipe and its error as data.
    const first = JSON.stringify(t.claude.requests[0]!.messages[0]);
    expect(first).toContain(".card non trovato");
    expect(first).toContain("{{secrets.password}}");
    expect(JSON.stringify(t.claude.requests)).not.toContain(PASSWORD);

    expect(
      await t.all("select version, generated_by from ia_connect.scrape_recipe_versions order by version"),
    ).toEqual([
      { version: 1, generated_by: "manual" },
      { version: 2, generated_by: "ai" },
    ]);
    expect(await t.one("select status, new_rows, needed_repair, error from ia_connect.scrape_runs")).toEqual({
      status: "succeeded",
      new_rows: 2,
      needed_repair: true,
      error: null,
    });
    expect((await t.one("select purpose from ia_connect.ai_calls")).purpose).toBe("scrape_repair");
    expect(await t.all("select 1 from ia_connect.events where type = 'listing.published'")).toHaveLength(2);
    expect(await t.one("select status, repair_attempts from ia_connect.scrape_recipes")).toEqual({
      status: "active",
      repair_attempts: 0,
    });
    expect(await leaks(t, [PASSWORD])).toEqual([]);
  });

  it("keeps credentials out of the stored error and meters a tracing that fails", async () => {
    const site = gatedSite({ listSelector: ".card", fillError: true });
    const connection = await setup(site);
    const recipeId = await addRecipe(connection.id, recipe(".card"), "active");
    // The model starts, then declines: the tokens of both calls are spent.
    t.claude.push(toolUse("goto", { url: LOGIN }, "t1"), { stop_reason: "refusal", content: [] });
    await t.addJob("scrape_run", { recipe_id: recipeId });
    await drain(t.deps);

    const run = await t.one("select status, error, needed_repair from ia_connect.scrape_runs");
    expect(run).toMatchObject({ status: "failed", needed_repair: true });
    expect(run.error).toContain('fill("[segreto]")');
    expect(run.error).toContain("Riparazione non riuscita");
    expect(await t.one("select purpose, input_tokens from ia_connect.ai_calls")).toEqual({
      purpose: "scrape_repair",
      input_tokens: 1800,
    });
    expect(await t.one("select status, repair_attempts from ia_connect.scrape_recipes")).toEqual({
      status: "active",
      repair_attempts: 1,
    });
    expect(await leaks(t, [PASSWORD, USERNAME])).toEqual([]);
  });
});
