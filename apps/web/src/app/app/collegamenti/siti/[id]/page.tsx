import { AutoRefresh, RefreshButton } from "@/components/flows/auto-refresh";
import { AiBadge, Badge, StatusPill } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { errorMessage } from "@/lib/action";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { isUuid } from "@/lib/org-selection";
import { firstParam } from "@/lib/pagination";
import { describeRecipe, intervalLabel, scrapeRunStatus } from "@/lib/scrape/describe";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { retraceRecipe, runRecipeNow, setRecipeStatus } from "../actions";
import { TRACE_LINE, recipeStatus } from "../labels";

export const metadata: Metadata = { title: "Lettura da sito" };

export default async function RecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, org } = await requireOrg();
  const orgId = org.organization.id;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const outcome = firstParam((await searchParams).esito);

  const { data: recipe } = await supabase
    .from("scrape_recipes")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!recipe) notFound();

  const [versions, runs, jobs, connection] = await Promise.all([
    supabase
      .from("scrape_recipe_versions")
      .select("id, version, recipe, generated_by, note, created_at")
      .eq("organization_id", orgId)
      .eq("recipe_id", recipe.id)
      .order("version", { ascending: false })
      .limit(20),
    supabase
      .from("scrape_runs")
      .select("id, status, rows_extracted, new_rows, error, needed_repair, started_at, finished_at")
      .eq("organization_id", orgId)
      .eq("recipe_id", recipe.id)
      .order("started_at", { ascending: false })
      .limit(30),
    supabase
      .from("scheduled_jobs")
      .select("id, kind, status, last_error, created_at")
      .eq("organization_id", orgId)
      .in("kind", ["scrape_trace", "scrape_run"])
      .contains("payload", { recipe_id: recipe.id })
      .order("created_at", { ascending: false })
      .limit(5),
    recipe.connection_id
      ? supabase
          .from("connections")
          .select("id, name")
          .eq("id", recipe.connection_id)
          .eq("organization_id", orgId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const pending = (jobs.data ?? []).filter((job) => job.status === "pending" || job.status === "running");
  const tracing = pending.some((job) => job.kind === "scrape_trace");
  const lastJob = (jobs.data ?? [])[0];
  const traceFailed =
    lastJob?.kind === "scrape_trace" && lastJob.status === "failed" && !recipe.active_version_id;
  const versionRows = versions.data ?? [];
  const runRows = runs.data ?? [];

  return (
    <>
      <PageHeader
        title={recipe.name}
        eyebrow="Siti e portali"
        description={recipe.target_url}
        back={{ href: "/app/collegamenti/siti", label: "Siti e portali" }}
        actions={<StatusPill {...recipeStatus(recipe.status)} />}
      />
      <div className="grid gap-5">
        {outcome === "creata" ? (
          <Notice tone="ok" announce="status">
            Lettura creata. La tracciatura del percorso è partita: di solito richiede qualche minuto.
          </Notice>
        ) : null}
        {outcome === "creata-senza-tracciatura" ? (
          <Notice tone="warning">
            Lettura creata, ma la richiesta di tracciatura non è partita. Usa «Rigenera il percorso» qui
            sotto.
          </Notice>
        ) : null}
        {versions.error || runs.error ? (
          <Notice tone="error">{errorMessage(versions.error ?? runs.error)}</Notice>
        ) : null}
        {tracing ? (
          <Notice tone="ai" title="Tracciatura in corso">
            L'IA sta esplorando il sito per trovare il percorso. Al termine compare una nuova versione.
          </Notice>
        ) : null}
        {traceFailed ? (
          <Notice tone="error" title="La tracciatura non è riuscita">
            Controlla l'indirizzo e la descrizione, poi rigenera il percorso. Se il sito richiede l'accesso,
            collega prima le credenziali.
          </Notice>
        ) : null}
        {recipe.status === "broken" ? (
          <Notice tone="error" title="Lettura guasta">
            Il sito è cambiato e le riparazioni automatiche non sono bastate: la lettura è ferma. Rigenera il
            percorso per farla ripartire.
          </Notice>
        ) : null}
        <AutoRefresh active={pending.length > 0} />

        <Card>
          <CardHeader title="Cosa legge" description={TRACE_LINE} />
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-muted">Obiettivo</dt>
              <dd className="whitespace-pre-wrap">{recipe.goal || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Frequenza</dt>
              <dd>{intervalLabel(recipe.interval_minutes)}</dd>
            </div>
            <div>
              <dt className="text-muted">Ultima lettura</dt>
              <dd>{recipe.last_run_at ? formatRelative(recipe.last_run_at) : "Mai eseguita"}</dd>
            </div>
            <div>
              <dt className="text-muted">Accesso al sito</dt>
              <dd>{connection.data ? connection.data.name : "Pagina pubblica"}</dd>
            </div>
            {recipe.repair_attempts > 0 ? (
              <div>
                <dt className="text-muted">Riparazioni tentate</dt>
                <dd>{recipe.repair_attempts}</dd>
              </div>
            ) : null}
          </dl>
          {org.canManage ? (
            <div className="mt-5 flex flex-wrap items-start gap-2 border-t border-line pt-4">
              {recipe.status === "active" ? (
                <>
                  <ActionForm action={runRecipeNow.bind(null, recipe.id)} className="grid gap-2">
                    <SubmitButton pendingLabel="Richiesta…">Esegui ora</SubmitButton>
                  </ActionForm>
                  <ActionForm action={setRecipeStatus.bind(null, recipe.id, "paused")} className="grid gap-2">
                    <SubmitButton variant="secondary">Metti in pausa</SubmitButton>
                  </ActionForm>
                </>
              ) : recipe.status !== "broken" ? (
                <ActionForm action={setRecipeStatus.bind(null, recipe.id, "active")} className="grid gap-2">
                  <SubmitButton disabled={!recipe.active_version_id}>Attiva</SubmitButton>
                  {!recipe.active_version_id ? (
                    <p className="text-[13px] text-muted">Si attiva dopo la prima tracciatura.</p>
                  ) : null}
                </ActionForm>
              ) : null}
              <ActionForm action={retraceRecipe.bind(null, recipe.id)} className="grid gap-2">
                <SubmitButton variant="secondary" icon="spark" pendingLabel="Richiesta…">
                  Rigenera il percorso
                </SubmitButton>
              </ActionForm>
              <RefreshButton />
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title="Versioni del percorso"
            description="Ogni tracciatura o riparazione crea una versione."
          />
          {versionRows.length === 0 ? (
            <EmptyState
              compact
              title="Nessuna versione"
              description="La prima versione compare quando la tracciatura è finita."
            />
          ) : (
            <ol className="grid gap-3">
              {versionRows.map((version, index) => {
                const view = describeRecipe(version.recipe);
                const current = version.id === recipe.active_version_id;
                return (
                  <li key={version.id} className="rounded-lg border border-line">
                    <details open={index === 0}>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                        <span className="font-semibold">Versione {version.version}</span>
                        {current ? <Badge tone="ok">In uso</Badge> : null}
                        {version.generated_by === "ai" ? (
                          <AiBadge>Generata dall'IA</AiBadge>
                        ) : (
                          <Badge>Manuale</Badge>
                        )}
                        <span className="text-muted">{formatDateTime(version.created_at)}</span>
                      </summary>
                      <div className="grid gap-3 border-t border-line px-3 py-3 text-sm">
                        {version.note ? <p className="text-muted">{version.note}</p> : null}
                        {view ? (
                          <>
                            <ol className="grid list-decimal gap-1 pl-5">
                              {view.steps.map((step, position) => (
                                // biome-ignore lint/suspicious/noArrayIndexKey: steps are a fixed ordered list
                                <li key={position} className="break-words">
                                  {step}
                                </li>
                              ))}
                            </ol>
                            <p className="text-muted">
                              Dati di ogni riga: {view.fields.join(", ")}. Una riga è nuova quando cambia «
                              {view.keyField}».
                            </p>
                          </>
                        ) : (
                          <p className="text-danger">
                            Questa versione non è leggibile: rigenera il percorso.
                          </p>
                        )}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <section aria-labelledby="runs-title" className="grid gap-3">
          <h2 id="runs-title" className="font-display text-[17px] font-bold tracking-tight">
            Letture eseguite
          </h2>
          {runRows.length === 0 ? (
            <EmptyState
              compact
              title="Nessuna lettura eseguita"
              description="Dopo l'attivazione qui compare ogni lettura con le righe trovate e gli eventuali errori."
            />
          ) : (
            <Table caption="Letture eseguite" minWidth={680}>
              <thead>
                <tr>
                  <Th>Quando</Th>
                  <Th>Esito</Th>
                  <Th align="right">Righe</Th>
                  <Th align="right">Nuove</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody>
                {runRows.map((run) => (
                  <tr key={run.id}>
                    <Td mono>{formatDateTime(run.started_at)}</Td>
                    <Td>
                      <StatusPill {...scrapeRunStatus(run.status)} />
                    </Td>
                    <Td align="right" mono>
                      {formatNumber(run.rows_extracted)}
                    </Td>
                    <Td align="right" mono>
                      {formatNumber(run.new_rows)}
                    </Td>
                    <Td>
                      {run.needed_repair ? <Badge tone="warning">Ha richiesto riparazione</Badge> : null}
                      {run.error ? (
                        <span className="block max-w-[48ch] text-[13px] text-danger">{run.error}</span>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      </div>
    </>
  );
}
