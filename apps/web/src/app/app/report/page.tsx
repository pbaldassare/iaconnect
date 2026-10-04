import { FeatureOff } from "@/components/feature-off";
import { BarList, FunnelChart, MessagesPerDayChart, Stat } from "@/components/report/charts";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { UsageMeters } from "@/components/usage-meters";
import { errorMessage } from "@/lib/action";
import { channelLabel } from "@/lib/customer-labels";
import { featureOn } from "@/lib/feature-gate";
import { formatDate, formatMicros, formatMoney, formatMonth, formatNumber } from "@/lib/format";
import { withParams } from "@/lib/pagination";
import { chunk, fetchAllRows } from "@/lib/report/fetch";
import {
  aiSpendMicros,
  dealStats,
  dealsByFlow,
  economicReturn,
  firstReplyTime,
  formatDuration,
  formatPercent,
  funnel,
  messageStats,
  messagesPerDay,
  replyRate,
  runStats,
} from "@/lib/report/metrics";
import { PERIOD_KEYS, PERIOD_LABELS, parsePeriod, periodRange } from "@/lib/report/period";
import { requireOrg } from "@/lib/session";
import { buildUsage, parsePlanLimits, usagePeriod } from "@/lib/usage";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Report" };

const PATH = "/app/report";
/** Rows read per table, at most: beyond this the figure is marked as partial. */
const CAP = 10_000;

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, org } = await requireOrg();
  const organizationId = org.organization.id;
  if (!(await featureOn(supabase, organizationId, "reports"))) return <FeatureOff title="Report" />;
  const period = parsePeriod((await searchParams).periodo);
  const range = periodRange(period);

  const [events, contacts, runs, messages, deals, aiCalls, stages, plan, counters, activeFlows] =
    await Promise.all([
      supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gte("created_at", range.from)
        .lt("created_at", range.to),
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gte("created_at", range.from)
        .lt("created_at", range.to),
      fetchAllRows(
        (from, to) =>
          supabase
            .from("flow_runs")
            .select("status, mode")
            .eq("organization_id", organizationId)
            .gte("started_at", range.from)
            .lt("started_at", range.to)
            .order("started_at")
            .range(from, to),
        CAP,
      ),
      fetchAllRows(
        (from, to) =>
          supabase
            .from("messages")
            .select(
              "conversation_id, direction, channel, delivery_status, created_at, ai_generated, sent_by_user_id",
            )
            .eq("organization_id", organizationId)
            .gte("created_at", range.from)
            .lt("created_at", range.to)
            .order("created_at")
            .range(from, to),
        CAP,
      ),
      fetchAllRows(
        (from, to) =>
          supabase
            .from("deals")
            .select("id, stage_id, estimated_value_cents, created_at, closed_at, origin_flow_run_id")
            .eq("organization_id", organizationId)
            .order("created_at", { ascending: false })
            .range(from, to),
        CAP,
      ),
      fetchAllRows(
        (from, to) =>
          supabase
            .from("ai_calls")
            .select("cost_micros")
            .eq("organization_id", organizationId)
            .gte("created_at", range.from)
            .lt("created_at", range.to)
            .order("created_at")
            .range(from, to),
        CAP,
      ),
      supabase.from("deal_stages").select("id, name, position, kind").eq("organization_id", organizationId),
      supabase
        .from("plans")
        .select("name, price_monthly_cents, limits")
        .eq("id", org.organization.plan_id)
        .maybeSingle(),
      supabase
        .from("usage_counters")
        .select("metric, value")
        .eq("organization_id", organizationId)
        .eq("period", usagePeriod()),
      supabase
        .from("flows")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("status", "active"),
    ]);

  // Which flow each deal comes from: runs → flows, read in chunks.
  const runIds = [
    ...new Set(deals.rows.flatMap((deal) => (deal.origin_flow_run_id ? [deal.origin_flow_run_id] : []))),
  ];
  const runFlow = new Map<string, string>();
  for (const ids of chunk(runIds)) {
    const { data } = await supabase
      .from("flow_runs")
      .select("id, flow_id")
      .eq("organization_id", organizationId)
      .in("id", ids);
    for (const run of data ?? []) runFlow.set(run.id, run.flow_id);
  }
  const flowNames = new Map<string, string>();
  for (const ids of chunk([...new Set(runFlow.values())])) {
    const { data } = await supabase
      .from("flows")
      .select("id, name")
      .eq("organization_id", organizationId)
      .in("id", ids);
    for (const flow of data ?? []) flowNames.set(flow.id, flow.name);
  }

  const stageRows = stages.data ?? [];
  const run = runStats(runs.rows);
  const message = messageStats(messages.rows);
  const reply = replyRate(messages.rows);
  const firstReply = firstReplyTime(messages.rows);
  const deal = dealStats(deals.rows, stageRows, range);
  const steps = funnel(deals.rows, stageRows, range);
  const byFlow = dealsByFlow({ deals: deals.rows, stages: stageRows, runFlow, flowNames, range });
  const aiMicros = aiSpendMicros(aiCalls.rows);
  const economics = economicReturn({
    wonValueCents: deal.wonValueCents,
    planPriceMonthlyCents: plan.data?.price_monthly_cents ?? 0,
    months: range.months,
  });
  const usage = buildUsage(parsePlanLimits(plan.data?.limits), counters.data ?? [], activeFlows.count ?? 0);

  const firstError =
    events.error ??
    contacts.error ??
    runs.error ??
    messages.error ??
    deals.error ??
    aiCalls.error ??
    stages.error;
  const truncated = [
    runs.truncated ? "esecuzioni dei flussi" : null,
    messages.truncated ? "messaggi" : null,
    deals.truncated ? "trattative" : null,
    aiCalls.truncated ? "spesa dell'IA" : null,
  ].filter((item): item is string => item !== null);
  const lastDay = new Date(new Date(range.to).getTime() - 86_400_000).toISOString();

  return (
    <>
      <PageHeader
        title="Report"
        description={`Cosa ha prodotto la piattaforma dal ${formatDate(range.from)} al ${formatDate(lastDay)} (giorni in ora UTC).`}
      />
      <Tabs
        label="Periodo"
        className="mb-5"
        items={PERIOD_KEYS.map((key) => ({
          href: withParams(PATH, { periodo: key === "questo-mese" ? null : key }),
          label: PERIOD_LABELS[key],
          current: key === period,
        }))}
      />
      {firstError ? (
        <Notice tone="error" announce="alert" className="mb-4" title="Alcuni dati non si sono caricati">
          {errorMessage(firstError)} Le cifre qui sotto possono essere incomplete.
        </Notice>
      ) : null}
      {truncated.length > 0 ? (
        <Notice tone="warning" className="mb-4" title="Cifre parziali">
          In questo periodo ci sono più di {formatNumber(CAP)} righe per: {truncated.join(", ")}. I numeri che
          ne dipendono sono calcolati sulle prime {formatNumber(CAP)} e quindi sono per difetto. Scegli un
          periodo più breve per averli esatti.
        </Notice>
      ) : null}

      <div className="grid gap-4">
        <Card aria-labelledby="risultati">
          <CardHeader
            id="risultati"
            title="Risultati"
            description="Quanto lavoro è passato dalla piattaforma."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Eventi ricevuti"
              value={formatNumber(events.count ?? 0)}
              note="Messaggi, richieste, novità dai sistemi collegati"
            />
            <Stat
              label="Flussi eseguiti"
              value={formatNumber(run.total)}
              note={`${formatNumber(run.completed)} completati · ${formatNumber(run.inProgress)} in corso`}
            />
            <Stat
              label="Flussi falliti"
              value={formatNumber(run.failed)}
              note={
                run.failureRate === null
                  ? "Nessun flusso concluso"
                  : `${formatPercent(run.failureRate)} di quelli conclusi`
              }
              tone={run.failed > 0 ? "error" : undefined}
            />
            <Stat label="Nuovi contatti" value={formatNumber(contacts.count ?? 0)} />
            <Stat
              label="Messaggi inviati"
              value={formatNumber(message.sent)}
              note={`${formatNumber(message.sentByAi)} scritti dall'IA · ${formatNumber(message.sentByPeople)} da persone${message.failed > 0 ? ` · ${formatNumber(message.failed)} non riusciti` : ""}`}
            />
            <Stat label="Messaggi ricevuti" value={formatNumber(message.received)} />
            <Stat
              label="Tasso di risposta"
              value={formatPercent(reply.rate)}
              note={
                reply.contacted === 0
                  ? "Nessuna conversazione avviata"
                  : `${formatNumber(reply.replied)} conversazioni su ${formatNumber(reply.contacted)} hanno avuto risposta dal contatto`
              }
            />
            <Stat
              label="Tempo medio di prima risposta"
              value={formatDuration(firstReply.averageSeconds)}
              note={
                firstReply.answered + firstReply.unanswered === 0
                  ? "Nessun contatto ha scritto"
                  : `Su ${formatNumber(firstReply.answered)} conversazioni${firstReply.unanswered > 0 ? ` · ${formatNumber(firstReply.unanswered)} ancora senza risposta` : ""}`
              }
            />
          </div>
          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="min-w-0">
              <h3 className="mb-3 font-display text-[15px] font-bold">Messaggi per giorno</h3>
              <MessagesPerDayChart points={messagesPerDay(messages.rows, range.days)} />
            </div>
            <div className="min-w-0">
              <h3 className="mb-3 font-display text-[15px] font-bold">Messaggi per canale</h3>
              <BarList
                empty="Nessun messaggio in questo periodo."
                rows={message.byChannel.map((row) => ({
                  key: row.channel,
                  label: channelLabel(row.channel),
                  value: row.sent + row.received,
                  display: `${formatNumber(row.sent)} inviati · ${formatNumber(row.received)} ricevuti`,
                }))}
              />
            </div>
          </div>
        </Card>

        <Card aria-labelledby="trattative-report">
          <CardHeader
            id="trattative-report"
            title="Trattative"
            description="Aperte oggi, e chiuse nel periodo."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Create" value={formatNumber(deal.created)} />
            <Stat label="Vinte" value={formatNumber(deal.won)} note={formatMoney(deal.wonValueCents)} />
            <Stat label="Perse" value={formatNumber(deal.lost)} />
            <Stat
              label="Conversione"
              value={formatPercent(deal.conversionRate)}
              note={
                deal.won + deal.lost === 0 ? "Nessuna trattativa chiusa" : "Vinte sul totale delle chiuse"
              }
            />
          </div>
          <h3 className="mb-3 mt-5 font-display text-[15px] font-bold">Per fase</h3>
          <FunnelChart steps={steps} />
        </Card>

        <Card aria-labelledby="ritorno">
          <CardHeader
            id="ritorno"
            title="Ritorno economico"
            description="Il valore delle trattative vinte nel periodo, a confronto con il costo del piano."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Valore delle trattative vinte"
              value={formatMoney(economics.wonValueCents)}
              note={
                deal.wonWithoutValue > 0
                  ? `${formatNumber(deal.wonWithoutValue)} vinte senza valore indicato: non sono nel totale`
                  : undefined
              }
            />
            <Stat
              label={`Piano ${plan.data?.name ?? ""}`.trim()}
              value={formatMoney(economics.planCostCents)}
              note={
                range.months === 1
                  ? "Prezzo mensile"
                  : `${formatMoney(plan.data?.price_monthly_cents ?? 0)} al mese, rapportato al periodo`
              }
            />
            <Stat
              label="Per ogni euro di piano"
              value={
                economics.multiple === null ? "—" : `${economics.multiple.toFixed(1).replace(".", ",")} €`
              }
              note={
                economics.multiple === null
                  ? "Il piano non ha un prezzo"
                  : "Valore vinto diviso il costo del piano"
              }
            />
            <Stat
              label="Ancora in trattativa"
              value={formatMoney(deal.openValueCents)}
              note={`${formatNumber(deal.open)} trattative aperte oggi`}
            />
          </div>
          <p className="mt-3 text-[13px] text-muted">
            Spesa dell'IA nel periodo: {formatMicros(aiMicros)} (in dollari, come la fattura il fornitore). È
            già compresa nel piano: la vedi per trasparenza, i tuoi limiti sono i crediti qui sotto.
          </p>

          <h3 className="mb-3 mt-5 font-display text-[15px] font-bold">Quale flusso porta risultati</h3>
          {byFlow.length === 0 ? (
            <p className="text-sm text-muted">Nessuna trattativa creata, vinta o aperta da mostrare.</p>
          ) : (
            <Table caption="Trattative per flusso di origine" minWidth={600} bare className="-mx-4 sm:-mx-5">
              <thead>
                <tr>
                  <Th>Flusso di origine</Th>
                  <Th align="right">Create</Th>
                  <Th align="right">Vinte</Th>
                  <Th align="right">Valore vinto</Th>
                  <Th align="right">Ancora aperto</Th>
                </tr>
              </thead>
              <tbody>
                {byFlow.map((row) => (
                  <tr key={row.flowId ?? "none"}>
                    <Td>
                      {row.flowId && flowNames.has(row.flowId) ? (
                        <Link href={`/app/flussi/${row.flowId}`} className="font-semibold underline">
                          {row.name}
                        </Link>
                      ) : (
                        <span className="text-muted">{row.name}</span>
                      )}
                    </Td>
                    <Td align="right" mono>
                      {formatNumber(row.created)}
                    </Td>
                    <Td align="right" mono>
                      {formatNumber(row.won)}
                    </Td>
                    <Td align="right" mono>
                      {formatMoney(row.wonValueCents)}
                    </Td>
                    <Td align="right" mono>
                      {formatMoney(row.openValueCents)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card aria-labelledby="consumi">
          <CardHeader
            id="consumi"
            title="Consumi"
            description={`Uso rispetto ai limiti del piano in ${formatMonth(new Date())}. I consumi si contano sempre sul mese in corso, qualunque periodo tu abbia scelto sopra.`}
          />
          <UsageMeters rows={usage} />
        </Card>
      </div>
    </>
  );
}
