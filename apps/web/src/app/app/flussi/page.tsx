import { StatusPill } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { errorMessage } from "@/lib/action";
import { eventTitle } from "@/lib/flows/describe";
import { summarizeRuns } from "@/lib/flows/runs";
import { loadFlowPermissions } from "@/lib/flows/server";
import { formatNumber, formatRelative } from "@/lib/format";
import { flowStatus } from "@/lib/labels";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { activateFlow, pauseFlow } from "./actions";

export const metadata: Metadata = { title: "Flussi" };

const RUNS_LIMIT = 1000;

export default async function FlowsPage() {
  const context = await requireOrg();
  const { supabase, org } = context;
  const orgId = org.organization.id;
  const [flows, runs, permissions] = await Promise.all([
    supabase
      .from("flows")
      .select("id, name, description, status, trigger_event, active_version_id, updated_at")
      .eq("organization_id", orgId)
      .order("name")
      .limit(500),
    supabase
      .from("flow_runs")
      .select("flow_id, status, started_at")
      .eq("organization_id", orgId)
      .eq("mode", "live")
      .order("started_at", { ascending: false })
      .limit(RUNS_LIMIT),
    loadFlowPermissions(context),
  ]);
  const stats = summarizeRuns(runs.data ?? []);
  const rows = flows.data ?? [];
  const partial = (runs.data ?? []).length === RUNS_LIMIT;

  return (
    <>
      <PageHeader
        title="Flussi"
        description="Le automazioni che lavorano per te: ognuna parte da un evento ed esegue i suoi passi sul server."
        actions={
          permissions.canEdit ? (
            <>
              <ButtonLink href="/app/flussi/modelli" variant="secondary">
                Libreria di modelli
              </ButtonLink>
              {permissions.canUseAssistant ? (
                <ButtonLink href="/app/flussi/nuovo" icon="spark">
                  Crea con l'assistente
                </ButtonLink>
              ) : null}
            </>
          ) : null
        }
      />
      <div className="grid gap-5">
        {flows.error || runs.error ? (
          <Notice tone="error">{errorMessage(flows.error ?? runs.error)}</Notice>
        ) : null}
        {org.canManage && !permissions.editorEnabled ? (
          <Notice tone="neutral">
            La modifica dei flussi non è attiva per la tua azienda: puoi consultarli, ma per cambiarli serve
            l'assistenza.
          </Notice>
        ) : null}
        {rows.length === 0 && !flows.error ? (
          <EmptyState
            icon="flow"
            title="Nessun flusso"
            description="Un flusso dice cosa fare quando succede qualcosa: arriva una mail, un ordine, un messaggio. Parti da un modello del tuo settore oppure descrivilo all'assistente."
            action={
              permissions.canEdit ? (
                <>
                  <ButtonLink href="/app/flussi/modelli">Scegli un modello</ButtonLink>
                  {permissions.canUseAssistant ? (
                    <ButtonLink href="/app/flussi/nuovo" variant="secondary" icon="spark">
                      Crea con l'assistente
                    </ButtonLink>
                  ) : null}
                </>
              ) : undefined
            }
          />
        ) : null}
        {rows.length > 0 ? (
          <>
            <Table caption="Flussi dell'azienda" minWidth={940}>
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th>Stato</Th>
                  <Th>Parte quando</Th>
                  <Th>Ultima esecuzione</Th>
                  <Th align="right">Esecuzioni (7 giorni)</Th>
                  <Th align="right">Fallite</Th>
                  {permissions.canEdit ? <Th>Azioni</Th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((flow) => {
                  const stat = stats.get(flow.id);
                  return (
                    <tr key={flow.id}>
                      <Td className="min-w-64">
                        <Link
                          href={`/app/flussi/${flow.id}`}
                          className="font-semibold underline-offset-2 hover:underline"
                        >
                          {flow.name}
                        </Link>
                      </Td>
                      <Td>
                        <StatusPill {...flowStatus(flow.status)} />
                      </Td>
                      <Td muted>{eventTitle(flow.trigger_event)}</Td>
                      <Td muted>{stat?.lastRunAt ? formatRelative(stat.lastRunAt) : "Mai"}</Td>
                      <Td align="right" mono>
                        {formatNumber(stat?.runs7d ?? 0)}
                      </Td>
                      <Td align="right" mono className={stat?.failed7d ? "text-danger" : undefined}>
                        {formatNumber(stat?.failed7d ?? 0)}
                      </Td>
                      {permissions.canEdit ? (
                        <Td>
                          {flow.status === "active" ? (
                            <ActionForm
                              action={pauseFlow.bind(null, flow.id)}
                              className="grid max-w-64 gap-2"
                            >
                              <SubmitButton size="sm" variant="secondary">
                                Metti in pausa
                              </SubmitButton>
                            </ActionForm>
                          ) : (
                            <ActionForm
                              action={activateFlow.bind(null, flow.id, null)}
                              className="grid max-w-64 gap-2"
                            >
                              <SubmitButton size="sm" variant="secondary" pendingLabel="Controllo…">
                                {flow.status === "paused" ? "Riattiva" : "Attiva"}
                              </SubmitButton>
                            </ActionForm>
                          )}
                        </Td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            {partial ? (
              <p className="text-[13px] text-muted">
                I conteggi considerano le ultime {formatNumber(RUNS_LIMIT)} esecuzioni: con volumi più alti
                possono essere parziali.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
