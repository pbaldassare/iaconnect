import { RunSteps } from "@/components/flows/run-steps";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { errorMessage } from "@/lib/action";
import { blockTitle, eventTitle } from "@/lib/flows/describe";
import { formatDuration, stepTitles } from "@/lib/flows/runs";
import { formatDateTime, formatMicros } from "@/lib/format";
import { runStatus } from "@/lib/labels";
import { isUuid } from "@/lib/org-selection";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Esecuzione" };

export default async function RunPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { supabase, org } = await requireOrg();
  const orgId = org.organization.id;
  const { id, runId } = await params;
  if (!isUuid(id) || !isUuid(runId)) notFound();

  const { data: run } = await supabase
    .from("flow_runs")
    .select(
      "id, flow_id, flow_version_id, event_id, mode, status, current_step_id, contact_id, waiting_for, wait_until, error, started_at, finished_at",
    )
    .eq("id", runId)
    .eq("flow_id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!run) notFound();

  const [flow, version, steps, event, contact, stages] = await Promise.all([
    supabase
      .from("flows")
      .select("id, name")
      .eq("id", run.flow_id)
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase
      .from("flow_versions")
      .select("version, definition")
      .eq("id", run.flow_version_id)
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase
      .from("flow_run_steps")
      .select(
        "id, step_id, block, status, outlet, input, output, error, ai_cost_micros, duration_ms, created_at",
      )
      .eq("organization_id", orgId)
      .eq("flow_run_id", run.id)
      .order("created_at")
      .limit(500),
    run.event_id
      ? supabase
          .from("events")
          .select("id, type, occurred_at")
          .eq("id", run.event_id)
          .eq("organization_id", orgId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    run.contact_id
      ? supabase
          .from("contacts")
          .select("id, full_name")
          .eq("id", run.contact_id)
          .eq("organization_id", orgId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("deal_stages").select("key, name").eq("organization_id", orgId),
  ]);
  const stageNames = Object.fromEntries((stages.data ?? []).map((stage) => [stage.key, stage.name]));
  const titles = stepTitles(version.data?.definition, blockTitle);
  const stepRows = steps.data ?? [];
  const totalCost = stepRows.reduce((sum, step) => sum + step.ai_cost_micros, 0);
  const totalDuration = stepRows.reduce((sum, step) => sum + step.duration_ms, 0);

  return (
    <>
      <PageHeader
        title={`Esecuzione del ${formatDateTime(run.started_at)}`}
        eyebrow={flow.data?.name ?? "Flusso"}
        back={{ href: `/app/flussi/${id}?scheda=esecuzioni`, label: "Esecuzioni" }}
        actions={
          <>
            {run.mode === "simulation" ? <Badge>Simulazione</Badge> : null}
            <StatusPill {...runStatus(run.status)} />
          </>
        }
      />
      <div className="grid max-w-4xl gap-5">
        {steps.error ? <Notice tone="error">{errorMessage(steps.error)}</Notice> : null}
        {run.error ? (
          <Notice tone="error" title="L'esecuzione si è fermata con un errore">
            {run.error}
          </Notice>
        ) : null}
        <Card>
          <CardHeader title="Riepilogo" />
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted">Evento</dt>
              <dd>
                {event.data
                  ? `${eventTitle(event.data.type)} · ${formatDateTime(event.data.occurred_at)}`
                  : "Evento non più disponibile"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Contatto</dt>
              <dd>{contact.data ? contact.data.full_name || "Senza nome" : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Versione del flusso</dt>
              <dd>{version.data ? version.data.version : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Iniziata</dt>
              <dd>{formatDateTime(run.started_at)}</dd>
            </div>
            <div>
              <dt className="text-muted">Finita</dt>
              <dd>{run.finished_at ? formatDateTime(run.finished_at) : "Non ancora"}</dd>
            </div>
            <div>
              <dt className="text-muted">Passo attuale</dt>
              <dd>
                {run.finished_at || !run.current_step_id
                  ? "—"
                  : (titles.get(run.current_step_id) ?? run.current_step_id)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Tempo di lavoro</dt>
              <dd>{formatDuration(totalDuration)}</dd>
            </div>
            <div>
              <dt className="text-muted">Costo IA</dt>
              <dd>{totalCost > 0 ? formatMicros(totalCost) : "Nessuno"}</dd>
            </div>
            {run.status === "waiting" && run.wait_until ? (
              <div>
                <dt className="text-muted">In attesa fino al</dt>
                <dd>{formatDateTime(run.wait_until)}</dd>
              </div>
            ) : null}
          </dl>
        </Card>
        <section aria-labelledby="steps-title" className="grid gap-3">
          <h2 id="steps-title" className="font-display text-[17px] font-bold tracking-tight">
            Passi eseguiti
          </h2>
          <RunSteps steps={stepRows} stageNames={stageNames} />
        </section>
      </div>
    </>
  );
}
