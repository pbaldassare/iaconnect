import { AutoRefresh } from "@/components/inbox/auto-refresh";
import { StatusPill } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Table, Td, Th } from "@/components/ui/table";
import { errorMessage } from "@/lib/action";
import { approvalStatus } from "@/lib/customer-labels";
import { formatDateTime, formatRelative } from "@/lib/format";
import { pageWindow, parsePage, withParams } from "@/lib/pagination";
import { peopleNames } from "@/lib/people";
import { chunk } from "@/lib/report/fetch";
import { type OrgContext, requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { decideApproval } from "./actions";

export const metadata: Metadata = { title: "Approvazioni" };

const PATH = "/app/approvazioni";
const PAGE_SIZE = 25;

/** flow run id → flow and contact, with two reads and Maps (no embedded selects). */
async function runDetails(context: OrgContext, runIds: readonly string[]) {
  const { supabase, org } = context;
  const organizationId = org.organization.id;
  const runs = new Map<string, { flow_id: string; contact_id: string | null }>();
  for (const ids of chunk([...new Set(runIds)])) {
    const { data } = await supabase
      .from("flow_runs")
      .select("id, flow_id, contact_id")
      .eq("organization_id", organizationId)
      .in("id", ids);
    for (const run of data ?? []) runs.set(run.id, run);
  }
  const flows = new Map<string, string>();
  const contacts = new Map<string, string>();
  const flowIds = [...new Set([...runs.values()].map((run) => run.flow_id))];
  const contactIds = [
    ...new Set([...runs.values()].flatMap((run) => (run.contact_id ? [run.contact_id] : []))),
  ];
  for (const ids of chunk(flowIds)) {
    const { data } = await supabase
      .from("flows")
      .select("id, name")
      .eq("organization_id", organizationId)
      .in("id", ids);
    for (const flow of data ?? []) flows.set(flow.id, flow.name);
  }
  for (const ids of chunk(contactIds)) {
    const { data } = await supabase
      .from("contacts")
      .select("id, full_name, phones, emails")
      .eq("organization_id", organizationId)
      .in("id", ids);
    for (const c of data ?? [])
      contacts.set(c.id, c.full_name.trim() || c.phones[0] || c.emails[0] || "Senza nome");
  }
  return (runId: string) => {
    const run = runs.get(runId);
    return {
      flowId: run?.flow_id ?? null,
      flowName: run ? (flows.get(run.flow_id) ?? "Flusso") : "Flusso non più disponibile",
      contactId: run?.contact_id ?? null,
      contactName: run?.contact_id ? (contacts.get(run.contact_id) ?? null) : null,
    };
  };
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireOrg();
  const { supabase, org, session } = context;
  const organizationId = org.organization.id;
  const page = parsePage((await searchParams).pagina);
  const { from, to } = pageWindow(page, PAGE_SIZE);

  const [pendingResult, historyResult] = await Promise.all([
    supabase
      .from("approvals")
      .select("id, flow_run_id, summary, created_at")
      .eq("organization_id", organizationId)
      .eq("status", "pending")
      .order("created_at")
      .limit(100),
    supabase
      .from("approvals")
      .select("id, flow_run_id, summary, status, decided_by, decided_at, created_at", { count: "exact" })
      .eq("organization_id", organizationId)
      .neq("status", "pending")
      .order("created_at", { ascending: false })
      .range(from, to),
  ]);
  const pending = pendingResult.data ?? [];
  const history = historyResult.data ?? [];
  const [detailsOf, nameOf] = await Promise.all([
    runDetails(
      context,
      [...pending, ...history].map((row) => row.flow_run_id),
    ),
    peopleNames(
      history.map((row) => row.decided_by),
      session.user,
    ),
  ]);

  return (
    <>
      <AutoRefresh seconds={20} />
      <PageHeader
        title="Approvazioni"
        description="Quando un flusso si ferma per chiederti conferma, la richiesta arriva qui. Finché non decidi, il flusso aspetta."
        back={{ href: "/app/notifiche", label: "Notifiche" }}
      />
      {(pendingResult.error ?? historyResult.error) ? (
        <Notice tone="error" announce="alert" className="mb-4">
          {errorMessage(pendingResult.error ?? historyResult.error)}
        </Notice>
      ) : null}

      <section aria-labelledby="in-attesa" className="mb-8">
        <h2 id="in-attesa" className="mb-3 font-display text-[17px] font-bold tracking-tight">
          In attesa {pending.length > 0 ? `(${pending.length})` : ""}
        </h2>
        {pending.length === 0 ? (
          <EmptyState
            compact
            icon="check"
            title="Niente da approvare"
            description="Le richieste compaiono qui quando un flusso contiene un passo «Chiedi approvazione»."
          />
        ) : (
          <ul className="grid gap-3">
            {pending.map((approval) => {
              const details = detailsOf(approval.flow_run_id);
              return (
                <Card key={approval.id} as="li">
                  <p className="whitespace-pre-wrap break-words font-semibold">{approval.summary}</p>
                  <p className="mt-1.5 text-sm text-muted">
                    Flusso:{" "}
                    {details.flowId ? (
                      <Link href={`/app/flussi/${details.flowId}`} className="underline">
                        {details.flowName}
                      </Link>
                    ) : (
                      details.flowName
                    )}
                    {details.contactId && details.contactName ? (
                      <>
                        {" · Contatto: "}
                        <Link href={`/app/contatti/${details.contactId}`} className="underline">
                          {details.contactName}
                        </Link>
                      </>
                    ) : null}
                    {" · richiesta "}
                    {formatRelative(approval.created_at)}
                  </p>
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    <ActionForm
                      action={decideApproval.bind(null, approval.id, "approved")}
                      className="grid gap-2"
                    >
                      <SubmitButton icon="check">Approva</SubmitButton>
                    </ActionForm>
                    <ActionForm
                      action={decideApproval.bind(null, approval.id, "rejected")}
                      className="grid gap-2"
                    >
                      <SubmitButton variant="secondary">Rifiuta</SubmitButton>
                    </ActionForm>
                  </div>
                </Card>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="storico">
        <h2 id="storico" className="mb-3 font-display text-[17px] font-bold tracking-tight">
          Decisioni passate
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted">Ancora nessuna decisione.</p>
        ) : (
          <>
            <Table caption="Decisioni passate" minWidth={720}>
              <thead>
                <tr>
                  <Th>Richiesta</Th>
                  <Th>Flusso e contatto</Th>
                  <Th>Esito</Th>
                  <Th>Deciso da</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((approval) => {
                  const details = detailsOf(approval.flow_run_id);
                  return (
                    <tr key={approval.id}>
                      <Td className="max-w-[28rem] break-words">{approval.summary}</Td>
                      <Td muted>
                        {details.flowName}
                        {details.contactName ? <span className="block">{details.contactName}</span> : null}
                      </Td>
                      <Td>
                        <StatusPill {...approvalStatus(approval.status)} />
                      </Td>
                      <Td muted>
                        {approval.status === "expired" ? "Nessuno: scaduta" : nameOf(approval.decided_by)}
                        <span className="block font-mono text-[12px]">
                          {formatDateTime(approval.decided_at ?? approval.created_at)}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={historyResult.count ?? 0}
              hrefFor={(p) => withParams(PATH, { pagina: p })}
            />
          </>
        )}
      </section>
    </>
  );
}
