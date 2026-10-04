import { Badge, StatusPill } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { UsageMeters } from "@/components/usage-meters";
import { errorMessage } from "@/lib/action";
import { parseBrand } from "@/lib/brand";
import { KNOWN_FEATURES, isFeatureEnabled } from "@/lib/features";
import { formatDate, formatDateTime, formatMoney, formatMonth, formatRelative, shortId } from "@/lib/format";
import { connectionStatus, flowStatus, invitationStatus, roleLabel, sectorLabel } from "@/lib/labels";
import type { Session } from "@/lib/session";
import { hasServiceKey } from "@/lib/supabase/service";
import type { Db } from "@/lib/supabase/types";
import { buildUsage, parsePlanLimits, usagePeriod } from "@/lib/usage";
import { resolveUserEmails } from "@/lib/users";
import { type Row, SECTORS } from "@ia-connect/core";
import {
  deleteOrganization,
  inviteMember,
  markConnectionDisconnected,
  removeMember,
  revokeInvitation,
  saveFeatures,
  saveSettings,
  setOrganizationStatus,
  startSupportSession,
  updateOrganization,
} from "./actions";

interface SectionProps {
  supabase: Db;
  session: Session;
  organization: Row<"organizations">;
}

function LoadError({ error }: { error: unknown }) {
  return (
    <Notice tone="error" announce="alert">
      {errorMessage(error)}
    </Notice>
  );
}

// ── Dati ───────────────────────────────────────────────────────────────

export async function DataSection({ supabase, organization }: SectionProps) {
  const [plans, reseller] = await Promise.all([
    supabase.from("plans").select("id, name, price_monthly_cents, is_active").order("price_monthly_cents"),
    supabase.from("resellers").select("name").eq("id", organization.reseller_id).maybeSingle(),
  ]);
  const planRows = (plans.data ?? []).filter((p) => p.is_active || p.id === organization.plan_id);
  const suspended = organization.status === "suspended";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader title="Dati dell'azienda" />
        <ActionForm action={updateOrganization.bind(null, organization.id)} className="grid gap-4">
          <Field label="Nome" htmlFor="name" name="name">
            <Input id="name" name="name" defaultValue={organization.name} required maxLength={120} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Settore" htmlFor="sector" name="sector">
              <Select id="sector" name="sector" defaultValue={organization.sector}>
                {SECTORS.map((s) => (
                  <option key={s} value={s}>
                    {sectorLabel(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Piano"
              htmlFor="plan_id"
              name="plan_id"
              hint="I limiti del nuovo piano valgono subito."
            >
              <Select id="plan_id" name="plan_id" defaultValue={organization.plan_id}>
                {planRows.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {formatMoney(p.price_monthly_cents)}/mese
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div>
            <SubmitButton>Salva</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader title="Riepilogo" />
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Rivenditore</dt>
              <dd className="font-medium">{reseller.data?.name ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Creata il</dt>
              <dd className="font-mono text-[13px]">{formatDate(organization.created_at)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Identificativo</dt>
              <dd className="font-mono text-[13px]">{shortId(organization.id)}</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <CardHeader
            title={suspended ? "Azienda sospesa" : "Sospendi l'azienda"}
            description={
              suspended
                ? "Gli utenti dell'azienda non possono entrare. I dati restano dove sono."
                : "Gli utenti non potranno più entrare finché non la riattivi. I dati non vengono toccati."
            }
          />
          <ActionForm action={setOrganizationStatus.bind(null, organization.id)} className="grid gap-3">
            <input type="hidden" name="status" value={suspended ? "active" : "suspended"} />
            <div>
              <SubmitButton variant="secondary">
                {suspended ? "Riattiva l'azienda" : "Sospendi l'azienda"}
              </SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}

// ── Utenti ─────────────────────────────────────────────────────────────

export async function UsersSection({ supabase, organization }: SectionProps) {
  const [members, invitations] = await Promise.all([
    supabase.from("memberships").select("*").eq("organization_id", organization.id).order("created_at"),
    supabase
      .from("invitations")
      .select("*")
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false }),
  ]);
  const memberRows = members.data ?? [];
  const invitationRows = invitations.data ?? [];
  const emails = await resolveUserEmails(memberRows.map((m) => m.user_id));

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title="Invita una persona"
          description="Riceve una mail con il link per entrare. Il titolare gestisce utenti, collegamenti e flussi; il collaboratore usa inbox e trattative."
        />
        <ActionForm
          action={inviteMember.bind(null, organization.id)}
          className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_200px_auto]"
        >
          <Field label="Mail" htmlFor="invite-email" name="email">
            <Input
              id="invite-email"
              name="email"
              type="email"
              required
              autoComplete="off"
              inputMode="email"
            />
          </Field>
          <Field label="Ruolo" htmlFor="invite-role" name="role">
            <Select id="invite-role" name="role" defaultValue="org_owner">
              <option value="org_owner">{roleLabel("org_owner")}</option>
              <option value="org_member">{roleLabel("org_member")}</option>
            </Select>
          </Field>
          <div className="sm:pt-[26px]">
            <SubmitButton icon="mail">Invita</SubmitButton>
          </div>
        </ActionForm>
        {hasServiceKey() ? null : (
          <Notice tone="warning" className="mt-3">
            Su questo server manca SUPABASE_SERVICE_ROLE_KEY: l'invito viene registrato ma la mail non parte,
            e qui sotto gli utenti compaiono senza indirizzo.
          </Notice>
        )}
      </Card>

      <section aria-labelledby="utenti-titolo">
        <h2 id="utenti-titolo" className="mb-2 font-display text-[17px] font-bold tracking-tight">
          Utenti
        </h2>
        {members.error ? (
          <LoadError error={members.error} />
        ) : memberRows.length === 0 ? (
          <EmptyState
            compact
            icon="people"
            title="Nessun utente"
            description="Finché nessuno accetta un invito, l'azienda non ha utenti. Invita il titolare qui sopra."
          />
        ) : (
          <Table caption="Utenti dell'azienda" minWidth={600}>
            <thead>
              <tr>
                <Th>Utente</Th>
                <Th>Ruolo</Th>
                <Th>Dal</Th>
                <Th align="right">Azioni</Th>
              </tr>
            </thead>
            <tbody>
              {memberRows.map((m) => (
                <tr key={m.id}>
                  <Td>
                    {emails.get(m.user_id) ?? (
                      <span className="font-mono text-[13px]">{shortId(m.user_id)}</span>
                    )}
                  </Td>
                  <Td>{roleLabel(m.role)}</Td>
                  <Td mono muted>
                    {formatDate(m.created_at)}
                  </Td>
                  <Td align="right">
                    <ActionForm
                      action={removeMember.bind(null, organization.id)}
                      className="grid justify-items-end gap-2"
                    >
                      <input type="hidden" name="membership_id" value={m.id} />
                      <SubmitButton variant="ghost" size="sm">
                        Togli dall'azienda
                      </SubmitButton>
                    </ActionForm>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="inviti-titolo">
        <h2 id="inviti-titolo" className="mb-2 font-display text-[17px] font-bold tracking-tight">
          Inviti
        </h2>
        {invitations.error ? (
          <LoadError error={invitations.error} />
        ) : invitationRows.length === 0 ? (
          <EmptyState
            compact
            title="Nessun invito"
            description="Gli inviti che mandi compaiono qui con il loro stato."
          />
        ) : (
          <Table caption="Inviti" minWidth={640}>
            <thead>
              <tr>
                <Th>Mail</Th>
                <Th>Ruolo</Th>
                <Th>Stato</Th>
                <Th>Inviato</Th>
                <Th align="right">Azioni</Th>
              </tr>
            </thead>
            <tbody>
              {invitationRows.map((i) => (
                <tr key={i.id}>
                  <Td>{i.email}</Td>
                  <Td>{roleLabel(i.role)}</Td>
                  <Td>
                    <StatusPill {...invitationStatus(i.status)} />
                  </Td>
                  <Td mono muted>
                    {formatDate(i.created_at)}
                  </Td>
                  <Td align="right">
                    {i.status === "pending" ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <ActionForm
                          action={inviteMember.bind(null, organization.id)}
                          className="grid justify-items-end gap-2"
                        >
                          <input type="hidden" name="email" value={i.email} />
                          <input type="hidden" name="role" value={i.role} />
                          <SubmitButton variant="ghost" size="sm">
                            Invia di nuovo
                          </SubmitButton>
                        </ActionForm>
                        <ActionForm
                          action={revokeInvitation.bind(null, organization.id)}
                          className="grid justify-items-end gap-2"
                        >
                          <input type="hidden" name="invitation_id" value={i.id} />
                          <SubmitButton variant="ghost" size="sm">
                            Revoca
                          </SubmitButton>
                        </ActionForm>
                      </div>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}

// ── Collegamenti ───────────────────────────────────────────────────────

export async function ConnectionsSection({ supabase, organization }: SectionProps) {
  const [connections, types] = await Promise.all([
    supabase
      .from("connections")
      .select("id, name, connector_type, status, last_error, last_checked_at, created_at")
      .eq("organization_id", organization.id)
      .order("name"),
    supabase.from("connector_types").select("key, name"),
  ]);
  if (connections.error) return <LoadError error={connections.error} />;
  const rows = connections.data ?? [];
  const typeNames = new Map((types.data ?? []).map((t) => [t.key, t.name]));
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="plug"
        title="Nessun collegamento"
        description="L'azienda non ha ancora collegato nessun sistema. I collegamenti si creano dall'area cliente: entra in assistenza per farlo insieme al cliente."
        action={
          <ButtonLink href={`/admin/aziende/${organization.id}?scheda=assistenza`} variant="secondary">
            Vai all'accesso in assistenza
          </ButtonLink>
        }
      />
    );
  }
  return (
    <>
      <p className="mb-3 max-w-[70ch] text-sm text-muted">
        Qui i collegamenti si consultano. Per crearli o rinnovarli entra in assistenza. «Segna come
        scollegato» ferma subito i flussi che usano quel collegamento.
      </p>
      <Table caption="Collegamenti dell'azienda" minWidth={780}>
        <thead>
          <tr>
            <Th>Nome</Th>
            <Th>Tipo</Th>
            <Th>Stato</Th>
            <Th>Ultimo controllo</Th>
            <Th>Ultimo errore</Th>
            <Th align="right">Azioni</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <Td className="font-medium">{c.name}</Td>
              <Td>{typeNames.get(c.connector_type) ?? c.connector_type}</Td>
              <Td>
                <StatusPill {...connectionStatus(c.status)} />
              </Td>
              <Td mono muted>
                {c.last_checked_at ? formatRelative(c.last_checked_at) : "mai"}
              </Td>
              <Td muted className="max-w-[260px] text-[13px]">
                {c.last_error ?? "—"}
              </Td>
              <Td align="right">
                {c.status === "disconnected" ? null : (
                  <ActionForm
                    action={markConnectionDisconnected.bind(null, organization.id)}
                    className="grid justify-items-end gap-2"
                  >
                    <input type="hidden" name="connection_id" value={c.id} />
                    <SubmitButton variant="ghost" size="sm">
                      Segna come scollegato
                    </SubmitButton>
                  </ActionForm>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

// ── Flussi ─────────────────────────────────────────────────────────────

export async function FlowsSection({ supabase, organization }: SectionProps) {
  const flows = await supabase
    .from("flows")
    .select("id, name, status, trigger_event, template_key, updated_at")
    .eq("organization_id", organization.id)
    .order("name");
  if (flows.error) return <LoadError error={flows.error} />;
  const rows = flows.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="flow"
        title="Nessun flusso"
        description="L'azienda non ha ancora installato flussi. Si installano dall'area cliente, a partire da un modello del suo settore."
      />
    );
  }
  return (
    <Table caption="Flussi dell'azienda" minWidth={680}>
      <thead>
        <tr>
          <Th>Nome</Th>
          <Th>Stato</Th>
          <Th>Parte da</Th>
          <Th>Modello</Th>
          <Th>Ultima modifica</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.id}>
            <Td className="font-medium">{f.name}</Td>
            <Td>
              <StatusPill {...flowStatus(f.status)} />
            </Td>
            <Td mono>{f.trigger_event ?? "—"}</Td>
            <Td mono muted>
              {f.template_key ?? "—"}
            </Td>
            <Td mono muted>
              {formatRelative(f.updated_at)}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// ── Consumi ────────────────────────────────────────────────────────────

export async function UsageSection({ supabase, organization }: SectionProps) {
  const period = usagePeriod();
  const [counters, plan, activeFlows] = await Promise.all([
    supabase
      .from("usage_counters")
      .select("metric, value")
      .eq("organization_id", organization.id)
      .eq("period", period),
    supabase.from("plans").select("name, limits").eq("id", organization.plan_id).maybeSingle(),
    supabase
      .from("flows")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .eq("status", "active"),
  ]);
  if (counters.error) return <LoadError error={counters.error} />;
  const rows = buildUsage(parsePlanLimits(plan.data?.limits), counters.data ?? [], activeFlows.count ?? 0);
  const flowRuns = counters.data?.find((c) => c.metric === "flow_runs")?.value ?? 0;
  return (
    <Card className="max-w-3xl">
      <CardHeader
        title="Consumi del mese"
        description={`${formatMonth(period)} · piano ${plan.data?.name ?? "—"} · ${flowRuns} esecuzioni di flussi`}
        actions={
          <ButtonLink href={`/admin/aziende/${organization.id}`} variant="secondary" size="sm">
            Cambia piano
          </ButtonLink>
        }
      />
      <UsageMeters rows={rows} />
    </Card>
  );
}

// ── Funzioni ───────────────────────────────────────────────────────────

export async function FeaturesSection({ supabase, organization }: SectionProps) {
  const features = await supabase
    .from("org_features")
    .select("feature_key, enabled")
    .eq("organization_id", organization.id);
  if (features.error) return <LoadError error={features.error} />;
  const rows = features.data ?? [];
  return (
    <Card className="max-w-3xl">
      <CardHeader
        title="Funzioni attive"
        description="Accendi o spegni una funzione solo per questa azienda. Dove non tocchi nulla vale l'impostazione di base."
      />
      <ActionForm action={saveFeatures.bind(null, organization.id)} className="grid gap-4">
        <ul className="grid gap-3">
          {KNOWN_FEATURES.map((feature) => (
            <li key={feature.key} className="rounded-lg border border-line p-3">
              <Switch
                name={`feature:${feature.key}`}
                defaultChecked={isFeatureEnabled(rows, feature.key)}
                label={
                  <>
                    {feature.label}{" "}
                    <span className="font-mono text-[11px] font-normal text-muted">
                      {feature.key} · di base {feature.defaultEnabled ? "accesa" : "spenta"}
                    </span>
                  </>
                }
                description={feature.description}
              />
            </li>
          ))}
        </ul>
        <div>
          <SubmitButton>Salva le funzioni</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}

// ── Personalizzazioni ──────────────────────────────────────────────────

export async function SettingsSection({ supabase, organization }: SectionProps) {
  const settings = await supabase
    .from("org_settings")
    .select("*")
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (settings.error) return <LoadError error={settings.error} />;
  const s = settings.data;
  const brand = parseBrand(s?.brand);
  return (
    <ActionForm action={saveSettings.bind(null, organization.id)} className="grid max-w-3xl gap-4">
      <Card>
        <CardHeader
          title="Come parla l'IA"
          description="Valgono per le risposte automatiche ai clienti di questa azienda."
        />
        <div className="grid gap-4">
          <Field
            label="Tono"
            htmlFor="ai_tone"
            name="ai_tone"
            optional
            hint="Esempio: cordiale e diretto, dà del lei, frasi brevi."
          >
            <Input id="ai_tone" name="ai_tone" defaultValue={s?.ai_tone ?? ""} maxLength={300} />
          </Field>
          <Field
            label="Istruzioni per l'IA"
            htmlFor="ai_instructions"
            name="ai_instructions"
            optional
            hint="Cosa deve sapere dell'azienda: orari, servizi, cosa non promettere mai."
          >
            <Textarea
              id="ai_instructions"
              name="ai_instructions"
              rows={6}
              defaultValue={s?.ai_instructions ?? ""}
              maxLength={4000}
            />
          </Field>
          <Field
            label="Risposta fuori ambito"
            htmlFor="out_of_scope_reply"
            name="out_of_scope_reply"
            hint="La frase inviata quando il cliente chiede qualcosa che l'IA non deve trattare."
          >
            <Textarea
              id="out_of_scope_reply"
              name="out_of_scope_reply"
              rows={2}
              defaultValue={s?.out_of_scope_reply ?? ""}
              required
              maxLength={600}
            />
          </Field>
          <Field
            label="Avviso di messaggio automatico"
            htmlFor="ai_disclosure"
            name="ai_disclosure"
            hint="Aggiunto al primo messaggio automatico, perché chi lo riceve sappia che non scrive una persona."
          >
            <Input
              id="ai_disclosure"
              name="ai_disclosure"
              defaultValue={s?.ai_disclosure ?? ""}
              required
              maxLength={200}
            />
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Marchio"
          description="Nome, logo e colore mostrati nell'area cliente. Se lasci vuoto vale il marchio del rivenditore."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome mostrato" htmlFor="brand_name" name="brand_name" optional>
            <Input id="brand_name" name="brand_name" defaultValue={brand.name ?? ""} maxLength={60} />
          </Field>
          <Field label="Colore" htmlFor="brand_accent" name="brand_accent" optional hint="Formato #rrggbb.">
            <Input
              id="brand_accent"
              name="brand_accent"
              defaultValue={brand.accent ?? ""}
              placeholder="#06724f"
              className="font-mono"
            />
          </Field>
          <Field
            label="Indirizzo del logo"
            htmlFor="brand_logo"
            name="brand_logo"
            optional
            hint="Un'immagine quadrata raggiungibile via https."
            className="sm:col-span-2"
          >
            <Input id="brand_logo" name="brand_logo" type="url" defaultValue={brand.logoUrl ?? ""} />
          </Field>
        </div>
      </Card>
      <div>
        <SubmitButton>Salva le personalizzazioni</SubmitButton>
      </div>
    </ActionForm>
  );
}

// ── Assistenza e dati ──────────────────────────────────────────────────

export async function SupportSection({ supabase, session, organization }: SectionProps) {
  const sessions = await supabase
    .from("support_sessions")
    .select("*")
    .eq("organization_id", organization.id)
    .order("started_at", { ascending: false })
    .limit(10);
  const rows = sessions.data ?? [];
  const isMember = session.memberships.some((m) => m.organization_id === organization.id);

  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <CardHeader
          title="Accesso in assistenza"
          description="Entri nell'area cliente e la vedi come la vede l'azienda. L'accesso, il motivo e ogni modifica finiscono nel registro, che il cliente può leggere."
        />
        <ActionForm action={startSupportSession.bind(null, organization.id)} className="grid gap-4">
          {isMember ? (
            <Notice tone="neutral">
              Fai già parte di questa azienda: entri come utente, senza sessione di assistenza.
            </Notice>
          ) : (
            <Field
              label="Motivo dell'accesso"
              htmlFor="reason"
              name="reason"
              hint="Esempio: «Richiesta del titolare: il flusso dei preventivi non parte»."
            >
              <Input id="reason" name="reason" required minLength={5} maxLength={300} autoComplete="off" />
            </Field>
          )}
          <div>
            <SubmitButton icon="shield">Entra nell'azienda</SubmitButton>
          </div>
        </ActionForm>
        {rows.length > 0 ? (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="mb-2 text-sm font-semibold">Ultimi accessi</h3>
            <Table caption="Ultimi accessi in assistenza" minWidth={520} bare>
              <thead>
                <tr>
                  <Th>Inizio</Th>
                  <Th>Fine</Th>
                  <Th>Chi</Th>
                  <Th>Motivo</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td mono className="whitespace-nowrap">
                      {formatDateTime(r.started_at)}
                    </Td>
                    <Td mono className="whitespace-nowrap">
                      {r.ended_at ? formatDateTime(r.ended_at) : <Badge tone="warning">Aperto</Badge>}
                    </Td>
                    <Td mono muted>
                      {r.admin_user_id === session.user.id ? "tu" : shortId(r.admin_user_id)}
                    </Td>
                    <Td>{r.reason || "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Esporta i dati"
          description="Un file JSON con tutto ciò che appartiene all'azienda: contatti, conversazioni, trattative, flussi, collegamenti (senza credenziali). L'esportazione viene registrata."
          actions={
            <a
              href={`/admin/aziende/${organization.id}/export`}
              download
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-2"
            >
              Scarica il JSON
            </a>
          }
          className="mb-0"
        />
      </Card>

      {session.isPlatformAdmin ? (
        <Card>
          <CardHeader
            title="Elimina l'azienda"
            description="Cancella l'azienda e tutti i suoi dati: contatti, conversazioni, trattative, flussi, collegamenti e credenziali. Non si può annullare. Se serve, esporta prima i dati."
            actions={
              <Dialog
                triggerLabel="Elimina l'azienda"
                triggerVariant="danger"
                title={`Eliminare ${organization.name}?`}
                description="Tutti i dati dell'azienda vengono cancellati subito e per sempre. Resta solo il registro delle azioni."
              >
                <ActionForm action={deleteOrganization.bind(null, organization.id)} className="grid gap-4">
                  <Field
                    label={
                      <>
                        Per confermare scrivi <span className="font-mono">{organization.name}</span>
                      </>
                    }
                    htmlFor="confirm"
                    name="confirm"
                  >
                    <Input id="confirm" name="confirm" required autoComplete="off" />
                  </Field>
                  <div>
                    <SubmitButton variant="danger" pendingLabel="Elimino…">
                      Elimina per sempre
                    </SubmitButton>
                  </div>
                </ActionForm>
              </Dialog>
            }
            className="mb-0"
          />
        </Card>
      ) : null}
    </div>
  );
}
