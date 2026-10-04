import { MoveForm } from "@/components/deals/move-form";
import { FeatureOff } from "@/components/feature-off";
import { StatusPill } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/form-message";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Table, Td, Th } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/action";
import { cn } from "@/lib/cn";
import { stageKind } from "@/lib/customer-labels";
import { loadAssignees } from "@/lib/deals/assignees";
import {
  DEAL_STATES,
  DEAL_STATE_LABELS,
  buildBoard,
  dealAgeDays,
  dealAgeLabel,
  parseDealFilter,
  sortStages,
  stageIdsForFilter,
} from "@/lib/deals/board";
import { featureOn } from "@/lib/feature-gate";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { firstParam, pageWindow, parsePage, withParams } from "@/lib/pagination";
import { peopleNames } from "@/lib/people";
import { chunk, fetchAllRows } from "@/lib/report/fetch";
import { type OrgContext, requireOrg } from "@/lib/session";
import type { Row } from "@ia-connect/core";
import type { Metadata } from "next";
import Link from "next/link";
import { moveDeal } from "./actions";

export const metadata: Metadata = { title: "Trattative" };

const PATH = "/app/trattative";
const BOARD_CAP = 3000;
const CARDS_PER_COLUMN = 30;
const PAGE_SIZE = 25;

type Params = Record<string, string | string[] | undefined>;
type Stage = Pick<Row<"deal_stages">, "id" | "name" | "position" | "kind">;

async function contactNames(context: OrgContext, ids: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const part of chunk([...new Set(ids)])) {
    const { data } = await context.supabase
      .from("contacts")
      .select("id, full_name, phones, emails")
      .eq("organization_id", context.org.organization.id)
      .in("id", part);
    for (const c of data ?? [])
      names.set(c.id, c.full_name.trim() || c.phones[0] || c.emails[0] || "Senza nome");
  }
  return names;
}

export default async function DealsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const context = await requireOrg();
  const { supabase, org } = context;
  const organizationId = org.organization.id;
  if (!(await featureOn(supabase, organizationId, "deals"))) return <FeatureOff title="Trattative" />;
  const params = await searchParams;
  const listView = firstParam(params.vista) === "elenco";

  const stagesResult = await supabase
    .from("deal_stages")
    .select("id, name, position, kind")
    .eq("organization_id", organizationId);
  const stages = sortStages(stagesResult.data ?? []);

  return (
    <>
      <PageHeader
        title="Trattative"
        description="Ogni richiesta che può diventare un cliente, fase per fase."
        actions={
          <ButtonLink href={`${PATH}/nuova`} icon="plus">
            Nuova trattativa
          </ButtonLink>
        }
      />
      <Tabs
        label="Vista delle trattative"
        className="mb-4"
        items={[
          { href: PATH, label: "Per fase", current: !listView },
          { href: withParams(PATH, { vista: "elenco" }), label: "Elenco", current: listView },
        ]}
      />
      {stagesResult.error ? (
        <Notice tone="error" announce="alert">
          {errorMessage(stagesResult.error)}
        </Notice>
      ) : stages.length === 0 ? (
        <EmptyState
          icon="deal"
          title="Nessuna fase definita"
          description="Le trattative si muovono tra fasi (per esempio Nuova richiesta → Proposta inviata → Chiusa). Creale in Impostazioni."
          action={
            <ButtonLink href="/app/impostazioni/fasi" variant="secondary">
              Fasi delle trattative
            </ButtonLink>
          }
        />
      ) : listView ? (
        <DealList context={context} stages={stages} params={params} />
      ) : (
        <Board context={context} stages={stages} />
      )}
    </>
  );
}

async function Board({ context, stages }: { context: OrgContext; stages: Stage[] }) {
  const { supabase, org } = context;
  const organizationId = org.organization.id;
  const deals = await fetchAllRows(
    (from, to) =>
      supabase
        .from("deals")
        .select(
          "id, title, contact_id, stage_id, estimated_value_cents, currency, next_action, next_action_at, assignee_user_id, created_at, closed_at",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .range(from, to),
    BOARD_CAP,
  );
  if (deals.error) {
    return (
      <Notice tone="error" announce="alert">
        {errorMessage(deals.error)}
      </Notice>
    );
  }
  if (deals.rows.length === 0) {
    return (
      <EmptyState
        icon="deal"
        title="Nessuna trattativa"
        description="Le trattative nascono dai flussi (per esempio a ogni richiesta di preventivo) oppure le crei tu a mano."
        action={
          <ButtonLink href={`${PATH}/nuova`} icon="plus">
            Nuova trattativa
          </ButtonLink>
        }
      />
    );
  }
  const board = buildBoard(stages, deals.rows);
  const shownDeals = board.flatMap((column) => column.deals.slice(0, CARDS_PER_COLUMN));
  const names = await contactNames(
    context,
    shownDeals.map((deal) => deal.contact_id),
  );
  const now = new Date();

  return (
    <>
      {deals.truncated ? (
        <Notice tone="warning" className="mb-4">
          Ci sono più di {formatNumber(BOARD_CAP)} trattative: qui sono contate le più recenti, quindi i
          totali delle colonne sono parziali. L'elenco le mostra tutte.
        </Notice>
      ) : null}
      <section
        className="overflow-x-auto pb-2 contain-inline-size"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard
        tabIndex={0}
        aria-label="Trattative per fase"
      >
        <ol className="flex min-w-max gap-3">
          {board.map((column) => (
            <li
              key={column.stage.id}
              className="flex w-[272px] shrink-0 flex-col rounded-panel border border-line bg-surface-2/50"
            >
              <div className="border-b border-line p-3">
                <h2 className="flex items-center justify-between gap-2 font-display text-[15px] font-bold">
                  <span className="truncate">{column.stage.name}</span>
                  {column.stage.kind !== "open" ? <StatusPill {...stageKind(column.stage.kind)} /> : null}
                </h2>
                <p className="mt-0.5 font-mono text-[12.5px] text-muted">
                  {column.count === 1 ? "1 trattativa" : `${formatNumber(column.count)} trattative`} ·{" "}
                  {formatMoney(column.valueCents)}
                </p>
              </div>
              {column.deals.length === 0 ? (
                <p className="p-3 text-[13px] text-muted">Nessuna trattativa in questa fase.</p>
              ) : (
                <ul className="grid gap-2 p-2">
                  {column.deals.slice(0, CARDS_PER_COLUMN).map((deal) => {
                    const overdue =
                      column.stage.kind === "open" &&
                      deal.next_action_at !== null &&
                      new Date(deal.next_action_at).getTime() < now.getTime() - 86_400_000;
                    return (
                      <li
                        key={deal.id}
                        className="grid gap-2 rounded-lg border border-line bg-surface p-3 text-sm"
                      >
                        <div>
                          <Link href={`${PATH}/${deal.id}`} className="font-semibold leading-snug underline">
                            {deal.title}
                          </Link>
                          <p className="truncate text-[13px] text-muted">
                            {names.get(deal.contact_id) ?? "—"}
                          </p>
                        </div>
                        <p className="flex items-baseline justify-between gap-2">
                          <span className="font-mono text-[13px] font-medium tabular-nums">
                            {deal.estimated_value_cents === null
                              ? "Valore non indicato"
                              : formatMoney(deal.estimated_value_cents, deal.currency)}
                          </span>
                          <span className="text-[12px] text-muted">
                            {dealAgeLabel(dealAgeDays(deal.created_at, now))}
                          </span>
                        </p>
                        {deal.next_action || deal.next_action_at ? (
                          <p
                            className={cn("text-[13px]", overdue ? "font-medium text-danger" : "text-muted")}
                          >
                            {overdue ? "In ritardo: " : "Prossima azione: "}
                            {deal.next_action ?? "da definire"}
                            {deal.next_action_at ? ` · ${formatDate(deal.next_action_at)}` : ""}
                          </p>
                        ) : null}
                        <MoveForm
                          action={moveDeal.bind(null, deal.id)}
                          dealId={deal.id}
                          dealTitle={deal.title}
                          currentStageId={deal.stage_id}
                          stages={stages}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
              {column.deals.length > CARDS_PER_COLUMN ? (
                <p className="px-3 pb-3 text-[13px]">
                  <Link
                    href={withParams(PATH, { vista: "elenco", stato: "tutte", fase: column.stage.id })}
                    className="font-semibold underline"
                  >
                    Altre {formatNumber(column.deals.length - CARDS_PER_COLUMN)} nell'elenco
                  </Link>
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

async function DealList({
  context,
  stages,
  params,
}: { context: OrgContext; stages: Stage[]; params: Params }) {
  const { supabase, org, session } = context;
  const organizationId = org.organization.id;
  const filter = parseDealFilter(params);
  const page = parsePage(params.pagina);
  const { from, to } = pageWindow(page, PAGE_SIZE);
  const stageIds = stageIdsForFilter(stages, filter);
  const assignees = await loadAssignees(context, [filter.assignee === "nessuno" ? null : filter.assignee]);
  const base = {
    vista: "elenco",
    stato: filter.state === "aperte" ? null : filter.state,
    fase: filter.stageId,
    assegnata: filter.assignee,
  };

  let rows: Pick<
    Row<"deals">,
    | "id"
    | "title"
    | "contact_id"
    | "stage_id"
    | "estimated_value_cents"
    | "currency"
    | "next_action"
    | "next_action_at"
    | "assignee_user_id"
    | "created_at"
  >[] = [];
  let total = 0;
  let error: unknown = null;
  if (stageIds.length > 0) {
    let query = supabase
      .from("deals")
      .select(
        "id, title, contact_id, stage_id, estimated_value_cents, currency, next_action, next_action_at, assignee_user_id, created_at",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .in("stage_id", stageIds)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (filter.assignee === "nessuno") query = query.is("assignee_user_id", null);
    else if (filter.assignee) query = query.eq("assignee_user_id", filter.assignee);
    const result = await query;
    rows = result.data ?? [];
    total = result.count ?? 0;
    error = result.error;
  }
  const [names, nameOf] = await Promise.all([
    contactNames(
      context,
      rows.map((deal) => deal.contact_id),
    ),
    peopleNames(
      rows.map((deal) => deal.assignee_user_id),
      session.user,
    ),
  ]);
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));

  return (
    <>
      <form
        action={PATH}
        method="get"
        className="mb-4 grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]"
      >
        <input type="hidden" name="vista" value="elenco" />
        <div>
          <label htmlFor="deal-state" className="sr-only">
            Stato
          </label>
          <Select id="deal-state" name="stato" defaultValue={filter.state}>
            {DEAL_STATES.map((state) => (
              <option key={state} value={state}>
                {DEAL_STATE_LABELS[state]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="deal-stage" className="sr-only">
            Fase
          </label>
          <Select id="deal-stage" name="fase" defaultValue={filter.stageId ?? ""}>
            <option value="">Tutte le fasi</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="deal-assignee" className="sr-only">
            Assegnata a
          </label>
          <Select id="deal-assignee" name="assegnata" defaultValue={filter.assignee ?? ""}>
            <option value="">Chiunque</option>
            <option value="nessuno">Non assegnate</option>
            {assignees.map((person) => (
              <option key={person.id} value={person.id}>
                {person.label}
              </option>
            ))}
          </Select>
        </div>
        <button
          type="submit"
          className="h-10 rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-2"
        >
          Filtra
        </button>
      </form>
      {error ? (
        <Notice tone="error" announce="alert">
          {errorMessage(error)}
        </Notice>
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          title="Nessuna trattativa con questi filtri"
          description={
            stageIds.length === 0
              ? "La fase scelta non corrisponde allo stato scelto: cambia uno dei due."
              : "Cambia i filtri oppure crea una trattativa."
          }
        />
      ) : (
        <>
          <Table caption="Trattative" minWidth={820}>
            <thead>
              <tr>
                <Th>Trattativa</Th>
                <Th>Fase</Th>
                <Th align="right">Valore</Th>
                <Th>Prossima azione</Th>
                <Th>Assegnata a</Th>
                <Th>Creata</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((deal) => {
                const stage = stageById.get(deal.stage_id);
                return (
                  <tr key={deal.id}>
                    <Td>
                      <Link href={`${PATH}/${deal.id}`} className="font-semibold underline">
                        {deal.title}
                      </Link>
                      <span className="block text-[13px] text-muted">
                        {names.get(deal.contact_id) ?? "—"}
                      </span>
                    </Td>
                    <Td>
                      {stage?.name ?? "—"}
                      {stage && stage.kind !== "open" ? (
                        <span className="mt-1 block">
                          <StatusPill {...stageKind(stage.kind)} />
                        </span>
                      ) : null}
                    </Td>
                    <Td align="right" mono>
                      {formatMoney(deal.estimated_value_cents, deal.currency)}
                    </Td>
                    <Td muted>
                      {deal.next_action ?? "—"}
                      {deal.next_action_at ? (
                        <span className="block">{formatDate(deal.next_action_at)}</span>
                      ) : null}
                    </Td>
                    <Td muted>{nameOf(deal.assignee_user_id)}</Td>
                    <Td mono muted>
                      {formatDate(deal.created_at)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            hrefFor={(p) => withParams(PATH, { ...base, pagina: p })}
          />
        </>
      )}
    </>
  );
}
