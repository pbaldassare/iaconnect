import { AiBadge, Badge, StatusPill } from "@/components/ui/badge";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { consentRows, parseConsents } from "@/lib/contacts/consents";
import { customFieldRows } from "@/lib/contacts/fields";
import { mergeTimeline } from "@/lib/contacts/timeline";
import {
  appointmentStatus,
  channelLabel,
  conversationStatus,
  dealActorLabel,
  dealEventLabel,
  stageKind,
} from "@/lib/customer-labels";
import { formatDate, formatDateTime, formatMoney, formatPhone, formatRelative } from "@/lib/format";
import { messagePreview } from "@/lib/inbox/filters";
import { isUuid } from "@/lib/org-selection";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteContact, saveMemory, setConsent } from "../actions";

export const metadata: Metadata = { title: "Contatto" };

const TIMELINE_MESSAGES = 100;

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, org } = await requireOrg();
  const organizationId = org.organization.id;
  if (!isUuid(id)) notFound();
  const { data: contact } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!contact) notFound();

  const [conversationsResult, dealsResult, stagesResult, appointmentsResult] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, channel, status, assignee_type, last_message_at, unread_count")
      .eq("organization_id", organizationId)
      .eq("contact_id", contact.id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(50),
    supabase
      .from("deals")
      .select("id, title, stage_id, estimated_value_cents, currency, created_at, closed_at")
      .eq("organization_id", organizationId)
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("deal_stages").select("id, name, kind").eq("organization_id", organizationId),
    supabase
      .from("appointments")
      .select("id, starts_at, title, status, location")
      .eq("organization_id", organizationId)
      .eq("contact_id", contact.id)
      .order("starts_at", { ascending: false })
      .limit(50),
  ]);
  const conversations = conversationsResult.data ?? [];
  const deals = dealsResult.data ?? [];
  const stages = new Map((stagesResult.data ?? []).map((stage) => [stage.id, stage]));
  const dealTitles = new Map(deals.map((deal) => [deal.id, deal.title]));

  const [messagesResult, eventsResult] = await Promise.all([
    conversations.length > 0
      ? supabase
          .from("messages")
          .select("id, created_at, direction, channel, content, ai_generated, conversation_id")
          .eq("organization_id", organizationId)
          .in(
            "conversation_id",
            conversations.map((c) => c.id),
          )
          .order("created_at", { ascending: false })
          .limit(TIMELINE_MESSAGES)
      : Promise.resolve({ data: [] }),
    deals.length > 0
      ? supabase
          .from("deal_events")
          .select("id, created_at, deal_id, type, from_stage_id, to_stage_id, actor_type")
          .eq("organization_id", organizationId)
          .in(
            "deal_id",
            deals.map((d) => d.id),
          )
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] }),
  ]);
  const timeline = mergeTimeline({
    messages: messagesResult.data ?? [],
    dealEvents: eventsResult.data ?? [],
    appointments: appointmentsResult.data ?? [],
  });

  const consents = consentRows(parseConsents(contact.consents));
  const fields = customFieldRows(contact.custom_fields);
  const name = contact.full_name.trim() || "Senza nome";
  const label = "font-mono text-[11px] uppercase tracking-wider text-muted";

  return (
    <>
      <PageHeader
        title={name}
        eyebrow="Contatto"
        back={{ href: "/app/contatti", label: "Contatti" }}
        actions={
          <>
            <ButtonLink href={`/app/contatti/${contact.id}/modifica`} variant="secondary">
              Modifica
            </ButtonLink>
            <ButtonLink href={`/app/trattative/nuova?contatto=${contact.id}`} variant="secondary" icon="plus">
              Nuova trattativa
            </ButtonLink>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card aria-labelledby="dati">
          <CardHeader id="dati" title="Dati" description={`Creato il ${formatDate(contact.created_at)}`} />
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className={label}>Telefoni</dt>
              <dd className="break-words">{contact.phones.map(formatPhone).join(", ") || "—"}</dd>
            </div>
            <div>
              <dt className={label}>Mail</dt>
              <dd className="break-words">{contact.emails.join(", ") || "—"}</dd>
            </div>
            {fields.map((field) => (
              <div key={field.key}>
                <dt className={label}>{field.key}</dt>
                <dd className="break-words">{field.value}</dd>
              </div>
            ))}
          </dl>
          {fields.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted">
              Nessun campo personalizzato. Si aggiungono da «Modifica» (es. zona, budget_max).
            </p>
          ) : null}
        </Card>

        <Card aria-labelledby="consensi">
          <CardHeader
            id="consensi"
            title="Consensi"
            description="Senza consenso valido su un canale, lì non parte nessun messaggio: né dai flussi né dall'inbox."
          />
          <ul className="grid gap-3">
            {consents.map((row) => (
              <li
                key={row.channel}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line pb-3 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {channelLabel(row.channel)}
                    <StatusPill
                      tone={row.state === "granted" ? "ok" : row.state === "revoked" ? "error" : "neutral"}
                      label={
                        row.state === "granted"
                          ? "Consenso dato"
                          : row.state === "revoked"
                            ? "Revocato"
                            : "Non registrato"
                      }
                    />
                  </p>
                  {row.at ? (
                    <p className="mt-0.5 text-[13px] text-muted">
                      {row.state === "revoked" ? "Revocato il " : "Dato il "}
                      {formatDateTime(row.at)}
                      {row.source ? ` · Origine: ${row.source}` : ""}
                    </p>
                  ) : null}
                </div>
                {row.state === "granted" ? (
                  <Dialog
                    triggerLabel="Revoca"
                    triggerSize="sm"
                    title={`Revocare il consenso per ${channelLabel(row.channel)}?`}
                    description="Da questo momento su questo canale non parte più nulla per questo contatto. La revoca resta registrata con data e motivo."
                  >
                    <ActionForm
                      action={setConsent.bind(null, contact.id, row.channel, false)}
                      className="grid gap-4"
                    >
                      <Field
                        label="Motivo o origine della revoca"
                        htmlFor={`revoke-${row.channel}`}
                        name="source"
                        optional
                      >
                        <Input
                          id={`revoke-${row.channel}`}
                          name="source"
                          maxLength={200}
                          placeholder="Es. Lo ha chiesto al telefono"
                        />
                      </Field>
                      <SubmitButton variant="danger">Revoca il consenso</SubmitButton>
                    </ActionForm>
                  </Dialog>
                ) : (
                  <Dialog
                    triggerLabel="Registra consenso"
                    triggerSize="sm"
                    title={`Consenso per ${channelLabel(row.channel)}`}
                    description="Registralo solo se il contatto lo ha dato davvero: la data di oggi e l'origine restano nella sua scheda."
                  >
                    <ActionForm
                      action={setConsent.bind(null, contact.id, row.channel, true)}
                      className="grid gap-4"
                    >
                      <Field
                        label="Da dove viene il consenso"
                        htmlFor={`grant-${row.channel}`}
                        name="source"
                        hint="Per esempio: Modulo firmato in agenzia, Modulo del sito, Richiesta via mail."
                      >
                        <Input
                          id={`grant-${row.channel}`}
                          name="source"
                          maxLength={200}
                          required
                          minLength={3}
                        />
                      </Field>
                      <SubmitButton>Registra il consenso</SubmitButton>
                    </ActionForm>
                  </Dialog>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card aria-labelledby="memoria">
          <CardHeader
            id="memoria"
            title={
              <span className="flex flex-wrap items-center gap-2">
                Memoria <AiBadge>Letta dall'IA</AiBadge>
              </span>
            }
            description="Note che la piattaforma conserva su questo contatto e passa all'IA quando risponde. Scrivi solo ciò che serve davvero."
          />
          <ActionForm action={saveMemory.bind(null, contact.id)} className="grid gap-3">
            <Field label="Note" htmlFor="memory" name="memory" optional>
              <Textarea id="memory" name="memory" rows={5} defaultValue={contact.memory} maxLength={4000} />
            </Field>
            <div>
              <SubmitButton variant="secondary">Salva la memoria</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card aria-labelledby="trattative">
          <CardHeader id="trattative" title="Trattative" />
          {deals.length === 0 ? (
            <p className="text-sm text-muted">Nessuna trattativa per questo contatto.</p>
          ) : (
            <ul className="grid gap-2.5 text-sm">
              {deals.map((deal) => {
                const stage = stages.get(deal.stage_id);
                return (
                  <li key={deal.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0">
                      <Link href={`/app/trattative/${deal.id}`} className="font-semibold underline">
                        {deal.title}
                      </Link>
                      <span className="ml-2 text-muted">{stage?.name ?? "—"}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {stage && stage.kind !== "open" ? <StatusPill {...stageKind(stage.kind)} /> : null}
                      <span className="font-mono text-[13px] tabular-nums">
                        {formatMoney(deal.estimated_value_cents, deal.currency)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <h3 className="mb-2 mt-5 font-display text-[15px] font-bold">Conversazioni</h3>
          {conversations.length === 0 ? (
            <p className="text-sm text-muted">Nessuna conversazione.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {conversations.map((conversation) => (
                <li key={conversation.id} className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/app/inbox/${conversation.id}`} className="font-semibold underline">
                    {channelLabel(conversation.channel)}
                  </Link>
                  <span className="flex flex-wrap items-center gap-2 text-muted">
                    <StatusPill {...conversationStatus(conversation.status)} />
                    {conversation.assignee_type === "user" ? "In carico a una persona" : "Automazione"}
                    {conversation.last_message_at ? ` · ${formatRelative(conversation.last_message_at)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2" aria-labelledby="storia">
          <CardHeader
            id="storia"
            title="Storia"
            description="Messaggi, passaggi delle trattative e appuntamenti, dal più recente."
          />
          {timeline.length === 0 ? (
            <p className="text-sm text-muted">Ancora nulla da mostrare.</p>
          ) : (
            <ol className="grid gap-3">
              {timeline.map((item) => (
                <li
                  key={`${item.kind}-${item.id}`}
                  className="grid gap-0.5 border-l-2 border-line pl-3 text-sm"
                >
                  <p className="flex flex-wrap items-center gap-2 font-mono text-[12px] text-muted">
                    {formatDateTime(item.at)}
                    {item.kind === "message" ? (
                      <>
                        <Badge>{channelLabel(item.channel)}</Badge>
                        {item.aiGenerated ? <AiBadge /> : null}
                      </>
                    ) : item.kind === "deal_event" ? (
                      <Badge>Trattativa</Badge>
                    ) : (
                      <Badge>Appuntamento</Badge>
                    )}
                  </p>
                  {item.kind === "message" ? (
                    <p className="break-words">
                      <span className="font-semibold">
                        {item.direction === "in" ? "Ha scritto: " : "Inviato: "}
                      </span>
                      <Link href={`/app/inbox/${item.conversationId}`} className="hover:underline">
                        {messagePreview(item.content, 220) || "(senza testo)"}
                      </Link>
                    </p>
                  ) : item.kind === "deal_event" ? (
                    <p className="break-words">
                      <span className="font-semibold">{dealEventLabel(item.type)}</span>
                      {" — "}
                      <Link href={`/app/trattative/${item.dealId}`} className="underline">
                        {dealTitles.get(item.dealId) ?? "trattativa"}
                      </Link>
                      {item.type === "stage_changed"
                        ? `: da «${stages.get(item.fromStageId ?? "")?.name ?? "—"}» a «${stages.get(item.toStageId ?? "")?.name ?? "—"}»`
                        : ""}
                      <span className="text-muted"> · {dealActorLabel(item.actorType)}</span>
                    </p>
                  ) : (
                    <p className="break-words">
                      <span className="font-semibold">{item.title}</span>
                      {item.location ? ` · ${item.location}` : ""}
                      <span className="text-muted"> · {appointmentStatus(item.status).label}</span>
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
          {(messagesResult.data ?? []).length === TIMELINE_MESSAGES ? (
            <p className="mt-3 text-[13px] text-muted">
              Dei messaggi sono mostrati gli ultimi {TIMELINE_MESSAGES}: lo storico completo è
              nell'esportazione.
            </p>
          ) : null}
        </Card>

        <Card className="lg:col-span-2" aria-labelledby="privacy">
          <CardHeader
            id="privacy"
            title="Dati personali"
            description="Per rispondere a una richiesta del contatto: una copia di tutti i suoi dati, oppure la cancellazione."
          />
          <div className="flex flex-wrap gap-2">
            <a href={`/app/contatti/${contact.id}/export`} className={buttonClass("secondary")} download>
              Esporta dati (JSON)
            </a>
            <Dialog
              triggerLabel="Elimina contatto"
              triggerVariant="danger"
              triggerIcon="trash"
              title={`Eliminare ${name}?`}
              description="Vengono cancellati per sempre il contatto, le sue conversazioni con tutti i messaggi, le trattative e gli appuntamenti. Non si può annullare."
            >
              <ActionForm action={deleteContact.bind(null, contact.id)} className="grid gap-4">
                <Notice tone="warning">Se ti serve una copia, esporta i dati prima di eliminare.</Notice>
                <Field label="Per confermare scrivi ELIMINA" htmlFor="confirm" name="confirm">
                  <Input id="confirm" name="confirm" autoComplete="off" required />
                </Field>
                <SubmitButton variant="danger">Elimina per sempre</SubmitButton>
              </ActionForm>
            </Dialog>
          </div>
        </Card>
      </div>
    </>
  );
}
