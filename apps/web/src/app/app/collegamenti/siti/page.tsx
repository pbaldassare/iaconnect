import { AiBadge, StatusPill } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { errorMessage } from "@/lib/action";
import { isFeatureEnabled } from "@/lib/features";
import { formatNumber, formatRelative } from "@/lib/format";
import { intervalLabel } from "@/lib/scrape/describe";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { TRACE_LINE, recipeStatus } from "./labels";

export const metadata: Metadata = { title: "Siti e portali" };

export default async function RecipesPage() {
  const { supabase, org } = await requireOrg();
  const orgId = org.organization.id;
  const [recipes, runs, features] = await Promise.all([
    supabase
      .from("scrape_recipes")
      .select("id, name, target_url, status, interval_minutes, last_run_at, active_version_id")
      .eq("organization_id", orgId)
      .order("name")
      .limit(200),
    supabase
      .from("scrape_runs")
      .select("recipe_id, status, rows_extracted, new_rows, started_at")
      .eq("organization_id", orgId)
      .order("started_at", { ascending: false })
      .limit(500),
    supabase.from("org_features").select("feature_key, enabled").eq("organization_id", orgId),
  ]);
  const enabled = isFeatureEnabled(features.data ?? [], "scraping");
  const lastRun = new Map<string, NonNullable<typeof runs.data>[number]>();
  for (const run of runs.data ?? []) if (!lastRun.has(run.recipe_id)) lastRun.set(run.recipe_id, run);
  const rows = recipes.data ?? [];

  return (
    <>
      <PageHeader
        title="Siti e portali"
        description="Le pagine da cui leggere le novità a orari fissi: annunci, listini, portali con accesso."
        back={{ href: "/app/collegamenti", label: "Collegamenti" }}
        actions={
          org.canManage && enabled ? (
            <ButtonLink href="/app/collegamenti/siti/nuova" icon="plus">
              Nuova lettura
            </ButtonLink>
          ) : null
        }
      />
      <div className="grid gap-5">
        <Notice tone="ai" title={<AiBadge>Tracciata dall'IA, eseguita dal server</AiBadge>}>
          {TRACE_LINE}
        </Notice>
        {!enabled ? (
          <Notice tone="warning">
            La lettura da siti non è attiva per la tua azienda. Chiedi all'assistenza di attivarla.
          </Notice>
        ) : null}
        {recipes.error || runs.error ? (
          <Notice tone="error">{errorMessage(recipes.error ?? runs.error)}</Notice>
        ) : null}
        {rows.length === 0 && !recipes.error ? (
          <EmptyState
            icon="search"
            title="Nessuna lettura"
            description="Qui compaiono i siti che la piattaforma controlla per te. Indica una pagina e cosa leggere: ogni nuova riga trovata diventa un evento da cui far partire un flusso."
            action={
              org.canManage && enabled ? (
                <ButtonLink href="/app/collegamenti/siti/nuova">Crea la prima lettura</ButtonLink>
              ) : undefined
            }
          />
        ) : null}
        {rows.length > 0 ? (
          <Table caption="Letture da siti e portali" minWidth={720}>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Stato</Th>
                <Th>Frequenza</Th>
                <Th>Ultima lettura</Th>
                <Th align="right">Righe trovate</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((recipe) => {
                const run = lastRun.get(recipe.id);
                return (
                  <tr key={recipe.id}>
                    <Td>
                      <Link
                        href={`/app/collegamenti/siti/${recipe.id}`}
                        className="font-semibold underline-offset-2 hover:underline"
                      >
                        {recipe.name}
                      </Link>
                      <span className="block max-w-[38ch] truncate text-[13px] text-muted">
                        {recipe.target_url}
                      </span>
                    </Td>
                    <Td>
                      <StatusPill {...recipeStatus(recipe.status)} />
                      {!recipe.active_version_id ? (
                        <span className="mt-1 block text-[13px] text-muted">In attesa di tracciatura</span>
                      ) : null}
                    </Td>
                    <Td muted>{intervalLabel(recipe.interval_minutes)}</Td>
                    <Td muted>
                      {run ? formatRelative(run.started_at) : "Mai eseguita"}
                      {run?.status === "failed" ? <span className="block text-danger">fallita</span> : null}
                    </Td>
                    <Td align="right" mono>
                      {run
                        ? `${formatNumber(run.rows_extracted)} (${formatNumber(run.new_rows)} nuove)`
                        : "—"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : null}
      </div>
    </>
  );
}
