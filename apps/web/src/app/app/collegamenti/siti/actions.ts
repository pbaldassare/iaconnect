"use server";
import { type ActionResult, fail, failFromError, ok, parseForm } from "@/lib/action";
import { isFeatureEnabled } from "@/lib/features";
import { requestJob } from "@/lib/jobs";
import { isUuid } from "@/lib/org-selection";
import { type OrgContext, actorOf, requireOrgManager } from "@/lib/session";
import type { Row } from "@ia-connect/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const BASE = "/app/collegamenti/siti";

const RecipeSchema = z.object({
  name: z.string().trim().min(2, "Scrivi un nome di almeno 2 caratteri.").max(120, "Il nome è troppo lungo."),
  target_url: z
    .string()
    .trim()
    .url("Scrivi l'indirizzo completo, ad esempio https://www.esempio.it/annunci.")
    .refine((value) => /^https?:\/\//i.test(value), "L'indirizzo deve iniziare con http:// o https://."),
  goal: z
    .string()
    .trim()
    .min(10, "Descrivi in una frase cosa va letto dalla pagina.")
    .max(2000, "La descrizione è troppo lunga."),
  connection_id: z.string().optional(),
  interval_minutes: z.coerce
    .number("Scrivi un numero di minuti.")
    .int("Scrivi un numero intero di minuti.")
    .min(15, "L'intervallo minimo è 15 minuti.")
    .max(10_080, "L'intervallo massimo è una settimana (10080 minuti)."),
});

async function scrapingEnabled(context: OrgContext): Promise<boolean> {
  const { data } = await context.supabase
    .from("org_features")
    .select("feature_key, enabled")
    .eq("organization_id", context.org.organization.id);
  return isFeatureEnabled(data ?? [], "scraping");
}

async function loadRecipe(context: OrgContext, recipeId: string): Promise<Row<"scrape_recipes"> | null> {
  if (!isUuid(recipeId)) return null;
  const { data } = await context.supabase
    .from("scrape_recipes")
    .select("*")
    .eq("id", recipeId)
    .eq("organization_id", context.org.organization.id)
    .maybeSingle();
  return data;
}

function minuteKey(prefix: string, id: string): string {
  return `${prefix}:${id}:${Math.floor(Date.now() / 60_000)}`;
}

/** Creates the recipe as a draft and asks the worker to trace the site (the only AI step). */
export async function createRecipe(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const context = await requireOrgManager();
  if (!(await scrapingEnabled(context))) return fail("La lettura da siti non è attiva per la tua azienda.");
  const parsed = parseForm(RecipeSchema, formData);
  if (!parsed.ok) return parsed.result;
  const orgId = context.org.organization.id;

  let connectionId: string | null = null;
  if (parsed.data.connection_id) {
    if (!isUuid(parsed.data.connection_id)) return fail("Collegamento non valido.");
    const { data: connection } = await context.supabase
      .from("connections")
      .select("id, connector_type")
      .eq("id", parsed.data.connection_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!connection || connection.connector_type !== "scraper_site") {
      return fail("Scegli un collegamento di tipo «Sito o portale».", {
        connection_id: "Collegamento non valido.",
      });
    }
    connectionId = connection.id;
  }

  const { data: recipe, error } = await context.supabase
    .from("scrape_recipes")
    .insert({
      organization_id: orgId,
      name: parsed.data.name,
      target_url: parsed.data.target_url,
      goal: parsed.data.goal,
      connection_id: connectionId,
      interval_minutes: parsed.data.interval_minutes,
      status: "draft",
    })
    .select("id")
    .single();
  if (error) return failFromError(error);

  const job = await requestJob(context.supabase, {
    organizationId: orgId,
    kind: "scrape_trace",
    payload: { recipe_id: recipe.id },
    dedupeKey: minuteKey("trace-now", recipe.id),
    actor: actorOf(context),
  });
  revalidatePath(BASE);
  redirect(`${BASE}/${recipe.id}?esito=${job.error ? "creata-senza-tracciatura" : "creata"}`);
}

/** Activates (needs a traced version) or pauses a recipe. */
export async function setRecipeStatus(
  recipeId: string,
  status: "active" | "paused",
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrgManager();
  if (status !== "active" && status !== "paused") return fail("Stato non valido.");
  const recipe = await loadRecipe(context, recipeId);
  if (!recipe) return fail("Lettura non trovata.");
  if (status === "active") {
    if (!(await scrapingEnabled(context))) return fail("La lettura da siti non è attiva per la tua azienda.");
    if (!recipe.active_version_id) {
      return fail(
        "Il percorso non è ancora stato tracciato: aspetta la fine della tracciatura o rigenerala.",
      );
    }
  }
  const { error } = await context.supabase
    .from("scrape_recipes")
    .update(status === "active" ? { status, repair_attempts: 0 } : { status })
    .eq("id", recipe.id)
    .eq("organization_id", context.org.organization.id);
  if (error) return failFromError(error);
  revalidatePath(BASE);
  revalidatePath(`${BASE}/${recipe.id}`);
  return ok(
    status === "active"
      ? "Lettura attivata: il server la ripete all'intervallo scelto."
      : "Lettura in pausa: non verrà più eseguita finché non la riattivi.",
  );
}

/** One extra run now, without waiting for the interval. */
export async function runRecipeNow(
  recipeId: string,
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrgManager();
  const recipe = await loadRecipe(context, recipeId);
  if (!recipe) return fail("Lettura non trovata.");
  if (recipe.status !== "active" || !recipe.active_version_id) {
    return fail("Si può eseguire solo una lettura attiva: attivala prima.");
  }
  const { error } = await requestJob(context.supabase, {
    organizationId: context.org.organization.id,
    kind: "scrape_run",
    payload: { recipe_id: recipe.id },
    dedupeKey: minuteKey("scrape-now", recipe.id),
    actor: actorOf(context),
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") return ok("La lettura è già stata richiesta.");
    return failFromError(error);
  }
  revalidatePath(`${BASE}/${recipe.id}`);
  return ok("Lettura richiesta: l'esito compare qui sotto tra poco.");
}

/** Asks the AI to trace the path again (uses AI credits). */
export async function retraceRecipe(
  recipeId: string,
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrgManager();
  const recipe = await loadRecipe(context, recipeId);
  if (!recipe) return fail("Lettura non trovata.");
  if (!(await scrapingEnabled(context))) return fail("La lettura da siti non è attiva per la tua azienda.");
  const { error } = await requestJob(context.supabase, {
    organizationId: context.org.organization.id,
    kind: "scrape_trace",
    payload: { recipe_id: recipe.id },
    dedupeKey: minuteKey("trace-now", recipe.id),
    actor: actorOf(context),
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") return ok("La tracciatura è già stata richiesta.");
    return failFromError(error);
  }
  revalidatePath(`${BASE}/${recipe.id}`);
  return ok("Tracciatura richiesta: quando finisce compare una nuova versione qui sotto.");
}
