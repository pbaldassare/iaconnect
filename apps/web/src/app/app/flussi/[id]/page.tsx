import { AutoRefresh, RefreshButton } from "@/components/flows/auto-refresh";
import { FlowDiagram } from "@/components/flows/flow-diagram";
import { type RunStepRow, RunSteps } from "@/components/flows/run-steps";
import { AiBadge, Badge, StatusPill } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/action";
import { eventTitle } from "@/lib/flows/describe";
import { parseRequirements, planTemplateInstall } from "@/lib/flows/install";
import { type FlowEnvironment, loadFlowEnvironment, loadFlowPermissions } from "@/lib/flows/server";
import {
  INBOUND_TEST_EVENT_NOTE,
  isInboundMessageEvent,
  sampleEventPayload,
  testEventMode,
} from "@/lib/flows/test-event";
import { type DiagramView, buildDiagram } from "@/lib/flows/view";
import { formatDateTime, formatRelative, shortId } from "@/lib/format";
import { connectorCategoryLabel, flowStatus, runStatus } from "@/lib/labels";
import { isUuid } from "@/lib/org-selection";
import { firstParam, withParams } from "@/lib/pagination";
import { type OrgContext, requireOrg } from "@/lib/session";
import { type Row, validateFlow } from "@ia-connect/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  activateFlow,
  pauseFlow,
  requestSimulation,
  restoreVersion,
  saveManualVersion,
  sendTestEvent,
} from "../actions";

export const metadata: Metadata = { title: "Flusso" };

const TABS = [
  { key: "schema", label: "Schema" },
  { key: "controlli", label: "Controlli" },
  { key: "simulazione", label: "Simulazione" },
  { key: "versioni", label: "Versioni" },
  { key: "esecuzioni", label: "Esecuzioni" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const AUTHORS: Record<string, string> = { user: "Utente", ai: "IA", system: "Sistema" };

const OUTCOMES: Record<string, string> = {
  bozza: "Bozza salvata come nuova versione. Controllala e, se vuoi, simulala prima di attivarla.",
  salvata: "Nuova versione salvata. Diventa operativa solo quando la attivi.",
  ripristinata: "Versione ripristinata come nuova versione. Diventa operativa solo quando la attivi.",
};

type Version = Row<"flow_versions">;
type VersionSummary = Pick<Version, "id" | "version" | "author_type" | "note" | "created_at">;

export default async function FlowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireOrg();
  const { supabase, org } = context;
  const orgId = org.organization.id;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;
  const tabParam = firstParam(query.scheda);
  const tab: TabKey = TABS.some((item) => item.key === tabParam) ? (tabParam as TabKey) : "schema";

  const { data: flow } = await supabase
    .from("flows")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!flow) notFound();

  const [versionsResult, environment, permissions] = await Promise.all([
    supabase
      .from("flow_versions")
      .select("id, version, author_type, note, created_at")
      .eq("flow_id", flow.id)
      .eq("organization_id", orgId)
      .order("version", { ascending: false })
      .limit(100),
    loadFlowEnvironment(context, { excludeFlowId: flow.id }),
    loadFlowPermissions(context),
  ]);
  const versions: VersionSummary[] = versionsResult.data ?? [];
  const latest = versions[0];
  const wanted = firstParam(query.versione);
  const selectedId =
    (isUuid(wanted) && versions.some((version) => version.id === wanted) ? wanted : null) ??
    flow.active_version_id ??
    latest?.id ??
    null;

  let selected: Version | null = null;
  if (selectedId) {
    const { data } = await supabase
      .from("flow_versions")
      .select("*")
      .eq("id", selectedId)
      .eq("flow_id", flow.id)
      .eq("organization_id", orgId)
      .maybeSingle();
    selected = data;
  }

  const result = selected ? validateFlow(selected.definition, environment.validation) : null;
  const diagram = result?.definition
    ? buildDiagram(result.definition, result.issues, environment.names)
    : null;
  const errors = result ? result.issues.filter((issue) => issue.level === "error").length : 0;
  const warnings = result ? result.issues.length - errors : 0;
  const isActiveVersion = Boolean(selected && flow.active_version_id === selected.id);
  const newerDraft = Boolean(latest && flow.active_version_id && latest.id !== flow.active_version_id);
  const href = (key: TabKey, versionId: string | null = selected?.id ?? null) =>
    withParams(`/app/flussi/${flow.id}`, {
      scheda: key === "schema" ? null : key,
      versione: versionId && versionId !== (flow.active_version_id ?? latest?.id) ? versionId : null,
    });

  // What a library template still needs, shown until the flow is active.
  let missing: ReturnType<typeof planTemplateInstall> | null = null;
  if (flow.template_key && flow.status !== "active") {
    const { data: template } = await supabase
      .from("flow_templates")
      .select("requirements")
      .eq("key", flow.template_key)
      .maybeSingle();
    if (template) {
      missing = planTemplateInstall(parseRequirements(template.requirements), {
        templates: environment.templates,
        connections: environment.connections,
      });
    }
  }
  const installed = firstParam(query.installato);
  const outcome = OUTCOMES[firstParam(query.esito)];

  return (
    <>
      <PageHeader
        title={flow.name}
        eyebrow="Flusso"
        description={flow.description || undefined}
        back={{ href: "/app/flussi", label: "Flussi" }}
        actions={
          <>
            <StatusPill {...flowStatus(flow.status)} />
            {permissions.canUseAssistant ? (
              <ButtonLink href={`/app/flussi/${flow.id}/assistente`} variant="secondary" icon="spark">
                Modifica con l'assistente
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <div className="grid gap-5">
        {installed ? (
          <Notice tone={installed === "parziale" ? "warning" : "ok"} announce="status">
            {installed === "parziale"
              ? "Flusso installato come bozza, ma non tutti i modelli di messaggio sono stati creati: controlla qui sotto cosa manca."
              : "Flusso installato come bozza. Qui sotto vedi cosa serve ancora prima di attivarlo."}
          </Notice>
        ) : null}
        {outcome ? (
          <Notice tone="ok" announce="status">
            {outcome}
          </Notice>
        ) : null}
        {versionsResult.error || environment.error ? (
          <Notice tone="error">{errorMessage(versionsResult.error ?? environment.error)}</Notice>
        ) : null}

        {missing && !missing.ready ? (
          <Notice tone="warning" title="Cosa manca per attivarlo">
            <ul className="mt-1 grid list-disc gap-1 pl-4">
              {missing.missingConnections.map((item) => (
                <li key={item.category}>
                  Un collegamento {connectorCategoryLabel(item.category)} attivo
                  {item.existing ? " (quello esistente va ricollegato)" : ""}:{" "}
                  <Link href="/app/collegamenti">vai a Collegamenti</Link>.
                </li>
              ))}
              {missing.templatesAwaitingApproval.map((item) => (
                <li key={`${item.channel}:${item.name}`}>
                  Il modello di messaggio «{item.name}» deve essere approvato
                  {item.status === "draft"
                    ? " (ora è una bozza)"
                    : item.status === "rejected"
                      ? " (è stato rifiutato)"
                      : ""}
                  :{" "}
                  <Link href="/app/impostazioni/modelli">
                    si gestisce in Impostazioni → Modelli di messaggio
                  </Link>
                  .
                </li>
              ))}
              {missing.contactFields.length > 0 ? (
                <li>I contatti devono avere i campi: {missing.contactFields.join(", ")}.</li>
              ) : null}
            </ul>
          </Notice>
        ) : null}

        <Card className="grid gap-3">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted">Parte quando</dt>
                <dd className="font-medium">
                  {eventTitle(result?.definition?.trigger.event ?? flow.trigger_event)}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Versione mostrata</dt>
                <dd className="flex flex-wrap items-center gap-1.5 font-medium">
                  {selected ? `Versione ${selected.version}` : "Nessuna"}
                  {isActiveVersion ? (
                    <Badge tone="ok">{flow.status === "active" ? "In uso" : "Scelta"}</Badge>
                  ) : selected ? (
                    <Badge>Bozza</Badge>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Controlli</dt>
                <dd className="font-medium">
                  {!result
                    ? "—"
                    : errors > 0
                      ? `${errors} ${errors === 1 ? "errore" : "errori"}`
                      : warnings > 0
                        ? `Nessun errore, ${warnings} ${warnings === 1 ? "avviso" : "avvisi"}`
                        : "Tutto in ordine"}
                </dd>
              </div>
            </dl>
            {permissions.canEdit && selected ? (
              <div className="flex flex-wrap items-start gap-2">
                {flow.status === "active" && isActiveVersion ? (
                  <ActionForm action={pauseFlow.bind(null, flow.id)} className="grid max-w-72 gap-2">
                    <SubmitButton variant="secondary">Metti in pausa</SubmitButton>
                  </ActionForm>
                ) : (
                  <ActionForm
                    action={activateFlow.bind(null, flow.id, selected.id)}
                    className="grid max-w-72 gap-2"
                  >
                    <SubmitButton disabled={errors > 0} pendingLabel="Controllo…">
                      {flow.status === "paused" && isActiveVersion
                        ? "Riattiva"
                        : flow.active_version_id && !isActiveVersion
                          ? `Attiva la versione ${selected.version}`
                          : "Attiva"}
                    </SubmitButton>
                    {errors > 0 ? (
                      <p className="text-[13px] text-muted">
                        Si attiva solo senza errori: vedi <Link href={href("controlli")}>Controlli</Link>.
                      </p>
                    ) : null}
                  </ActionForm>
                )}
              </div>
            ) : null}
          </div>
          {newerDraft && isActiveVersion && latest ? (
            <p className="text-sm text-muted">
              Esiste una versione più recente non ancora attiva:{" "}
              <Link href={href(tab, latest.id)} className="underline">
                vedi la versione {latest.version}
              </Link>
              .
            </p>
          ) : null}
          {selected && !isActiveVersion && flow.active_version_id ? (
            <p className="text-sm text-muted">
              Stai guardando una versione diversa da quella {flow.status === "active" ? "in uso" : "scelta"}.{" "}
              <Link href={href(tab, flow.active_version_id)} className="underline">
                Torna a quella {flow.status === "active" ? "in uso" : "scelta"}
              </Link>
              .
            </p>
          ) : null}
        </Card>

        <Tabs
          label="Sezioni del flusso"
          items={TABS.map((item) => ({
            href: href(item.key),
            label: item.label,
            current: tab === item.key,
            count:
              item.key === "controlli" && result && result.issues.length > 0
                ? result.issues.length
                : item.key === "versioni"
                  ? versions.length
                  : undefined,
          }))}
        />

        {!selected ? (
          <EmptyState
            icon="flow"
            title="Questo flusso non ha ancora una versione"
            description="Descrivilo all'assistente oppure incolla una definizione nella scheda «Versioni»."
          />
        ) : null}

        {selected && tab === "schema" ? (
          <SchemaTab diagram={diagram} version={selected} result={result} />
        ) : null}
        {selected && tab === "controlli" ? (
          <ChecksTab diagram={diagram} result={result} environment={environment} />
        ) : null}
        {selected && tab === "simulazione" ? (
          <SimulationTab context={context} flow={flow} version={selected} schemaValid={Boolean(diagram)} />
        ) : null}
        {tab === "versioni" ? (
          <VersionsTab
            flow={flow}
            versions={versions}
            selected={selected}
            canEdit={permissions.canEdit}
            versionHref={(versionId) => href("schema", versionId)}
          />
        ) : null}
        {tab === "esecuzioni" ? <RunsTab context={context} flow={flow} /> : null}
      </div>
    </>
  );
}

type Validation = ReturnType<typeof validateFlow>;

function SchemaErrors({ result }: { result: Validation | null }) {
  return (
    <Notice tone="error" title="Questa versione non rispetta lo schema dei flussi">
      <ul className="mt-1 grid list-disc gap-1 pl-4">
        {(result?.issues ?? []).slice(0, 12).map((issue) => (
          <li key={issue.message}>{issue.message}</li>
        ))}
      </ul>
    </Notice>
  );
}

function SchemaTab({
  diagram,
  version,
  result,
}: {
  diagram: DiagramView | null;
  version: Version;
  result: Validation | null;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
      <Card>
        <CardHeader
          title="Schema leggibile"
          description="Il flusso dall'alto verso il basso. Dove non è indicato altro, dopo un passo si prosegue con quello sotto."
        />
        {diagram ? <FlowDiagram view={diagram} /> : <SchemaErrors result={result} />}
      </Card>
      <Card>
        <CardHeader
          title={`Versione ${version.version}`}
          description={`${AUTHORS[version.author_type] ?? version.author_type} · ${formatDateTime(version.created_at)}`}
          actions={version.author_type === "ai" ? <AiBadge>Proposta dall'IA</AiBadge> : null}
        />
        {version.note ? <p className="mb-3 whitespace-pre-wrap text-sm">{version.note}</p> : null}
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Vedi il JSON</summary>
          <pre className="mt-2 max-h-[32rem] overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[12px] leading-relaxed">
            {JSON.stringify(version.definition, null, 2)}
          </pre>
        </details>
      </Card>
    </div>
  );
}

function ChecksTab({
  diagram,
  result,
  environment,
}: {
  diagram: DiagramView | null;
  result: Validation | null;
  environment: FlowEnvironment;
}) {
  if (!diagram) return <SchemaErrors result={result} />;
  const clean = diagram.errors === 0 && diagram.warnings === 0;
  const flagged = diagram.steps.filter((step) => step.issues.length > 0);
  return (
    <Card>
      <CardHeader
        title="Controlli"
        description="Il flusso viene confrontato con i collegamenti, i modelli di messaggio, le fasi e i limiti del piano di adesso."
      />
      <div className="grid gap-4">
        {clean ? (
          <Notice tone="ok" title="Tutto in ordine">
            Nessun errore e nessun avviso: il flusso si può attivare.
          </Notice>
        ) : (
          <Notice
            tone={diagram.errors > 0 ? "error" : "warning"}
            title={
              diagram.errors > 0
                ? `${diagram.errors} ${diagram.errors === 1 ? "errore impedisce" : "errori impediscono"} l'attivazione`
                : "Nessun errore: si può attivare"
            }
          >
            {diagram.warnings > 0
              ? `${diagram.warnings} ${diagram.warnings === 1 ? "avviso" : "avvisi"} da leggere: non bloccano l'attivazione.`
              : "Correggi gli errori, poi torna qui."}
          </Notice>
        )}
        {diagram.general.length > 0 ? (
          <section aria-label="Problemi generali" className="grid gap-1.5">
            <h3 className="text-sm font-semibold">In generale</h3>
            <IssueList issues={diagram.general} />
          </section>
        ) : null}
        {flagged.map((step) => (
          <section key={step.id} aria-label={`Passo ${step.position}`} className="grid gap-1.5">
            <h3 className="text-sm font-semibold">
              Passo {step.position}. {step.title}{" "}
              <span className="font-mono text-[11px] font-normal text-muted">{step.id}</span>
            </h3>
            <p className="text-[13px] text-muted">{step.summary}</p>
            <IssueList issues={step.issues} />
          </section>
        ))}
        <p className="text-[13px] text-muted">
          Controllato con {environment.connections.filter((item) => item.status === "active").length}{" "}
          collegamenti attivi,{" "}
          {environment.templates.filter((item) => item.approval_status === "approved").length} modelli
          approvati e {environment.stages.length} fasi.
        </p>
      </div>
    </Card>
  );
}

function IssueList({ issues }: { issues: { level: "error" | "warning"; text: string }[] }) {
  return (
    <ul className="grid gap-1.5">
      {issues.map((issue) => (
        <li key={`${issue.level}:${issue.text}`} className="flex flex-wrap items-start gap-2 text-sm">
          <Badge tone={issue.level === "error" ? "error" : "warning"}>
            {issue.level === "error" ? "Errore" : "Avviso"}
          </Badge>
          <span className="min-w-0 flex-1 break-words">{issue.text}</span>
        </li>
      ))}
    </ul>
  );
}

async function SimulationTab({
  context,
  flow,
  version,
  schemaValid,
}: {
  context: OrgContext;
  flow: Row<"flows">;
  version: Version;
  schemaValid: boolean;
}) {
  const { supabase, org } = context;
  const orgId = org.organization.id;
  const [runs, jobs] = await Promise.all([
    supabase
      .from("flow_runs")
      .select("id, status, event_id, error, started_at, finished_at, contact_id")
      .eq("organization_id", orgId)
      .eq("flow_version_id", version.id)
      .eq("mode", "simulation")
      .order("started_at", { ascending: false })
      .limit(10),
    supabase
      .from("scheduled_jobs")
      .select("id, status, last_error, created_at")
      .eq("organization_id", orgId)
      .eq("kind", "simulate_flow")
      .contains("payload", { flow_version_id: version.id })
      .order("created_at", { ascending: false })
      .limit(3),
  ]);
  const runRows = runs.data ?? [];
  const runIds = runRows.map((run) => run.id);
  const eventIds = runRows.flatMap((run) => (run.event_id ? [run.event_id] : []));
  const [steps, events] = await Promise.all([
    runIds.length
      ? supabase
          .from("flow_run_steps")
          .select(
            "id, flow_run_id, step_id, block, status, outlet, input, output, error, ai_cost_micros, duration_ms, created_at",
          )
          .eq("organization_id", orgId)
          .in("flow_run_id", runIds)
          .order("created_at")
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    eventIds.length
      ? supabase.from("events").select("id, occurred_at").eq("organization_id", orgId).in("id", eventIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const stepsByRun = new Map<string, RunStepRow[]>();
  for (const step of steps.data ?? []) {
    const list = stepsByRun.get(step.flow_run_id) ?? [];
    list.push(step);
    stepsByRun.set(step.flow_run_id, list);
  }
  const eventTimes = new Map((events.data ?? []).map((event) => [event.id, event.occurred_at]));
  const lastJob = (jobs.data ?? [])[0];
  const pending = (jobs.data ?? []).some((job) => job.status === "pending" || job.status === "running");

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title={`Simulazione della versione ${version.version}`}
          description="Il flusso gira sugli ultimi eventi reali compatibili (fino a 3), oppure su un evento vuoto se non ce ne sono."
          actions={<RefreshButton />}
        />
        <div className="grid gap-3">
          <Notice tone="neutral" title="In simulazione non viene inviato nulla">
            Nessun messaggio parte e nessun dato viene scritto su contatti, trattative o gestionale: ogni
            passo mostra cosa sarebbe successo. I passi con l'IA la usano davvero, quindi consumano crediti
            IA.
          </Notice>
          {org.canManage ? (
            <ActionForm action={requestSimulation.bind(null, flow.id, version.id)} className="grid gap-2">
              <div>
                <SubmitButton disabled={!schemaValid} pendingLabel="Richiesta…">
                  {runRows.length > 0 ? "Simula di nuovo" : "Simula"}
                </SubmitButton>
              </div>
            </ActionForm>
          ) : null}
          <AutoRefresh active={pending} />
          {lastJob?.status === "failed" ? (
            <Notice tone="error" title="L'ultima simulazione non è partita">
              Il motore ha rifiutato la richiesta. Controlla la scheda «Controlli» e riprova.
            </Notice>
          ) : null}
          {runs.error || steps.error ? (
            <Notice tone="error">{errorMessage(runs.error ?? steps.error)}</Notice>
          ) : null}
        </div>
      </Card>
      {runRows.length === 0 && !pending ? (
        <EmptyState
          compact
          title="Nessuna simulazione per questa versione"
          description="Dopo la simulazione qui compare ogni passo con il suo esito: per esempio il testo del messaggio che verrebbe inviato."
        />
      ) : null}
      {runRows.map((run) => (
        <Card key={run.id}>
          <CardHeader
            title={
              run.event_id
                ? `Sull'evento del ${formatDateTime(eventTimes.get(run.event_id) ?? run.started_at)}`
                : "Su un evento vuoto"
            }
            description={`Simulata ${formatRelative(run.started_at)}`}
            actions={<StatusPill {...runStatus(run.status)} />}
          />
          {run.error ? (
            <Notice tone="error" className="mb-3">
              {run.error}
            </Notice>
          ) : null}
          <RunSteps steps={stepsByRun.get(run.id) ?? []} />
        </Card>
      ))}
    </div>
  );
}

function VersionsTab({
  flow,
  versions,
  selected,
  canEdit,
  versionHref,
}: {
  flow: Row<"flows">;
  versions: VersionSummary[];
  selected: Version | null;
  canEdit: boolean;
  versionHref: (versionId: string) => string;
}) {
  return (
    <div className="grid gap-5">
      {versions.length > 0 ? (
        <Table caption="Versioni del flusso" minWidth={720}>
          <thead>
            <tr>
              <Th>Versione</Th>
              <Th>Autore</Th>
              <Th>Nota</Th>
              <Th>Data</Th>
              <Th>Azioni</Th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.id}>
                <Td mono>
                  {version.version}
                  {version.id === flow.active_version_id ? (
                    <Badge tone="ok" className="ml-2">
                      {flow.status === "active" ? "In uso" : "Scelta"}
                    </Badge>
                  ) : null}
                </Td>
                <Td>
                  {version.author_type === "ai" ? (
                    <AiBadge />
                  ) : (
                    (AUTHORS[version.author_type] ?? version.author_type)
                  )}
                </Td>
                <Td muted className="max-w-[40ch] break-words">
                  {version.note || "—"}
                </Td>
                <Td mono>{formatDateTime(version.created_at)}</Td>
                <Td>
                  <div className="flex flex-wrap items-start gap-2">
                    <ButtonLink href={versionHref(version.id)} size="sm" variant="secondary">
                      Vedi
                    </ButtonLink>
                    {canEdit && version.id !== versions[0]?.id ? (
                      <ActionForm
                        action={restoreVersion.bind(null, flow.id, version.id)}
                        className="grid max-w-56 gap-2"
                      >
                        <SubmitButton size="sm" variant="ghost">
                          Ripristina
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      <p className="text-[13px] text-muted">
        Le versioni non si modificano né si cancellano: ogni cambiamento ne crea una nuova. «Ripristina» copia
        una versione precedente in una nuova, che poi puoi attivare.
      </p>
      {canEdit ? (
        <Card>
          <CardHeader
            title="Modifica manuale (per esperti)"
            description="Modifica il JSON della versione mostrata. Viene controllato con lo schema e il catalogo dei blocchi, poi salvato come nuova versione; quella attiva non cambia."
          />
          <details>
            <summary className="cursor-pointer text-sm font-medium">Apri l'editor</summary>
            <ActionForm action={saveManualVersion.bind(null, flow.id)} className="mt-3 grid gap-4">
              <Field
                label="Definizione (JSON)"
                htmlFor="definition"
                name="definition"
                hint="trigger + steps. Si possono usare solo i blocchi del catalogo."
              >
                <Textarea
                  id="definition"
                  name="definition"
                  rows={18}
                  required
                  spellCheck={false}
                  className="font-mono text-[12.5px]"
                  defaultValue={selected ? JSON.stringify(selected.definition, null, 2) : ""}
                />
              </Field>
              <Field
                label="Nota"
                htmlFor="note"
                name="note"
                optional
                hint="Cosa hai cambiato, per chi leggerà la cronologia."
              >
                <Input id="note" name="note" maxLength={300} />
              </Field>
              <div>
                <SubmitButton pendingLabel="Controllo e salvo…">Salva come nuova versione</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </Card>
      ) : null}
    </div>
  );
}

async function RunsTab({ context, flow }: { context: OrgContext; flow: Row<"flows"> }) {
  const { supabase, org } = context;
  const orgId = org.organization.id;
  const { data: runs, error } = await supabase
    .from("flow_runs")
    .select(
      "id, status, started_at, finished_at, contact_id, current_step_id, error, waiting_for, wait_until",
    )
    .eq("organization_id", orgId)
    .eq("flow_id", flow.id)
    .eq("mode", "live")
    .order("started_at", { ascending: false })
    .limit(30);
  const rows = runs ?? [];
  const contactIds = [...new Set(rows.flatMap((run) => (run.contact_id ? [run.contact_id] : [])))];
  const { data: contacts } = contactIds.length
    ? await supabase
        .from("contacts")
        .select("id, full_name")
        .eq("organization_id", orgId)
        .in("id", contactIds)
    : { data: [] };
  const names = new Map((contacts ?? []).map((contact) => [contact.id, contact.full_name]));
  const waiting: Record<string, string> = {
    reply: "una risposta",
    timer: "una scadenza",
    approval: "un'approvazione",
  };
  const types = [
    "manual.test",
    ...(flow.trigger_event && flow.trigger_event !== "manual.test" ? [flow.trigger_event] : []),
  ];

  return (
    <div className="grid gap-5">
      {error ? <Notice tone="error">{errorMessage(error)}</Notice> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[17px] font-bold tracking-tight">Esecuzioni recenti</h2>
        <RefreshButton />
      </div>
      {rows.length === 0 && !error ? (
        <EmptyState
          compact
          title="Nessuna esecuzione"
          description="Quando il flusso è attivo, ogni evento che corrisponde al trigger crea un'esecuzione, che compare qui con il suo esito."
        />
      ) : null}
      {rows.length > 0 ? (
        <Table caption="Esecuzioni recenti del flusso" minWidth={820}>
          <thead>
            <tr>
              <Th>Iniziata</Th>
              <Th>Stato</Th>
              <Th>Contatto</Th>
              <Th>Passo attuale</Th>
              <Th>Finita</Th>
              <Th>Errore</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((run) => (
              <tr key={run.id}>
                <Td mono>
                  <Link
                    href={`/app/flussi/${flow.id}/esecuzioni/${run.id}`}
                    className="underline underline-offset-2"
                  >
                    {formatDateTime(run.started_at)}
                  </Link>
                </Td>
                <Td>
                  <StatusPill {...runStatus(run.status)} />
                  {run.status === "waiting" && run.waiting_for ? (
                    <span className="mt-1 block text-[13px] text-muted">
                      aspetta {waiting[run.waiting_for] ?? run.waiting_for}
                      {run.wait_until ? ` fino al ${formatDateTime(run.wait_until)}` : ""}
                    </span>
                  ) : null}
                </Td>
                <Td>{run.contact_id ? names.get(run.contact_id) || shortId(run.contact_id) : "—"}</Td>
                <Td mono muted>
                  {run.finished_at ? "—" : (run.current_step_id ?? "—")}
                </Td>
                <Td mono muted>
                  {run.finished_at ? formatDateTime(run.finished_at) : "—"}
                </Td>
                <Td className="max-w-[36ch] break-words text-[13px] text-danger">{run.error ?? ""}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      {org.canManage ? (
        <Card>
          <CardHeader
            title="Prova con un evento di test"
            description="Inserisce un evento come se fosse arrivato da un collegamento."
          />
          <ActionForm action={sendTestEvent.bind(null, flow.id)} className="grid gap-4">
            {flow.status === "active" ? (
              <Notice tone="warning">
                Il flusso è attivo: se l'evento corrisponde al trigger parte un'esecuzione vera e i messaggi
                vengono inviati davvero. Per provare senza inviare usa la scheda «Simulazione».
              </Notice>
            ) : (
              <Notice tone="neutral">
                Il flusso non è attivo: l'evento viene registrato ma non fa partire esecuzioni. La simulazione
                lo userà come evento compatibile.
              </Notice>
            )}
            <Field label="Tipo di evento" htmlFor="type" name="type">
              <Select id="type" name="type" defaultValue={types[types.length - 1]}>
                {types.map((type) => (
                  <option key={type} value={type}>
                    {eventTitle(type)} ({type})
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Contenuto dell'evento (JSON)"
              htmlFor="payload"
              name="payload"
              hint={`I dati che il flusso legge con {{event.payload…}}. Usa dati di prova, non quelli di un cliente vero.${
                types.some(isInboundMessageEvent)
                  ? ' Per un messaggio in arrivo serve "from" (il mittente).'
                  : ""
              }${types.some((type) => testEventMode(type) === "simulation") ? ` ${INBOUND_TEST_EVENT_NOTE}` : ""}`}
            >
              <Textarea
                id="payload"
                name="payload"
                rows={7}
                spellCheck={false}
                className="font-mono text-[12.5px]"
                defaultValue={JSON.stringify(sampleEventPayload(types[types.length - 1]), null, 2)}
              />
            </Field>
            <div>
              <SubmitButton variant="secondary" pendingLabel="Invio…">
                Inserisci l'evento di prova
              </SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
