import { DealForm } from "@/components/deals/deal-form";
import { MoveForm } from "@/components/deals/move-form";
import { FeatureOff } from "@/components/feature-off";
import { StatusPill } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  appointmentStatus,
  dealActorLabel,
  dealEventLabel,
  requestStatus,
  stageKind,
} from "@/lib/customer-labels";
import { loadAssignees } from "@/lib/deals/assignees";
import { dealAgeDays, dealAgeLabel, sortStages } from "@/lib/deals/board";
import { parseDealFieldDefs } from "@/lib/deals/stages";
import { featureOn } from "@/lib/feature-gate";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { isUuid } from "@/lib/org-selection";
import { peopleNames } from "@/lib/people";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { moveDeal, updateDeal } from "../actions";

export const metadata: Metadata = { title: "Trattativa" };

const FIELD_LABELS: Record<string, string> = {
  title: "titolo",
  estimated_value_cents: "valore",
  next_action: "prossima azione",
  next_action_at: "data della prossima azione",
  assignee_user_id: "assegnazione",
  custom_fields: "campi dell'azienda",
};

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireOrg();
  const { supabase, org, session } = context;
  const organizationId = org.organization.id;
  if (!(await featureOn(supabase, organizationId, "deals"))) return <FeatureOff title="Trattative" />;
  if (!isUuid(id)) notFound();
  const { data: deal } = await supabase
    .from("deals")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!deal) notFound();

  const [stagesResult, settings, contact, events, appointments, payments, signatures, run, assignees] =
    await Promise.all([
      supabase.from("deal_stages").select("id, name, position, kind").eq("organization_id", organizationId),
      supabase
        .from("org_settings")
        .select("deal_custom_fields")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      supabase
        .from("contacts")
        .select("id, full_name, phones, emails")
        .eq("id", deal.contact_id)
        .eq("organization_id", organizationId)
        .maybeSingle(),
      supabase
        .from("deal_events")
        .select("id, type, from_stage_id, to_stage_id, actor_type, actor_id, data, created_at")
        .eq("organization_id", organizationId)
        .eq("deal_id", deal.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("appointments")
        .select("id, title, starts_at, status, location")
        .eq("organization_id", organizationId)
        .eq("deal_id", deal.id)
        .order("starts_at", { ascending: false })
        .limit(20),
      supabase
        .from("payment_requests")
        .select("id, amount_cents, currency, description, status, created_at")
        .eq("organization_id", organizationId)
        .eq("deal_id", deal.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("signature_requests")
        .select("id, title, status, created_at")
        .eq("organization_id", organizationId)
        .eq("deal_id", deal.id)
        .order("created_at", { ascending: false })
        .limit(20),
      deal.origin_flow_run_id
        ? supabase
            .from("flow_runs")
            .select("id, flow_id, started_at")
            .eq("id", deal.origin_flow_run_id)
            .eq("organization_id", organizationId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      loadAssignees(context, [deal.assignee_user_id]),
    ]);
  const flow = run.data
    ? (
        await supabase
          .from("flows")
          .select("id, name")
          .eq("id", run.data.flow_id)
          .eq("organization_id", organizationId)
          .maybeSingle()
      ).data
    : null;

  const stages = sortStages(stagesResult.data ?? []);
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const stage = stageById.get(deal.stage_id);
  const history = events.data ?? [];
  const nameOf = await peopleNames(
    history.map((event) => event.actor_id),
    session.user,
  );
  const contactName =
    contact.data?.full_name.trim() || contact.data?.phones[0] || contact.data?.emails[0] || "Contatto";
  const related =
    (appointments.data ?? []).length + (payments.data ?? []).length + (signatures.data ?? []).length;
  const label = "font-mono text-[11px] uppercase tracking-wider text-muted";

  return (
    <>
      <PageHeader
        title={deal.title}
        back={{ href: "/app/trattative", label: "Trattative" }}
        description={
          <>
            {contact.data ? (
              <Link href={`/app/contatti/${contact.data.id}`} className="font-semibold underline">
                {contactName}
              </Link>
            ) : (
              "Contatto non trovato"
            )}
            {" · "}
            {formatMoney(deal.estimated_value_cents, deal.currency)}
            {" · aperta "}
            {dealAgeLabel(dealAgeDays(deal.created_at))}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="grid min-w-0 gap-4">
          <Card aria-labelledby="dati-trattativa">
            <CardHeader id="dati-trattativa" title="Dati" />
            <DealForm
              action={updateDeal.bind(null, deal.id)}
              deal={deal}
              assignees={assignees}
              fieldDefs={parseDealFieldDefs(settings.data?.deal_custom_fields)}
              submitLabel="Salva"
            />
          </Card>

          {related > 0 ? (
            <Card aria-labelledby="collegati">
              <CardHeader id="collegati" title="Appuntamenti, pagamenti e firme" />
              <ul className="grid gap-2.5 text-sm">
                {(appointments.data ?? []).map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-semibold">Appuntamento: {item.title}</span>
                      <span className="text-muted">
                        {" "}
                        · {formatDateTime(item.starts_at)}
                        {item.location ? ` · ${item.location}` : ""}
                      </span>
                    </span>
                    <StatusPill {...appointmentStatus(item.status)} />
                  </li>
                ))}
                {(payments.data ?? []).map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-semibold">
                        Richiesta di pagamento: {formatMoney(item.amount_cents, item.currency)}
                      </span>
                      <span className="text-muted">
                        {item.description ? ` · ${item.description}` : ""} · {formatDate(item.created_at)}
                      </span>
                    </span>
                    <StatusPill {...requestStatus(item.status)} />
                  </li>
                ))}
                {(signatures.data ?? []).map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-semibold">Firma: {item.title}</span>
                      <span className="text-muted"> · {formatDate(item.created_at)}</span>
                    </span>
                    <StatusPill {...requestStatus(item.status)} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="grid min-w-0 gap-4">
          <Card aria-labelledby="fase">
            <CardHeader id="fase" title="Fase" className="mb-3" />
            <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{stage?.name ?? "—"}</span>
              {stage ? <StatusPill {...stageKind(stage.kind)} /> : null}
            </p>
            {deal.closed_at ? (
              <p className="mb-3 text-[13px] text-muted">Chiusa il {formatDate(deal.closed_at)}.</p>
            ) : null}
            <MoveForm
              action={moveDeal.bind(null, deal.id)}
              dealId={deal.id}
              dealTitle={deal.title}
              currentStageId={deal.stage_id}
              stages={stages}
            />
          </Card>

          <Card aria-labelledby="origine">
            <CardHeader id="origine" title="Origine" className="mb-3" />
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className={label}>Creata</dt>
                <dd>{formatDateTime(deal.created_at)}</dd>
              </div>
              <div>
                <dt className={label}>Da</dt>
                <dd>
                  {flow ? (
                    <>
                      Flusso{" "}
                      <Link href={`/app/flussi/${flow.id}`} className="font-semibold underline">
                        {flow.name}
                      </Link>
                      {run.data ? (
                        <span className="text-muted">
                          {" "}
                          · esecuzione del {formatDateTime(run.data.started_at)}
                        </span>
                      ) : null}
                    </>
                  ) : deal.origin_flow_run_id ? (
                    "Un flusso che non esiste più"
                  ) : (
                    "Creata a mano"
                  )}
                </dd>
              </div>
            </dl>
          </Card>

          <Card aria-labelledby="storia-trattativa">
            <CardHeader id="storia-trattativa" title="Storia" className="mb-3" />
            {history.length === 0 ? (
              <p className="text-sm text-muted">Nessun passaggio registrato.</p>
            ) : (
              <ol className="grid gap-3">
                {history.map((event) => {
                  const data = (
                    typeof event.data === "object" && event.data !== null ? event.data : {}
                  ) as Record<string, unknown>;
                  const changed = Array.isArray(data.changed)
                    ? data.changed.map((key) => FIELD_LABELS[String(key)] ?? String(key)).join(", ")
                    : "";
                  return (
                    <li key={event.id} className="border-l-2 border-line pl-3 text-sm">
                      <p className="font-semibold">{dealEventLabel(event.type)}</p>
                      {event.type === "stage_changed" ? (
                        <p>
                          Da «{stageById.get(event.from_stage_id ?? "")?.name ?? String(data.from ?? "—")}» a
                          «{stageById.get(event.to_stage_id ?? "")?.name ?? String(data.to ?? "—")}»
                        </p>
                      ) : null}
                      {event.type === "updated" && changed ? <p>Cambiati: {changed}</p> : null}
                      <p className="text-[13px] text-muted">
                        {event.actor_type === "user"
                          ? nameOf(event.actor_id)
                          : dealActorLabel(event.actor_type)}{" "}
                        · {formatDateTime(event.created_at)}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
