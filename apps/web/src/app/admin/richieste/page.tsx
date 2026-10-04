import { Badge, StatusPill } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { errorMessage } from "@/lib/action";
import { formatDateTime, formatMoney, shortId } from "@/lib/format";
import { sectorLabel } from "@/lib/labels";
import { accessRequestErrorMessage, accessRequestStatus } from "@/lib/registration";
import { requirePlatformAdmin } from "@/lib/session";
import { hasServiceKey } from "@/lib/supabase/service";
import { resolveUserEmails } from "@/lib/users";
import type { Metadata } from "next";
import Link from "next/link";
import { approveAccessRequest, rejectAccessRequest } from "./actions";

export const metadata: Metadata = { title: "Richieste di accesso" };

const PENDING_LIMIT = 100;
const HISTORY_LIMIT = 50;

export default async function AccessRequestsPage() {
  const { supabase, session } = await requirePlatformAdmin();
  const [pending, decided, plans] = await Promise.all([
    supabase
      .from("access_requests")
      .select("*", { count: "exact" })
      .eq("status", "pending")
      .order("updated_at", { ascending: true })
      .limit(PENDING_LIMIT),
    supabase
      .from("access_requests")
      .select("*")
      .neq("status", "pending")
      .order("decided_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    supabase
      .from("plans")
      .select("key, name, price_monthly_cents")
      .eq("is_active", true)
      .order("price_monthly_cents"),
  ]);
  const pendingRows = pending.data ?? [];
  const decidedRows = decided.data ?? [];
  const planRows = plans.data ?? [];
  const error = pending.error ?? decided.error;

  // Auth users are not readable through RLS: the mail needs the service key (permission checked above).
  const emails = await resolveUserEmails([
    ...pendingRows.map((r) => r.user_id),
    ...decidedRows.map((r) => r.user_id),
    ...decidedRows.flatMap((r) => (r.decided_by ? [r.decided_by] : [])),
  ]);
  const person = (id: string | null) => {
    if (!id) return "—";
    if (id === session.user.id) return "Tu";
    return emails.get(id) ?? `Utente ${shortId(id)}`;
  };

  return (
    <>
      <PageHeader
        title="Richieste di accesso"
        description="Chi si è registrato e aspetta l'attivazione della propria azienda. Approvando crei l'azienda e la persona ne diventa titolare."
      />
      {hasServiceKey() ? null : (
        <Notice tone="warning" title="Le mail di chi ha fatto richiesta non sono visibili" className="mb-4">
          Su questo server manca SUPABASE_SERVICE_ROLE_KEY: al posto della mail vedi l'identificativo
          abbreviato dell'utente. Approvare e rifiutare funziona lo stesso.
        </Notice>
      )}
      {error ? (
        <Notice tone="error" announce="alert" className="mb-4">
          {accessRequestErrorMessage(error) ?? errorMessage(error)}
        </Notice>
      ) : null}

      <section aria-labelledby="pending-title" className="mb-8">
        <h2 id="pending-title" className="mb-3 font-display text-lg font-bold tracking-tight">
          In attesa{" "}
          {pendingRows.length > 0 ? (
            <Badge tone="warning">{pending.count ?? pendingRows.length}</Badge>
          ) : null}
        </h2>
        {pendingRows.length === 0 ? (
          <EmptyState
            icon="key"
            title="Nessuna richiesta in attesa"
            description="Quando qualcuno si registra dall'area riservata, la richiesta compare qui: la approvi scegliendo il piano, oppure la rifiuti con un motivo."
          />
        ) : (
          <ul className="grid gap-3">
            {pendingRows.map((request) => (
              <Card as="li" key={request.id}>
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
                  <div className="min-w-0">
                    <h3 className="break-words font-display text-base font-bold leading-tight tracking-tight">
                      {request.company_name}
                    </h3>
                    <p className="mt-1 break-words text-sm">
                      {request.full_name ?? "Nome non indicato"} ·{" "}
                      <span className="break-all font-mono text-[13px]">{person(request.user_id)}</span>
                    </p>
                  </div>
                  <p className="whitespace-nowrap font-mono text-[12px] text-muted">
                    {formatDateTime(request.updated_at)}
                  </p>
                </div>
                <dl className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
                  <div className="flex gap-2">
                    <dt className="text-muted">Settore</dt>
                    <dd>{sectorLabel(request.sector)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-muted">Telefono</dt>
                    <dd className="break-all">{request.phone ?? "—"}</dd>
                  </div>
                </dl>
                {request.message ? (
                  <p className="mt-3 whitespace-pre-line break-words rounded-lg bg-surface-2 p-3 text-sm">
                    {request.message}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
                  {planRows.length === 0 ? (
                    <p className="text-sm text-muted">
                      Nessun piano attivo: creane uno in «Piani» per approvare.
                    </p>
                  ) : (
                    <ActionForm
                      action={approveAccessRequest.bind(null, request.id)}
                      className="flex min-w-0 flex-1 flex-wrap items-end gap-3"
                    >
                      <Field
                        label="Piano"
                        htmlFor={`plan-${request.id}`}
                        name="plan_key"
                        className="min-w-[160px] flex-1 sm:max-w-[240px]"
                      >
                        <Select id={`plan-${request.id}`} name="plan_key" defaultValue={planRows[0]?.key}>
                          {planRows.map((plan) => (
                            <option key={plan.key} value={plan.key}>
                              {plan.name} · {formatMoney(plan.price_monthly_cents)}/mese
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <SubmitButton icon="check">Approva</SubmitButton>
                    </ActionForm>
                  )}
                  <Dialog
                    triggerLabel="Rifiuta"
                    triggerVariant="secondary"
                    title={`Rifiutare la richiesta di ${request.company_name}?`}
                    description="La persona legge il motivo nella propria pagina e può correggere i dati e inviare di nuovo la richiesta."
                  >
                    <ActionForm action={rejectAccessRequest.bind(null, request.id)} className="grid gap-4">
                      <Field label="Motivo" htmlFor={`note-${request.id}`} name="note">
                        <Textarea id={`note-${request.id}`} name="note" rows={3} required maxLength={1000} />
                      </Field>
                      <SubmitButton variant="danger">Rifiuta la richiesta</SubmitButton>
                    </ActionForm>
                  </Dialog>
                </div>
              </Card>
            ))}
          </ul>
        )}
        {(pending.count ?? 0) > pendingRows.length ? (
          <p className="mt-3 text-sm text-muted">
            Sono mostrate le {pendingRows.length} richieste più vecchie su {pending.count}: le altre compaiono
            man mano che decidi queste.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="history-title">
        <h2 id="history-title" className="mb-3 font-display text-lg font-bold tracking-tight">
          Già decise
        </h2>
        {decidedRows.length === 0 ? (
          <p className="text-sm text-muted">Ancora nessuna richiesta approvata o rifiutata.</p>
        ) : (
          <>
            <Table caption="Richieste già decise" minWidth={820}>
              <thead>
                <tr>
                  <Th>Azienda</Th>
                  <Th>Persona</Th>
                  <Th>Esito</Th>
                  <Th>Deciso da</Th>
                  <Th>Quando</Th>
                  <Th>Nota</Th>
                </tr>
              </thead>
              <tbody>
                {decidedRows.map((request) => (
                  <tr key={request.id}>
                    <Td>
                      {request.organization_id ? (
                        <Link
                          href={`/admin/aziende/${request.organization_id}`}
                          className="font-semibold hover:underline"
                        >
                          {request.company_name}
                        </Link>
                      ) : (
                        <span className="font-semibold">{request.company_name}</span>
                      )}
                      <span className="block text-[13px] text-muted">{sectorLabel(request.sector)}</span>
                    </Td>
                    <Td>
                      {request.full_name ?? "—"}
                      <span className="block font-mono text-[12px] text-muted">
                        {person(request.user_id)}
                      </span>
                    </Td>
                    <Td>
                      <StatusPill {...accessRequestStatus(request.status)} />
                    </Td>
                    <Td muted>{person(request.decided_by)}</Td>
                    <Td mono muted className="whitespace-nowrap">
                      {request.decided_at ? formatDateTime(request.decided_at) : "—"}
                    </Td>
                    <Td muted className="max-w-[260px] whitespace-pre-line break-words">
                      {request.decision_note ?? "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {decidedRows.length === HISTORY_LIMIT ? (
              <p className="mt-3 text-sm text-muted">
                Sono mostrate le ultime {HISTORY_LIMIT}. Le decisioni più vecchie restano nel Registro.
              </p>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
