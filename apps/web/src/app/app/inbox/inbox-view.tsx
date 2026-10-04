import { ConsentSummary } from "@/components/contacts/consent-summary";
import { FeatureOff } from "@/components/feature-off";
import { AutoRefresh } from "@/components/inbox/auto-refresh";
import { Composer } from "@/components/inbox/composer";
import { MarkRead } from "@/components/inbox/mark-read";
import { ScrollEnd } from "@/components/inbox/scroll-end";
import { AiBadge, Badge, StatusPill } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Icon } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/action";
import { cn } from "@/lib/cn";
import { hasConsent, parseConsents } from "@/lib/contacts/consents";
import { CHANNEL_KEYS, channelLabel, conversationStatus, deliveryStatus } from "@/lib/customer-labels";
import { featureOn } from "@/lib/feature-gate";
import { formatDateTime, formatMoney, formatPhone, formatRelative } from "@/lib/format";
import {
  INBOX_VIEWS,
  INBOX_VIEW_LABELS,
  filterConversations,
  inboxCounts,
  inboxFilterParams,
  messagePreview,
  parseInboxFilter,
} from "@/lib/inbox/filters";
import { composerMode, whatsappWindow } from "@/lib/inbox/window";
import { isUuid } from "@/lib/org-selection";
import { withParams } from "@/lib/pagination";
import { peopleNames } from "@/lib/people";
import { chunk } from "@/lib/report/fetch";
import { type OrgContext, requireOrg } from "@/lib/session";
import type { Row } from "@ia-connect/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  markConversationRead,
  releaseToAutomation,
  sendMessage,
  setConversationStatus,
  takeOver,
} from "./actions";

const LOAD_LIMIT = 400;
const PAGE_STEP = 40;
const THREAD_LIMIT = 200;

type Params = Record<string, string | string[] | undefined>;
type ContactLite = Pick<Row<"contacts">, "id" | "full_name" | "phones" | "emails">;

function contactName(contact: Pick<ContactLite, "full_name" | "phones" | "emails"> | null | undefined) {
  if (!contact) return "Contatto eliminato";
  return contact.full_name.trim() || contact.phones[0] || contact.emails[0] || "Senza nome";
}

/** List and thread of the inbox. `/app/inbox` renders it without a selection, `/app/inbox/[id]` with one. */
export async function InboxView({ params, selectedId }: { params: Params; selectedId: string | null }) {
  const context = await requireOrg();
  const { supabase, org, session } = context;
  const organizationId = org.organization.id;
  if (!(await featureOn(supabase, organizationId, "inbox"))) return <FeatureOff title="Inbox" />;
  if (selectedId !== null && !isUuid(selectedId)) notFound();

  const filter = parseInboxFilter(params);
  const shown = Math.min(
    Math.max(
      Number.parseInt(String(Array.isArray(params.mostra) ? params.mostra[0] : (params.mostra ?? "")), 10) ||
        PAGE_STEP,
      PAGE_STEP,
    ),
    LOAD_LIMIT,
  );
  const filterParams = inboxFilterParams(filter);
  const listHref = (extra: Record<string, string | number | null> = {}) =>
    withParams("/app/inbox", { ...filterParams, ...extra });
  const threadHref = (id: string) => withParams(`/app/inbox/${id}`, filterParams);

  const [conversationsResult, pendingApprovals] = await Promise.all([
    supabase
      .from("conversations")
      .select(
        "id, contact_id, channel, status, assignee_type, assignee_user_id, last_message_at, unread_count",
      )
      .eq("organization_id", organizationId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(LOAD_LIMIT),
    supabase
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "pending"),
  ]);
  const conversations = conversationsResult.data ?? [];

  const contacts = new Map<string, ContactLite>();
  for (const ids of chunk([...new Set(conversations.map((c) => c.contact_id))])) {
    const { data } = await supabase
      .from("contacts")
      .select("id, full_name, phones, emails")
      .eq("organization_id", organizationId)
      .in("id", ids);
    for (const contact of data ?? []) contacts.set(contact.id, contact);
  }
  const rows = conversations.map((c) => ({ ...c, contact: contacts.get(c.contact_id) ?? null }));
  const counts = inboxCounts(rows);
  const filtered = filterConversations(rows, filter);
  const visible = filtered.slice(0, shown);

  // Last message of each visible conversation, for the preview line.
  const previews = new Map<string, { content: string; direction: string }>();
  if (visible.length > 0) {
    const { data } = await supabase
      .from("messages")
      .select("conversation_id, content, direction, created_at")
      .eq("organization_id", organizationId)
      .in(
        "conversation_id",
        visible.map((c) => c.id),
      )
      .order("created_at", { ascending: false })
      .limit(600);
    for (const message of data ?? []) {
      if (!previews.has(message.conversation_id)) previews.set(message.conversation_id, message);
    }
  }
  const nameOf = await peopleNames(
    visible.map((c) => c.assignee_user_id),
    session.user,
  );

  const approvalsCount = pendingApprovals.count ?? 0;

  return (
    <>
      <AutoRefresh seconds={10} />
      <div className={cn(selectedId ? "sr-only min-[1100px]:not-sr-only" : "")}>
        <PageHeader
          title="Inbox"
          description="Le conversazioni di tutti i canali in un posto solo. Quelle che prendi in carico escono dall'automazione."
          actions={
            approvalsCount > 0 ? (
              <ButtonLink href="/app/approvazioni" variant="secondary" size="sm" icon="check">
                {approvalsCount === 1
                  ? "1 approvazione in attesa"
                  : `${approvalsCount} approvazioni in attesa`}
              </ButtonLink>
            ) : undefined
          }
        />
      </div>
      {conversationsResult.error ? (
        <Notice tone="error" announce="alert" className="mb-4">
          {errorMessage(conversationsResult.error)}
        </Notice>
      ) : null}

      <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,340px)_minmax(0,1fr)] min-[1100px]:items-start">
        <section
          aria-label="Conversazioni"
          className={cn("min-w-0", selectedId ? "hidden min-[1100px]:block" : "")}
        >
          <Tabs
            label="Filtra le conversazioni"
            className="mb-3"
            items={INBOX_VIEWS.map((view) => ({
              href: withParams("/app/inbox", { ...filterParams, vista: view === "tutte" ? null : view }),
              label: INBOX_VIEW_LABELS[view],
              current: filter.view === view,
              count: view === "da-gestire" || view === "non-lette" ? counts[view] : undefined,
            }))}
          />
          <form action="/app/inbox" method="get" className="mb-3 flex flex-wrap gap-2">
            {filter.view !== "tutte" ? <input type="hidden" name="vista" value={filter.view} /> : null}
            <div className="min-w-[13rem] flex-1">
              <label htmlFor="inbox-q" className="sr-only">
                Cerca per nome, telefono o mail
              </label>
              <Input
                id="inbox-q"
                name="q"
                type="search"
                defaultValue={filter.search}
                placeholder="Cerca per nome, telefono o mail"
              />
            </div>
            <div className="min-w-[9.5rem] flex-1 sm:flex-none">
              <label htmlFor="inbox-channel" className="sr-only">
                Canale
              </label>
              <Select id="inbox-channel" name="canale" defaultValue={filter.channel ?? ""}>
                <option value="">Tutti i canali</option>
                {CHANNEL_KEYS.map((channel) => (
                  <option key={channel} value={channel}>
                    {channelLabel(channel)}
                  </option>
                ))}
              </Select>
            </div>
            <button
              type="submit"
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold hover:bg-surface-2"
            >
              <Icon name="search" className="size-4" />
              Cerca
            </button>
          </form>

          {conversations.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="Nessuna conversazione"
              description="Qui arrivano i messaggi di WhatsApp, mail, SMS e social appena un contatto scrive o un flusso invia qualcosa. Per cominciare collega un canale."
              action={
                <ButtonLink href="/app/collegamenti" variant="secondary">
                  Vai ai collegamenti
                </ButtonLink>
              }
            />
          ) : visible.length === 0 ? (
            <EmptyState
              compact
              title="Nessuna conversazione con questi filtri"
              description="Prova a togliere la ricerca o a cambiare vista."
              action={
                <ButtonLink href="/app/inbox" variant="secondary" size="sm">
                  Togli i filtri
                </ButtonLink>
              }
            />
          ) : (
            <ul className="overflow-hidden rounded-panel border border-line bg-surface">
              {visible.map((row) => {
                const preview = previews.get(row.id);
                const current = row.id === selectedId;
                return (
                  <li key={row.id} className="border-b border-line last:border-b-0">
                    <Link
                      href={threadHref(row.id)}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "block px-3 py-2.5 hover:bg-surface-2/60 focus-visible:-outline-offset-2",
                        current && "bg-accent-soft/60",
                      )}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-sm",
                            row.unread_count > 0 ? "font-bold" : "font-semibold",
                          )}
                        >
                          {contactName(row.contact)}
                        </span>
                        <span className="shrink-0 font-mono text-[11.5px] text-muted">
                          {row.last_message_at ? formatRelative(row.last_message_at) : ""}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] text-muted">
                          {preview
                            ? `${preview.direction === "out" ? "Inviato: " : ""}${messagePreview(preview.content, 70) || "(senza testo)"}`
                            : "Nessun messaggio"}
                        </span>
                        {row.unread_count > 0 ? (
                          <span className="shrink-0 rounded-full bg-accent px-1.5 font-mono text-[11px] font-semibold leading-5 text-on-accent">
                            <span className="sr-only">Da leggere: </span>
                            {row.unread_count > 99 ? "99+" : row.unread_count}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge>{channelLabel(row.channel)}</Badge>
                        {row.status === "closed" ? (
                          <Badge>Chiusa</Badge>
                        ) : row.assignee_type === "user" ? (
                          <Badge tone="warning">
                            {/* A mail address is long for a label: the part before @ is enough here. */}
                            {nameOf(row.assignee_user_id).split("@")[0]}
                          </Badge>
                        ) : (
                          <Badge>Automazione</Badge>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {filtered.length > visible.length ? (
            <div className="mt-3">
              <ButtonLink
                href={listHref({ mostra: shown + PAGE_STEP })}
                variant="secondary"
                size="sm"
                scroll={false}
              >
                Mostra altre ({filtered.length - visible.length})
              </ButtonLink>
            </div>
          ) : null}
          {conversations.length >= LOAD_LIMIT ? (
            <p className="mt-3 text-[13px] text-muted">
              Sono elencate le {LOAD_LIMIT} conversazioni più recenti. Le più vecchie si trovano dalla scheda
              del contatto.
            </p>
          ) : null}
        </section>

        <section
          aria-label="Conversazione"
          className={cn("min-w-0", selectedId ? "" : "hidden min-[1100px]:block")}
        >
          {selectedId ? (
            <Thread context={context} conversationId={selectedId} backHref={listHref()} />
          ) : (
            <EmptyState
              icon="inbox"
              title="Scegli una conversazione"
              description="Selezionala dall'elenco per leggere i messaggi, rispondere o prenderla in carico."
            />
          )}
        </section>
      </div>
    </>
  );
}

async function Thread({
  context,
  conversationId,
  backHref,
}: {
  context: OrgContext;
  conversationId: string;
  backHref: string;
}) {
  const { supabase, org, session } = context;
  const organizationId = org.organization.id;
  const { data: conversation, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    return (
      <Notice tone="error" announce="alert">
        {errorMessage(error)}
      </Notice>
    );
  }
  if (!conversation) notFound();

  const [contactResult, messagesResult, templatesResult, stagesResult, dealsResult] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, full_name, phones, emails, consents, memory")
      .eq("id", conversation.contact_id)
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("messages")
      .select(
        "id, direction, content, meta, template_id, ai_generated, delivery_status, sent_by_user_id, flow_run_id, error, created_at",
      )
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false })
      .limit(THREAD_LIMIT),
    supabase
      .from("message_templates")
      .select("id, name, body, subject, approval_status")
      .eq("organization_id", organizationId)
      .eq("channel", conversation.channel)
      .order("name"),
    supabase.from("deal_stages").select("id, name, kind").eq("organization_id", organizationId),
    supabase
      .from("deals")
      .select("id, title, stage_id, estimated_value_cents, currency")
      .eq("organization_id", organizationId)
      .eq("contact_id", conversation.contact_id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const contact = contactResult.data;
  const messages = [...(messagesResult.data ?? [])].reverse();
  const consents = parseConsents(contact?.consents);
  const windowState = whatsappWindow(conversation.channel, conversation.window_expires_at);
  const templateOnly = composerMode(windowState) === "template_only";
  const isWhatsapp = conversation.channel === "whatsapp";
  const templates = (templatesResult.data ?? []).filter(
    (t) => !isWhatsapp || t.approval_status === "approved",
  );
  const stages = new Map((stagesResult.data ?? []).map((stage) => [stage.id, stage]));
  const openDeals = (dealsResult.data ?? []).filter((deal) => stages.get(deal.stage_id)?.kind === "open");
  const nameOf = await peopleNames(
    [conversation.assignee_user_id, ...messages.map((m) => m.sent_by_user_id)],
    session.user,
  );
  const assignedToPerson = conversation.assignee_type === "user";
  const mine = assignedToPerson && conversation.assignee_user_id === session.user.id;
  const status = conversationStatus(conversation.status);

  return (
    <div className="grid gap-4 min-[1480px]:grid-cols-[minmax(0,1fr)_260px] min-[1480px]:items-start">
      <MarkRead
        unread={conversation.unread_count}
        action={markConversationRead.bind(null, conversation.id)}
      />
      <div className="min-w-0 overflow-hidden rounded-panel border border-line bg-surface">
        <header className="border-b border-line p-3 sm:p-4">
          <Link
            href={backHref}
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink min-[1100px]:hidden"
          >
            <Icon name="chevron-left" className="size-4" />
            Tutte le conversazioni
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 className="truncate font-display text-xl font-extrabold leading-tight tracking-tight">
                {contactName(contact)}
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted">
                <Badge>{channelLabel(conversation.channel)}</Badge>
                <StatusPill {...status} />
                <span>
                  {assignedToPerson
                    ? `In carico a: ${nameOf(conversation.assignee_user_id)}`
                    : "Gestita dall'automazione"}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-start gap-2">
              {!mine ? (
                <ActionForm action={takeOver.bind(null, conversation.id)} className="grid gap-2">
                  <SubmitButton size="sm" variant={assignedToPerson ? "secondary" : "primary"}>
                    Prendi in carico
                  </SubmitButton>
                </ActionForm>
              ) : null}
              {assignedToPerson ? (
                <ActionForm action={releaseToAutomation.bind(null, conversation.id)} className="grid gap-2">
                  <SubmitButton size="sm" variant="secondary">
                    Riaffida all'automazione
                  </SubmitButton>
                </ActionForm>
              ) : null}
              <ActionForm
                action={setConversationStatus.bind(
                  null,
                  conversation.id,
                  conversation.status === "open" ? "closed" : "open",
                )}
                className="grid gap-2"
              >
                <SubmitButton size="sm" variant="ghost">
                  {conversation.status === "open" ? "Chiudi" : "Riapri"}
                </SubmitButton>
              </ActionForm>
            </div>
          </div>
        </header>

        {messagesResult.error ? (
          <Notice tone="error" announce="alert" className="m-3">
            {errorMessage(messagesResult.error)}
          </Notice>
        ) : null}
        <div
          className="max-h-[60dvh] min-h-48 overflow-y-auto p-3 sm:p-4"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard
          tabIndex={0}
          role="log"
          aria-label="Messaggi"
        >
          {messages.length === THREAD_LIMIT ? (
            <p className="mb-3 text-center text-[13px] text-muted">
              Sono mostrati gli ultimi {THREAD_LIMIT} messaggi. Lo storico completo è nell'esportazione del
              contatto.
            </p>
          ) : null}
          {messages.length === 0 ? (
            <p className="text-sm text-muted">Nessun messaggio in questa conversazione.</p>
          ) : (
            <ol className="grid gap-3">
              {messages.map((message) => {
                const out = message.direction === "out";
                const delivery = deliveryStatus(message.delivery_status);
                const meta = (
                  typeof message.meta === "object" && message.meta !== null ? message.meta : {}
                ) as Record<string, unknown>;
                const subject = typeof meta.subject === "string" ? meta.subject : null;
                const author = !out
                  ? contactName(contact)
                  : message.sent_by_user_id
                    ? nameOf(message.sent_by_user_id)
                    : "Automazione";
                return (
                  <li key={message.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
                    <div className="max-w-[85%] min-w-0 sm:max-w-[75%]">
                      <div
                        className={cn(
                          "rounded-xl border px-3 py-2 text-sm",
                          !out && "border-line bg-surface-2",
                          out && !message.ai_generated && "border-accent/30 bg-accent-soft",
                          out && message.ai_generated && "border-ai/40 bg-ai-soft",
                        )}
                      >
                        {message.ai_generated || message.template_id ? (
                          <p className="mb-1 flex flex-wrap gap-1.5">
                            {message.ai_generated ? <AiBadge>Scritto dall'IA</AiBadge> : null}
                            {message.template_id ? <Badge>Modello</Badge> : null}
                          </p>
                        ) : null}
                        {subject ? <p className="mb-1 font-semibold">{subject}</p> : null}
                        <p className="whitespace-pre-wrap break-words">
                          {message.content || <span className="text-muted">(senza testo)</span>}
                        </p>
                      </div>
                      <p className={cn("mt-1 text-[12px] text-muted", out ? "text-right" : "text-left")}>
                        <span className="sr-only">{out ? "Inviato da " : "Ricevuto da "}</span>
                        {author} · {formatDateTime(message.created_at)}
                        {out ? (
                          <>
                            {" · "}
                            <span
                              className={
                                message.delivery_status === "failed" ? "font-semibold text-danger" : ""
                              }
                            >
                              {delivery.label}
                            </span>
                          </>
                        ) : null}
                      </p>
                      {out && message.delivery_status === "failed" ? (
                        <p className="mt-0.5 text-right text-[12.5px] text-danger">
                          {message.error || "L'invio non è riuscito. Riprova tra poco."}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <ScrollEnd count={messages.length} />
        </div>

        {contact ? (
          <Composer
            action={sendMessage.bind(null, conversation.id)}
            channel={conversation.channel}
            channelName={channelLabel(conversation.channel)}
            templateOnly={templateOnly}
            windowNote={windowState.note}
            windowOpen={windowState.open}
            consentMissing={!hasConsent(consents, conversation.channel)}
            takesOver={!assignedToPerson}
            templates={templates.map((t) => ({ id: t.id, name: t.name, body: t.body, subject: t.subject }))}
          />
        ) : null}
      </div>

      <aside
        aria-label="Scheda del contatto"
        className="grid gap-4 rounded-panel border border-line bg-surface p-4"
      >
        {contact ? (
          <>
            <div>
              <h2 className="font-display text-[15px] font-bold">Contatto</h2>
              <dl className="mt-2 grid gap-2 text-sm">
                <div>
                  <dt className="font-mono text-[11px] uppercase tracking-wider text-muted">Telefoni</dt>
                  <dd className="break-words">{contact.phones.map(formatPhone).join(", ") || "—"}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[11px] uppercase tracking-wider text-muted">Mail</dt>
                  <dd className="break-words">{contact.emails.join(", ") || "—"}</dd>
                </div>
              </dl>
              <Link
                href={`/app/contatti/${contact.id}`}
                className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent-strong underline"
              >
                Apri la scheda
                <Icon name="chevron-right" className="size-4" />
              </Link>
            </div>
            <div className="border-t border-line pt-3">
              <h2 className="mb-2 font-display text-[15px] font-bold">Consensi</h2>
              <ConsentSummary consents={consents} />
            </div>
            <div className="border-t border-line pt-3">
              <h2 className="mb-1 font-display text-[15px] font-bold">Memoria</h2>
              <p className="whitespace-pre-wrap break-words text-sm text-muted">
                {contact.memory.trim() || "Nessuna nota. La memoria si scrive nella scheda del contatto."}
              </p>
            </div>
            <div className="border-t border-line pt-3">
              <h2 className="mb-2 font-display text-[15px] font-bold">Trattative aperte</h2>
              {openDeals.length === 0 ? (
                <p className="text-sm text-muted">Nessuna.</p>
              ) : (
                <ul className="grid gap-2 text-sm">
                  {openDeals.map((deal) => (
                    <li key={deal.id}>
                      <Link href={`/app/trattative/${deal.id}`} className="font-semibold underline">
                        {deal.title}
                      </Link>
                      <p className="text-[13px] text-muted">
                        {stages.get(deal.stage_id)?.name ?? "—"}
                        {deal.estimated_value_cents !== null
                          ? ` · ${formatMoney(deal.estimated_value_cents, deal.currency)}`
                          : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">Il contatto di questa conversazione non esiste più.</p>
        )}
      </aside>
    </div>
  );
}
