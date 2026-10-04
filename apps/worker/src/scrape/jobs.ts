import {
  APP_LINKS,
  type AiUsage,
  type Row,
  type ScrapeRecipe,
  ScrapeRecipeSchema,
  hasSpentTokens,
  runRecipe,
  validateRows,
} from "@ia-connect/core";
import { type JobRow, consumeQuota, getConnection, logAiCall, notify, quotaLeft } from "../db/repo.ts";
import { type Sql, iso, json } from "../db/sql.ts";
import type { Deps, TraceResult } from "../deps.ts";
import { errorMessage } from "../errors.ts";
import { type JobResult, userPayload } from "../jobs/types.ts";
import { FinalJobFailure, RejectedJob } from "../queue.ts";

type RecipeRow = Row<"scrape_recipes">;
export const MAX_REPAIRS = 3;

async function loadRecipe(deps: Deps, job: JobRow): Promise<RecipeRow> {
  const recipeId = userPayload(job.kind === "scrape_trace" ? "scrape_trace" : "scrape_run", job).recipe_id;
  const rows = await deps.sql.query<RecipeRow>(
    "select * from ia_connect.scrape_recipes where id = $1 and organization_id = $2",
    [recipeId, job.organization_id],
  );
  if (!rows[0]) throw new RejectedJob("recipe not found in the job's organization");
  return rows[0];
}

/**
 * Credentials for a recipe: the secrets of its connection, only when that connection belongs
 * to the recipe's organization and is a "Sito o portale". `connection_id` is written by the
 * customer: without these checks a recipe could name any connection (another organization's
 * WhatsApp token) and type its secrets into a page of the customer's choice.
 */
export async function recipeSecrets(deps: Deps, recipe: RecipeRow): Promise<Record<string, unknown>> {
  if (!recipe.connection_id) return {};
  const connection = await getConnection(deps.sql, recipe.organization_id, recipe.connection_id);
  if (!connection || connection.connector_type !== "scraper_site" || connection.status === "disconnected") {
    deps.logger.warn("recipe connection ignored: not a site connection of the organization", {
      recipeId: recipe.id,
    });
    return {};
  }
  return deps.secrets.read(connection.id);
}

/**
 * Browser errors can quote what was typed (Playwright's call log shows the filled value):
 * credentials are blanked before a message is stored or shown.
 */
export function hideSecrets(text: string, secrets: Record<string, unknown>): string {
  return Object.values(secrets)
    .filter((value): value is string => typeof value === "string" && value.length >= 3)
    .sort((a, b) => b.length - a.length)
    .reduce((out, secret) => out.split(secret).join("[segreto]"), text);
}

function usageOf(error: unknown): AiUsage | undefined {
  const usage = (error as { usage?: Partial<AiUsage> } | null)?.usage;
  return usage && typeof usage.model === "string" && typeof usage.inputTokens === "number"
    ? (usage as AiUsage)
    : undefined;
}

interface Attempt {
  extracted: number;
  valid: Record<string, unknown>[];
  error: string | null;
}

/** Replays a recipe in a fresh browser. Zero valid rows counts as a failure. */
async function attempt(
  deps: Deps,
  recipe: ScrapeRecipe,
  secrets: Record<string, unknown>,
  targetUrl: string,
): Promise<Attempt> {
  const browser = await deps.openBrowser!();
  try {
    // Credentials are typed only on pages of the recipe's own site (`targetUrl`).
    const rows = await runRecipe(recipe, browser, secrets, { targetUrl });
    const { valid, errors } = validateRows(recipe, rows);
    const error = valid.length
      ? null
      : rows.length
        ? `Nessuna riga valida su ${rows.length}: ${errors.slice(0, 3).join("; ")}`
        : "Nessuna riga estratta dalla pagina.";
    return { extracted: rows.length, valid, error };
  } catch (error) {
    return { extracted: 0, valid: [], error: hideSecrets(errorMessage(error), secrets) };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** One event per row; the dedupe key lets only rows never seen before through. */
async function emitRows(
  sql: Sql,
  recipe: RecipeRow,
  definition: ScrapeRecipe,
  rows: Record<string, unknown>[],
  at: Date,
) {
  let created = 0;
  const { eventType, keyField } = definition.output;
  for (const row of rows) {
    const payload =
      eventType === "scrape.item.found"
        ? { recipeId: recipe.id, item: row }
        : { ...row, recipeId: recipe.id };
    const inserted = await sql.query(
      `insert into ia_connect.events (organization_id, type, connection_id, payload, dedupe_key, occurred_at)
       values ($1, $2, $3, $4::jsonb, $5, $6::timestamptz)
       on conflict (organization_id, dedupe_key) do nothing returning id`,
      [
        recipe.organization_id,
        eventType,
        recipe.connection_id,
        json(payload),
        `scrape:${recipe.id}:${String(row[keyField])}`,
        iso(at),
      ],
    );
    created += inserted.length;
  }
  return created;
}

async function saveVersion(
  sql: Sql,
  recipe: RecipeRow,
  definition: ScrapeRecipe,
  note: string,
): Promise<string> {
  const rows = await sql.query<{ id: string }>(
    `insert into ia_connect.scrape_recipe_versions (organization_id, recipe_id, version, recipe, generated_by, note)
     select $1, $2, coalesce(max(version), 0) + 1, $3::jsonb, 'ai', $4
     from ia_connect.scrape_recipe_versions where recipe_id = $2 and organization_id = $1
     returning id`,
    [recipe.organization_id, recipe.id, json(definition), note],
  );
  await sql.query("update ia_connect.scrape_recipes set active_version_id = $2 where id = $1", [
    recipe.id,
    rows[0]!.id,
  ]);
  return rows[0]!.id;
}

/** Asks the AI for a recipe (first trace or repair), metering the call. Undefined = AI not available. */
async function trace(
  deps: Deps,
  recipe: RecipeRow,
  secrets: Record<string, unknown>,
  previous?: { recipe: ScrapeRecipe; error: string },
): Promise<TraceResult | undefined> {
  if (!deps.tracer || !deps.openBrowser) return undefined;
  const left = await quotaLeft(deps.sql, recipe.organization_id, "ai_credits");
  if (left !== null && left <= 0) return undefined;
  const hasCredentials = Object.keys(secrets).length > 0;
  const purpose = previous ? "scrape_repair" : "scrape_trace";
  const browser = await deps.openBrowser();
  try {
    const result = await deps.tracer({
      url: recipe.target_url,
      goal: recipe.goal,
      browser,
      hasCredentials,
      // The tracer replaces `{{secrets.<name>}}` itself and hides the values from the model.
      secrets: hasCredentials ? secrets : undefined,
      previous,
    });
    await logAiCall(deps.sql, recipe.organization_id, purpose, result.usage);
    return { ...result, recipe: ScrapeRecipeSchema.parse(result.recipe) };
  } catch (error) {
    // A tracing that fails after spending tokens (`AiOperationError`) is metered all the same.
    const usage = usageOf(error);
    if (usage && hasSpentTokens(usage)) await logAiCall(deps.sql, recipe.organization_id, purpose, usage);
    throw new Error(hideSecrets(errorMessage(error), secrets));
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Scheduled replay of a recipe, without AI unless it breaks. */
export async function scrapeRun(deps: Deps, job: JobRow): Promise<JobResult> {
  const recipe = await loadRecipe(deps, job);
  const now = deps.now();
  const recurring = job.dedupe_key === `scrape:${recipe.id}`;
  const rescheduleAt = recurring ? new Date(now.getTime() + recipe.interval_minutes * 60_000) : undefined;
  // Paused, broken or never traced: the job ends; the ensure pass books it again once active.
  if (recipe.status !== "active" || !recipe.active_version_id) return;
  if (!deps.openBrowser) throw new Error("no browser available for scraping");

  const finish = (input: {
    versionId: string | null;
    status: string;
    attempt: Attempt;
    created: number;
    repaired: boolean;
  }) =>
    deps.sql.query(
      `insert into ia_connect.scrape_runs
         (organization_id, recipe_id, recipe_version_id, status, rows_extracted, new_rows, error, needed_repair, started_at, finished_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz)`,
      [
        recipe.organization_id,
        recipe.id,
        input.versionId,
        input.status,
        input.attempt.extracted,
        input.created,
        input.attempt.error,
        input.repaired,
        iso(now),
        iso(deps.now()),
      ],
    );

  if (!(await consumeQuota(deps.sql, recipe.organization_id, "scrape_runs"))) {
    await finish({
      versionId: recipe.active_version_id,
      status: "failed",
      attempt: { extracted: 0, valid: [], error: "Le letture del mese previste dal piano sono esaurite." },
      created: 0,
      repaired: false,
    });
    return { rescheduleAt };
  }

  const versions = await deps.sql.query<{ recipe: unknown }>(
    "select recipe from ia_connect.scrape_recipe_versions where id = $1 and recipe_id = $2 and organization_id = $3",
    [recipe.active_version_id, recipe.id, recipe.organization_id],
  );
  const parsed = ScrapeRecipeSchema.safeParse(versions[0]?.recipe);
  const secrets = await recipeSecrets(deps, recipe);
  const succeed = async (definition: ScrapeRecipe, versionId: string, result: Attempt, repaired: boolean) => {
    const created = await emitRows(deps.sql, recipe, definition, result.valid, now);
    await finish({ versionId, status: "succeeded", attempt: result, created, repaired });
    await deps.sql.query(
      "update ia_connect.scrape_recipes set last_run_at = $2::timestamptz, repair_attempts = 0 where id = $1",
      [recipe.id, iso(now)],
    );
  };

  const first: Attempt = parsed.success
    ? await attempt(deps, parsed.data, secrets, recipe.target_url)
    : { extracted: 0, valid: [], error: "La ricetta salvata non è valida." };
  if (!first.error && parsed.success) {
    await succeed(parsed.data, recipe.active_version_id, first, false);
    return { rescheduleAt };
  }

  // Repair: the AI traces the site again, the new recipe is tried at once and saved as a new version.
  let failure = first;
  let versionId = recipe.active_version_id;
  try {
    const traced = parsed.success
      ? await trace(deps, recipe, secrets, { recipe: parsed.data, error: first.error ?? "" })
      : await trace(deps, recipe, secrets);
    if (traced) {
      versionId = await saveVersion(
        deps.sql,
        recipe,
        traced.recipe,
        `Riparazione automatica: ${first.error ?? ""}`.slice(0, 500),
      );
      const second = await attempt(deps, traced.recipe, secrets, recipe.target_url);
      if (!second.error) {
        await succeed(traced.recipe, versionId, second, true);
        return { rescheduleAt };
      }
      failure = second;
    }
  } catch (error) {
    failure = {
      ...first,
      error: `${first.error ?? ""} Riparazione non riuscita: ${errorMessage(error)}`.trim(),
    };
  }

  await finish({ versionId, status: "failed", attempt: failure, created: 0, repaired: true });
  const attempts = recipe.repair_attempts + 1;
  const broken = attempts >= MAX_REPAIRS;
  await deps.sql.query(
    `update ia_connect.scrape_recipes set last_run_at = $2::timestamptz, repair_attempts = $3,
       status = case when $4 then 'broken' else status end where id = $1`,
    [recipe.id, iso(now), attempts, broken],
  );
  if (broken) {
    await notify(deps.sql, recipe.organization_id, {
      kind: "error",
      title: "Lettura del sito interrotta",
      body: `La lettura "${recipe.name}" non funziona più dopo ${MAX_REPAIRS} tentativi di riparazione ed è stata fermata. Ultimo errore: ${failure.error ?? "sconosciuto"}`,
      link: APP_LINKS.scrapeRecipe(recipe.id),
    });
  }
  return broken ? undefined : { rescheduleAt };
}

/** First trace of a site (or a new one asked by the customer): the AI explores, the worker saves the recipe. */
export async function scrapeTrace(deps: Deps, job: JobRow): Promise<JobResult> {
  const recipe = await loadRecipe(deps, job);
  const secrets = await recipeSecrets(deps, recipe);
  let traced: TraceResult | undefined;
  let failure = "La tracciatura non è disponibile: crediti IA esauriti o servizio non configurato.";
  try {
    traced = await trace(deps, recipe, secrets);
  } catch (error) {
    failure = errorMessage(error);
  }
  if (traced) {
    // The tracer proved the recipe on the browser it had explored (already logged in):
    // the scheduled runs start from a fresh one, so it is proved again from scratch.
    const check = await attempt(deps, traced.recipe, secrets, recipe.target_url);
    if (check.error) {
      failure = `la ricetta non funziona partendo da un browser appena aperto. ${check.error}`;
      traced = undefined;
    }
  }
  if (!traced) {
    await notify(deps.sql, recipe.organization_id, {
      kind: "error",
      title: "Tracciatura non riuscita",
      body: `Non è stato possibile tracciare "${recipe.name}": ${failure}`,
      link: APP_LINKS.scrapeRecipe(recipe.id),
    });
    // The recipe page reads the job: `failed` + `last_error` is how it knows the trace did not
    // produce a version. Not retried (a new trace costs AI credits) and already notified.
    throw new FinalJobFailure(failure);
  }
  await saveVersion(deps.sql, recipe, traced.recipe, "Prima tracciatura");
  // A broken recipe traced again is back in service; a draft stays a draft until the customer activates it.
  await deps.sql.query(
    `update ia_connect.scrape_recipes set repair_attempts = 0,
       status = case when status = 'broken' then 'active' else status end where id = $1`,
    [recipe.id],
  );
  await notify(deps.sql, recipe.organization_id, {
    kind: "info",
    title: "Tracciatura completata",
    body: `La lettura "${recipe.name}" è pronta: ${traced.sampleRows.length} righe di esempio trovate.`,
    link: APP_LINKS.scrapeRecipe(recipe.id),
  });
}
