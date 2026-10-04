import { Badge, StatusPill } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/form-message";
import { Icon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { UsageMeters } from "@/components/usage-meters";
import { connectionsNeedingAttention, countByStatus, dealsByStage, onboardingSteps } from "@/lib/dashboard";
import { formatMoney, formatMonth, formatNumber, formatRelative } from "@/lib/format";
import { connectionStatus } from "@/lib/labels";
import { safeNextPath } from "@/lib/routes";
import { requireOrg } from "@/lib/session";
import { buildUsage, parsePlanLimits, usagePeriod } from "@/lib/usage";
import type { Metadata } from "next";
import Link from "next/link";
import { markNotificationsRead } from "./actions";

export const metadata: Metadata = { title: "Inizio" };

const STATUS_ORDER = ["active", "expired", "error", "disconnected"] as const;

export default async function HomePage() {
  const { supabase, org } = await requireOrg();
  const orgId = org.organization.id;
  const period = usagePeriod();

  const [connections, connectorTypes, flows, stages, deals, counters, plan, notifications] =
    await Promise.all([
      supabase
        .from("connections")
        .select("id, name, connector_type, status, last_error, last_checked_at")
        .eq("organization_id", orgId)
        .order("name"),
      supabase.from("connector_types").select("key, name, category"),
      supabase
        .from("flows")
        .select("id, name, status, updated_at")
        .eq("organization_id", orgId)
        .order("updated_at", { ascending: false })
        .limit(200),
      supabase.from("deal_stages").select("id, name, position, kind").eq("organization_id", orgId),
      supabase
        .from("deals")
        .select("stage_id, estimated_value_cents")
        .eq("organization_id", orgId)
        .is("closed_at", null)
        .limit(2000),
      supabase
        .from("usage_counters")
        .select("metric, value")
        .eq("organization_id", orgId)
        .eq("period", period),
      supabase.from("plans").select("name, limits").eq("id", org.organization.plan_id).maybeSingle(),
      supabase
        .from("notifications")
        .select("id, kind, title, body, link, read_at, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

  const loadFailed = [connections, flows, stages, deals, counters, notifications].some((r) => r.error);
  const types = new Map((connectorTypes.data ?? []).map((t) => [t.key, t]));
  const connectionRows = (connections.data ?? []).map((c) => ({
    ...c,
    category: types.get(c.connector_type)?.category ?? null,
    typeName: types.get(c.connector_type)?.name ?? c.connector_type,
  }));
  const flowRows = flows.data ?? [];
  const activeFlows = flowRows.filter((f) => f.status === "active");
  const statusCounts = countByStatus(connectionRows);
  const attention = connectionsNeedingAttention(connectionRows);
  const pipeline = dealsByStage(stages.data ?? [], deals.data ?? []);
  const openDeals = pipeline.reduce((sum, s) => sum + s.count, 0);
  const usage = buildUsage(parsePlanLimits(plan.data?.limits), counters.data ?? [], activeFlows.length);
  const steps = onboardingSteps(connectionRows, flowRows);
  const onboarding = steps.some((s) => !s.done);
  const notificationRows = notifications.data ?? [];
  const hasUnread = notificationRows.some((n) => n.read_at === null);

  return (
    <>
      <PageHeader
        title="Inizio"
        description={`Come sta andando ${org.organization.name}, in questo momento.`}
      />

      {loadFailed ? (
        <Notice tone="error" announce="alert" title="Alcuni dati non si sono caricati" className="mb-4">
          Quello che vedi potrebbe essere incompleto. Ricarica la pagina; se succede ancora, contatta
          l'assistenza.
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {onboarding ? (
          <Card className="lg:col-span-2" aria-labelledby="per-cominciare">
            <CardHeader
              id="per-cominciare"
              title="Per cominciare"
              description="Tre passi e il primo flusso lavora da solo."
            />
            <ol className="grid gap-3 md:grid-cols-3">
              {steps.map((step, index) => (
                <li key={step.key} className="flex gap-3 rounded-lg border border-line p-3">
                  <span
                    className={
                      step.done
                        ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"
                        : "flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-[12px] text-muted"
                    }
                  >
                    {step.done ? <Icon name="check" label="Fatto" className="size-3.5" /> : index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold">{step.title}</p>
                    <p className="text-sm text-muted">{step.description}</p>
                    {step.done ? null : (
                      <Link
                        href={step.href}
                        className="mt-1.5 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
                      >
                        {step.key === "flow" ? "Vai ai flussi" : "Vai ai collegamenti"}
                        <Icon name="chevron-right" className="size-3.5" />
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        ) : null}

        <Card aria-labelledby="stato-collegamenti">
          <CardHeader
            id="stato-collegamenti"
            title="Collegamenti"
            description={
              connectionRows.length === 0
                ? undefined
                : attention.length === 0
                  ? "Tutto in ordine."
                  : attention.length === 1
                    ? "Un collegamento ha bisogno di te."
                    : `${attention.length} collegamenti hanno bisogno di te.`
            }
            actions={
              <ButtonLink href="/app/collegamenti" variant="secondary" size="sm">
                Gestisci
              </ButtonLink>
            }
          />
          {connectionRows.length === 0 ? (
            <EmptyState
              compact
              icon="plug"
              title="Nessun sistema collegato"
              description="Comincia dalla mail e da WhatsApp: sono i due collegamenti da cui partono quasi tutti i flussi."
              action={
                <ButtonLink href="/app/collegamenti" size="sm">
                  Collega la mail
                </ButtonLink>
              }
            />
          ) : (
            <>
              <ul className="flex flex-wrap gap-2">
                {STATUS_ORDER.filter((s) => statusCounts[s]).map((s) => {
                  const info = connectionStatus(s);
                  return (
                    <li key={s}>
                      <StatusPill
                        tone={info.tone}
                        label={`${statusCounts[s]} · ${info.label.toLowerCase()}`}
                      />
                    </li>
                  );
                })}
              </ul>
              {attention.length > 0 ? (
                <ul className="mt-4 grid gap-2">
                  {attention.map((c) => (
                    <li key={c.id} className="rounded-lg border border-line p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">
                          {c.name} <span className="font-normal text-muted">· {c.typeName}</span>
                        </p>
                        <StatusPill {...connectionStatus(c.status)} />
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {c.status === "expired"
                          ? "L'autorizzazione è scaduta: ricollega per far ripartire i flussi che lo usano."
                          : (c.last_error ??
                            "Il collegamento non risponde. Apri i collegamenti per verificarlo.")}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </Card>

        <Card aria-labelledby="flussi-attivi">
          <CardHeader
            id="flussi-attivi"
            title="Flussi attivi"
            description={
              flowRows.length > 0
                ? `${activeFlows.length} ${activeFlows.length === 1 ? "attivo" : "attivi"} su ${flowRows.length}.`
                : undefined
            }
            actions={
              <ButtonLink href="/app/flussi" variant="secondary" size="sm">
                Tutti i flussi
              </ButtonLink>
            }
          />
          {activeFlows.length === 0 ? (
            <EmptyState
              compact
              icon="flow"
              title={flowRows.length === 0 ? "Nessun flusso installato" : "Nessun flusso attivo"}
              description={
                flowRows.length === 0
                  ? "Un flusso è un'automazione: per esempio «arriva una richiesta di preventivo → rispondi su WhatsApp → apri la trattativa». Parti da un modello pronto."
                  : "Hai dei flussi in bozza o in pausa. Provali in simulazione e attivali quando sei pronto."
              }
              action={
                <ButtonLink
                  href="/app/flussi"
                  size="sm"
                  variant={connectionRows.length === 0 ? "secondary" : "primary"}
                >
                  {flowRows.length === 0 ? "Scegli un modello" : "Vai ai flussi"}
                </ButtonLink>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {activeFlows.slice(0, 6).map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <Link href={`/app/flussi/${f.id}`} className="min-w-0 truncate font-medium hover:underline">
                    {f.name}
                  </Link>
                  <span className="shrink-0 font-mono text-[12px] text-muted">
                    modificato {formatRelative(f.updated_at)}
                  </span>
                </li>
              ))}
              {activeFlows.length > 6 ? (
                <li className="pt-2 text-sm text-muted">e altri {activeFlows.length - 6}</li>
              ) : null}
            </ul>
          )}
        </Card>

        <Card aria-labelledby="trattative-aperte">
          <CardHeader
            id="trattative-aperte"
            title="Trattative aperte"
            description={openDeals > 0 ? `${formatNumber(openDeals)} in corso.` : undefined}
            actions={
              <ButtonLink href="/app/trattative" variant="secondary" size="sm">
                Apri le trattative
              </ButtonLink>
            }
          />
          {openDeals === 0 ? (
            <EmptyState
              compact
              icon="deal"
              title="Nessuna trattativa aperta"
              description="Le trattative le aprono i flussi quando arriva una richiesta, oppure le crei tu a mano."
            />
          ) : (
            <ul className="divide-y divide-line">
              {pipeline.map((stage) => (
                <li
                  key={stage.stageId}
                  className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0 truncate font-medium">{stage.name}</span>
                  <span className="flex shrink-0 items-center gap-3">
                    {stage.valueCents > 0 ? (
                      <span className="font-mono text-[13px] text-muted">
                        {formatMoney(stage.valueCents)}
                      </span>
                    ) : null}
                    <Badge>{stage.count}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card aria-labelledby="consumi">
          <CardHeader
            id="consumi"
            title="Consumi del mese"
            description={`${formatMonth(period)}${plan.data ? ` · piano ${plan.data.name}` : ""}`}
          />
          <UsageMeters rows={usage} />
          {usage.some((u) => u.tone === "error" && u.limit !== 0) ? (
            <Notice tone="warning" className="mt-4" title="Hai raggiunto un limite del piano">
              Finché non si rinnova il mese, i flussi si fermano sulle azioni che lo superano. Per alzare il
              limite contatta chi ti segue in IA Connect.
            </Notice>
          ) : null}
        </Card>

        <Card className="scroll-mt-20 lg:col-span-2" id="notifiche" aria-labelledby="ultime-notifiche">
          <CardHeader
            id="ultime-notifiche"
            title="Ultime notifiche"
            actions={
              hasUnread ? (
                <form action={markNotificationsRead}>
                  <Button variant="secondary" size="sm" icon="check">
                    Segna come lette
                  </Button>
                </form>
              ) : null
            }
          />
          {notificationRows.length === 0 ? (
            <EmptyState
              compact
              icon="bell"
              title="Nessuna notifica"
              description="Qui trovi gli avvisi dei flussi: un cliente che chiede di parlare con una persona, un collegamento da rinnovare, un'approvazione che ti aspetta."
            />
          ) : (
            <ul className="divide-y divide-line">
              {notificationRows.map((n) => {
                const href = n.link ? safeNextPath(n.link) : null;
                return (
                  <li key={n.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read_at === null ? "bg-accent" : "bg-line-strong"}`}
                      role="img"
                      aria-label={n.read_at === null ? "Da leggere" : "Letta"}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={n.read_at === null ? "font-semibold" : "font-medium"}>
                        {href && n.link === href ? (
                          <Link href={href} className="hover:underline">
                            {n.title}
                          </Link>
                        ) : (
                          n.title
                        )}
                      </p>
                      {n.body ? <p className="text-sm text-muted">{n.body}</p> : null}
                    </div>
                    <span className="shrink-0 font-mono text-[12px] text-muted">
                      {formatRelative(n.created_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
