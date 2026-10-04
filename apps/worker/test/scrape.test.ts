import type { BrowserPort, ExtractStep, ScrapeRecipe } from "@ia-connect/core";
import { afterEach, describe, expect, it } from "vitest";
import type { TraceInput } from "../src/deps.ts";
import { ensureRecurringJobs } from "../src/ensure.ts";
import { drain } from "../src/worker.ts";
import { type Harness, USAGE, createHarness } from "./helpers.ts";

let h: Harness;
afterEach(async () => {
  await h?.db.close().catch(() => undefined);
});

const recipeFor = (listSelector: string): ScrapeRecipe => ({
  steps: [
    { action: "goto", url: "https://portale.example/annunci" },
    { action: "fill", selector: "#password", value: "{{secrets.password}}" },
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

const listing = (n: number) => ({
  title: `Trilocale ${n}`,
  url: `https://portale.example/annunci/${n}`,
  price: 100_000 + n,
});

/** A fake site: rows are served only for the selector that currently "works". */
function fakeSite(site: { selector: string; rows: Record<string, unknown>[] }) {
  const log = { opened: 0, closed: 0, filled: [] as string[] };
  const open = async () => {
    log.opened += 1;
    const port: BrowserPort & { close(): Promise<void> } = {
      goto: async () => undefined,
      currentUrl: async () => "https://portale.example/annunci",
      snapshot: async () => "list .card ×3",
      click: async () => undefined,
      fill: async (_selector, value) => {
        log.filled.push(value);
      },
      waitFor: async () => undefined,
      exists: async () => false,
      extractRows: async (step: ExtractStep) => {
        if (step.listSelector !== site.selector) throw new Error(`Timeout: ${step.listSelector} non trovato`);
        return site.rows;
      },
      close: async () => {
        log.closed += 1;
      },
    };
    return port;
  };
  return { open, log };
}

/** The "Sito o portale" connection of the organization: the only kind a recipe takes credentials from. */
async function siteConnection(harness: Harness): Promise<string> {
  const existing = await harness.one(
    "select id from ia_connect.connections where organization_id = $1 and connector_type = 'scraper_site'",
    [harness.orgId],
  );
  if (existing) return existing.id as string;
  const row = await harness.one(
    "insert into ia_connect.connections (organization_id, connector_type, name) values ($1, 'scraper_site', 'Portale') returning id",
    [harness.orgId],
  );
  return row.id as string;
}

async function addRecipe(harness: Harness, recipe: ScrapeRecipe | null, status = "active") {
  const row = await harness.one(
    `insert into ia_connect.scrape_recipes (organization_id, name, target_url, goal, connection_id, status, interval_minutes)
     values ($1, 'Portale', 'https://portale.example/annunci', 'Nuovi annunci', $2, $3, 60) returning id`,
    [harness.orgId, await siteConnection(harness), status],
  );
  if (recipe) {
    const version = await harness.one(
      `insert into ia_connect.scrape_recipe_versions (organization_id, recipe_id, version, recipe, generated_by)
       values ($1, $2, 1, $3::jsonb, 'manual') returning id`,
      [harness.orgId, row.id, JSON.stringify(recipe)],
    );
    await harness.sql.query("update ia_connect.scrape_recipes set active_version_id = $2 where id = $1", [
      row.id,
      version.id,
    ]);
  }
  return row.id as string;
}

const HOUR = 3_600_000;

describe("scrape_run", () => {
  it("emits an event only for rows never seen before", async () => {
    h = await createHarness();
    const site = {
      selector: ".card",
      rows: [listing(1), listing(2), { title: "Senza indirizzo", url: "", price: 1 }],
    };
    const fake = fakeSite(site);
    h.deps.openBrowser = fake.open;
    await h.deps.secrets.write(await siteConnection(h), { password: "s3greta" });
    const recipeId = await addRecipe(h, recipeFor(".card"));

    await ensureRecurringJobs(h.deps);
    await drain(h.deps);
    site.rows = [listing(1), listing(2), listing(3)];
    h.advance(HOUR + 1_000);
    await drain(h.deps);

    const events = await h.all(
      "select type, payload, dedupe_key, connection_id from ia_connect.events order by created_at",
    );
    expect(events.map((event) => event.dedupe_key)).toEqual(
      [1, 2, 3].map((n) => `scrape:${recipeId}:https://portale.example/annunci/${n}`),
    );
    expect(events[0]).toMatchObject({
      type: "listing.published",
      payload: { ...listing(1), recipeId },
      connection_id: await siteConnection(h),
    });
    const runs = await h.all(
      "select status, rows_extracted, new_rows, needed_repair from ia_connect.scrape_runs order by created_at",
    );
    expect(runs).toEqual([
      { status: "succeeded", rows_extracted: 3, new_rows: 2, needed_repair: false },
      { status: "succeeded", rows_extracted: 3, new_rows: 1, needed_repair: false },
    ]);
    // Credentials reach the page through the placeholder; every browser is closed.
    expect(fake.log.filled).toEqual(["s3greta", "s3greta"]);
    expect(fake.log.closed).toBe(fake.log.opened);
    expect(
      (await h.one("select value::int as value from ia_connect.usage_counters where metric = 'scrape_runs'"))
        .value,
    ).toBe(2);
    expect(await h.all("select * from ia_connect.ai_calls")).toHaveLength(0);
    expect(
      (await h.one("select status from ia_connect.scheduled_jobs where kind = 'scrape_run'")).status,
    ).toBe("pending");
  });

  it("repairs a broken recipe with the tracer and saves a new version", async () => {
    h = await createHarness();
    const fake = fakeSite({ selector: ".listing", rows: [listing(1)] });
    h.deps.openBrowser = fake.open;
    const traces: TraceInput[] = [];
    h.deps.tracer = async (input) => {
      traces.push(input);
      return { recipe: recipeFor(".listing"), sampleRows: [listing(1)], usage: USAGE };
    };
    const recipeId = await addRecipe(h, recipeFor(".card"));
    await h.addJob(
      "scrape_run",
      { recipe_id: recipeId },
      { createdBy: "00000000-0000-0000-0000-0000000000aa" },
    );
    await drain(h.deps);

    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      url: "https://portale.example/annunci",
      goal: "Nuovi annunci",
      hasCredentials: false,
    });
    expect(traces[0]!.previous!.error).toContain(".card non trovato");
    const versions = await h.all(
      "select version, generated_by from ia_connect.scrape_recipe_versions order by version",
    );
    expect(versions).toEqual([
      { version: 1, generated_by: "manual" },
      { version: 2, generated_by: "ai" },
    ]);
    expect(await h.one("select status, new_rows, needed_repair from ia_connect.scrape_runs")).toEqual({
      status: "succeeded",
      new_rows: 1,
      needed_repair: true,
    });
    expect(await h.one("select purpose, credits from ia_connect.ai_calls")).toEqual({
      purpose: "scrape_repair",
      credits: 2,
    });
    expect(await h.one("select status, repair_attempts from ia_connect.scrape_recipes")).toEqual({
      status: "active",
      repair_attempts: 0,
    });
    expect(await h.all("select * from ia_connect.events")).toHaveLength(1);
  });

  it("marks the recipe broken and notifies after three failed repairs", async () => {
    h = await createHarness();
    h.deps.openBrowser = fakeSite({ selector: ".nowhere", rows: [] }).open;
    h.deps.tracer = async () => ({ recipe: recipeFor(".still-wrong"), sampleRows: [], usage: USAGE });
    await addRecipe(h, recipeFor(".card"));
    await ensureRecurringJobs(h.deps);
    for (let round = 0; round < 5; round++) {
      await drain(h.deps);
      h.advance(HOUR + 1_000);
      await ensureRecurringJobs(h.deps);
    }
    expect(await h.one("select status, repair_attempts from ia_connect.scrape_recipes")).toEqual({
      status: "broken",
      repair_attempts: 3,
    });
    expect((await h.all("select status from ia_connect.scrape_runs")).map((run) => run.status)).toEqual([
      "failed",
      "failed",
      "failed",
    ]);
    expect((await h.all("select title from ia_connect.notifications")).map((row) => row.title)).toEqual([
      "Lettura del sito interrotta",
    ]);
    expect(await h.all("select * from ia_connect.events")).toHaveLength(0);
    expect(await h.all("select * from ia_connect.scrape_recipe_versions")).toHaveLength(4);
  });

  it("stops at the monthly scrape quota", async () => {
    h = await createHarness();
    // The organization's plan has no scrape runs left.
    await h.sql.query(
      `update ia_connect.plans set limits = limits || '{"scrape_runs_per_month": 0}'
       where id = (select plan_id from ia_connect.organizations where id = $1)`,
      [h.orgId],
    );
    const fake = fakeSite({ selector: ".card", rows: [listing(1)] });
    h.deps.openBrowser = fake.open;
    const recipeId = await addRecipe(h, recipeFor(".card"));
    await h.addJob("scrape_run", { recipe_id: recipeId });
    await drain(h.deps);
    expect(fake.log.opened).toBe(0);
    expect((await h.one("select error from ia_connect.scrape_runs")).error).toContain("esaurite");
  });
});

describe("scrape_trace", () => {
  it("creates the first version, logs the AI usage and leaves a draft a draft", async () => {
    h = await createHarness();
    h.deps.openBrowser = fakeSite({ selector: ".card", rows: [listing(1)] }).open;
    h.deps.tracer = async () => ({
      recipe: recipeFor(".card"),
      sampleRows: [listing(1), listing(2)],
      usage: USAGE,
    });
    const recipeId = await addRecipe(h, null, "draft");
    await h.addJob(
      "scrape_trace",
      { recipe_id: recipeId },
      { createdBy: "00000000-0000-0000-0000-0000000000aa" },
    );
    await drain(h.deps);
    const version = await h.one("select id, version, generated_by from ia_connect.scrape_recipe_versions");
    expect(version).toMatchObject({ version: 1, generated_by: "ai" });
    expect(await h.one("select status, active_version_id from ia_connect.scrape_recipes")).toEqual({
      status: "draft",
      active_version_id: version.id,
    });
    expect((await h.one("select purpose from ia_connect.ai_calls")).purpose).toBe("scrape_trace");
    expect((await h.one("select body from ia_connect.notifications")).body).toContain("2 righe di esempio");
  });
});
