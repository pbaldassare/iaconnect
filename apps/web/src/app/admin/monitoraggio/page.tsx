import { Badge, StatusPill } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { aggregateAiSpend } from "@/lib/dashboard";
import {
  formatDateTime,
  formatMicros,
  formatMonth,
  formatNumber,
  formatRelative,
  shortId,
} from "@/lib/format";
import { aiPurposeLabel, queueStatus, runStatus } from "@/lib/labels";
import { requirePlatformAdmin } from "@/lib/session";
import { usagePeriod } from "@/lib/usage";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Monitoraggio" };
export const dynamic = "force-dynamic";

const AI_PAGE = 1000;
const AI_MAX_PAGES = 10;

export default async function MonitoringPage() {
  const { supabase } = await requirePlatformAdmin();
  const period = usagePeriod();

  const head = { count: "exact", head: true } as const;
  const [
    runs,
    failedEvents,
    failedJobs,
    pendingEvents,
    processingEvents,
    pendingJobs,
    runningJobs,
    oldestEvent,
    broken,
    organizations,
  ] = await Promise.all([
    supabase
      .from("flow_runs")
      .select("id, organization_id, flow_id, mode, status, error, started_at, finished_at")
      .order("started_at", { ascending: false })
      .limit(50),
    supabase
      .from("events")
      .select("id, organization_id, type, error, attempts, created_at")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("scheduled_jobs")
      .select("id, organization_id, kind, last_error, attempts, run_at")
      .eq("status", "failed")
      .order("run_at", { ascending: false })
      .limit(20),
    supabase.from("events").select("id", head).eq("status", "pending"),
    supabase.from("events").select("id", head).eq("status", "processing"),
    supabase
      .from("scheduled_jobs")
      .select("id", head)
      .eq("status", "pending")
      .lte("run_at", new Date().toISOString()),
    supabase.from("scheduled_jobs").select("id", head).eq("status", "running"),
    supabase
      .from("events")
      .select("available_at")
      .eq("status", "pending")
      .order("available_at")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("scrape_recipes")
      .select("id, organization_id, name, target_url, repair_attempts, last_run_at")
      .eq("status", "broken")
      .order("last_run_at", { ascending: false })
      .limit(50),
    supabase.from("organizations").select("id, name").limit(5000),
  ]);

  // AI calls of the month, paged (PostgREST returns at most 1000 rows per request).
  const aiCalls: { organization_id: string; purpose: string; cost_micros: number; credits: number }[] = [];
  let aiTruncated = false;
  let aiFailed = false;
  for (let page = 0; page < AI_MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("ai_calls")
      .select("organization_id, purpose, cost_micros, credits")
      .gte("created_at", period)
      .order("created_at")
      .range(page * AI_PAGE, (page + 1) * AI_PAGE - 1);
    if (error) {
      aiFailed = true;
      break;
    }
    aiCalls.push(...(data ?? []));
    if (!data || data.length < AI_PAGE) break;
    if (page === AI_MAX_PAGES - 1) aiTruncated = true;
  }
  const spend = aggregateAiSpend(aiCalls);
  const totalMicros = spend.reduce((sum, row) => sum + row.costMicros, 0);

  const runRows = runs.data ?? [];
  const flowIds = [...new Set(runRows.map((r) => r.flow_id))];
  const flows =
    flowIds.length > 0
      ? await supabase.from("flows").select("id, name").in("id", flowIds)
      : { data: [] as { id: string; name: string }[] };
  const flowNames = new Map((flows.data ?? []).map((f) => [f.id, f.name]));
  const orgNames = new Map((organizations.data ?? []).map((o) => [o.id, o.name]));
  const orgCell = (id: string | null) =>
    id ? (
      <Link href={`/admin/aziende/${id}`} className="hover:underline">
        {orgNames.get(id) ?? shortId(id)}
      </Link>
    ) : (
      "—"
    );

  const loadFailed = [runs, failedEvents, failedJobs, pendingEvents, pendingJobs, broken].some(
    (r) => r.error,
  );
  const tiles = [
    {
      label: "Eventi in coda",
      value: pendingEvents.count ?? 0,
      note: oldestEvent.data
        ? `il più vecchio: ${formatRelative(oldestEvent.data.available_at)}`
        : "coda vuota",
    },
    { label: "Eventi in lavorazione", value: processingEvents.count ?? 0, note: "presi dal worker" },
    { label: "Lavori da eseguire", value: pendingJobs.count ?? 0, note: "già scaduti e non ancora presi" },
    { label: "Lavori in esecuzione", value: runningJobs.count ?? 0, note: "presi dal worker" },
  ];

  return (
    <>
      <PageHeader
        title="Monitoraggio"
        description="Cosa sta facendo il motore in questo momento, su tutte le aziende. La pagina si aggiorna ricaricandola."
      />
      {loadFailed ? (
        <Notice tone="error" announce="alert" title="Alcuni dati non si sono caricati" className="mb-4">
          I numeri qui sotto potrebbero essere incompleti. Ricarica la pagina.
        </Notice>
      ) : null}

      <section aria-labelledby="code" className="mb-6">
        <h2 id="code" className="mb-2 font-display text-[17px] font-bold tracking-tight">
          Code
        </h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-panel border border-line bg-surface p-4">
              <dt className="text-sm font-semibold">{tile.label}</dt>
              <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                {formatNumber(tile.value)}
              </dd>
              <dd className="mt-0.5 text-[13px] text-muted">{tile.note}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="esecuzioni" className="mb-6">
        <h2 id="esecuzioni" className="mb-2 font-display text-[17px] font-bold tracking-tight">
          Ultime esecuzioni dei flussi
        </h2>
        {runRows.length === 0 ? (
          <EmptyState
            compact
            icon="pulse"
            title="Nessuna esecuzione"
            description="Appena un flusso parte, anche in simulazione, la trovi qui."
          />
        ) : (
          <Table caption="Ultime esecuzioni dei flussi" minWidth={860}>
            <thead>
              <tr>
                <Th>Inizio</Th>
                <Th>Azienda</Th>
                <Th>Flusso</Th>
                <Th>Modalità</Th>
                <Th>Stato</Th>
                <Th>Errore</Th>
              </tr>
            </thead>
            <tbody>
              {runRows.map((r) => (
                <tr key={r.id}>
                  <Td mono className="whitespace-nowrap">
                    {formatDateTime(r.started_at)}
                  </Td>
                  <Td>{orgCell(r.organization_id)}</Td>
                  <Td>{flowNames.get(r.flow_id) ?? shortId(r.flow_id)}</Td>
                  <Td>{r.mode === "simulation" ? <Badge>Simulazione</Badge> : "Reale"}</Td>
                  <Td>
                    <StatusPill {...runStatus(r.status)} />
                  </Td>
                  <Td muted className="max-w-[280px] text-[13px]">
                    {r.error ?? "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="eventi-falliti">
          <h2 id="eventi-falliti" className="mb-2 font-display text-[17px] font-bold tracking-tight">
            Eventi falliti
          </h2>
          {(failedEvents.data ?? []).length === 0 ? (
            <EmptyState compact icon="check" title="Nessun evento fallito" />
          ) : (
            <Table caption="Eventi falliti" minWidth={560}>
              <thead>
                <tr>
                  <Th>Quando</Th>
                  <Th>Azienda</Th>
                  <Th>Tipo</Th>
                  <Th align="right">Tentativi</Th>
                  <Th>Errore</Th>
                </tr>
              </thead>
              <tbody>
                {(failedEvents.data ?? []).map((e) => (
                  <tr key={e.id}>
                    <Td mono className="whitespace-nowrap">
                      {formatDateTime(e.created_at)}
                    </Td>
                    <Td>{orgCell(e.organization_id)}</Td>
                    <Td mono>{e.type}</Td>
                    <Td mono align="right">
                      {e.attempts}
                    </Td>
                    <Td muted className="max-w-[240px] text-[13px]">
                      {e.error ?? "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>

        <section aria-labelledby="lavori-falliti">
          <h2 id="lavori-falliti" className="mb-2 font-display text-[17px] font-bold tracking-tight">
            Lavori pianificati falliti
          </h2>
          {(failedJobs.data ?? []).length === 0 ? (
            <EmptyState compact icon="check" title="Nessun lavoro fallito" />
          ) : (
            <Table caption="Lavori pianificati falliti" minWidth={560}>
              <thead>
                <tr>
                  <Th>Previsto</Th>
                  <Th>Azienda</Th>
                  <Th>Tipo</Th>
                  <Th>Stato</Th>
                  <Th>Errore</Th>
                </tr>
              </thead>
              <tbody>
                {(failedJobs.data ?? []).map((j) => (
                  <tr key={j.id}>
                    <Td mono className="whitespace-nowrap">
                      {formatDateTime(j.run_at)}
                    </Td>
                    <Td>{orgCell(j.organization_id)}</Td>
                    <Td mono>{j.kind}</Td>
                    <Td>
                      <StatusPill {...queueStatus("failed")} label={`Fallito · ${j.attempts} tentativi`} />
                    </Td>
                    <Td muted className="max-w-[240px] text-[13px]">
                      {j.last_error ?? "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      </div>

      <section aria-labelledby="letture-rotte" className="mb-6">
        <h2 id="letture-rotte" className="mb-2 font-display text-[17px] font-bold tracking-tight">
          Letture da siti da riparare
        </h2>
        {(broken.data ?? []).length === 0 ? (
          <EmptyState
            compact
            icon="check"
            title="Nessuna lettura rotta"
            description="Quando un sito cambia e la riparazione automatica non basta, la lettura compare qui."
          />
        ) : (
          <Table caption="Letture da siti da riparare" minWidth={700}>
            <thead>
              <tr>
                <Th>Lettura</Th>
                <Th>Azienda</Th>
                <Th>Sito</Th>
                <Th align="right">Riparazioni tentate</Th>
                <Th>Ultima lettura</Th>
              </tr>
            </thead>
            <tbody>
              {(broken.data ?? []).map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium">{s.name}</Td>
                  <Td>{orgCell(s.organization_id)}</Td>
                  <Td mono muted className="max-w-[260px] truncate">
                    {s.target_url}
                  </Td>
                  <Td mono align="right">
                    {s.repair_attempts}
                  </Td>
                  <Td mono muted>
                    {s.last_run_at ? formatRelative(s.last_run_at) : "mai"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <Card padded={false} aria-labelledby="spesa-ia">
        <div className="p-4 pb-0 sm:p-5 sm:pb-0">
          <CardHeader
            id="spesa-ia"
            title="Spesa IA del mese"
            description={`${formatMonth(period)} · ${formatNumber(aiCalls.length)} chiamate · ${formatMicros(totalMicros)} in tutto`}
          />
          {aiFailed ? (
            <Notice tone="error" announce="alert" className="mb-4">
              Le chiamate IA non si sono caricate. Ricarica la pagina.
            </Notice>
          ) : null}
          {aiTruncated ? (
            <Notice tone="warning" className="mb-4">
              Questo mese ci sono più di {formatNumber(AI_PAGE * AI_MAX_PAGES)} chiamate: il totale qui sotto
              considera solo le prime.
            </Notice>
          ) : null}
        </div>
        {spend.length === 0 ? (
          <div className="p-4 pt-0 sm:p-5 sm:pt-0">
            <EmptyState compact icon="spark" title="Nessuna chiamata IA questo mese" />
          </div>
        ) : (
          <Table caption="Spesa IA per azienda e scopo" minWidth={620} bare className="border-t border-line">
            <thead>
              <tr>
                <Th>Azienda</Th>
                <Th>Scopo</Th>
                <Th align="right">Chiamate</Th>
                <Th align="right">Crediti</Th>
                <Th align="right">Costo</Th>
              </tr>
            </thead>
            <tbody>
              {spend.map((row) => (
                <tr key={`${row.organizationId}-${row.purpose}`}>
                  <Td>{orgCell(row.organizationId)}</Td>
                  <Td>
                    {aiPurposeLabel(row.purpose)}{" "}
                    <span className="font-mono text-[12px] text-muted">{row.purpose}</span>
                  </Td>
                  <Td mono align="right">
                    {formatNumber(row.calls)}
                  </Td>
                  <Td mono align="right">
                    {formatNumber(row.credits)}
                  </Td>
                  <Td mono align="right">
                    {formatMicros(row.costMicros)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
