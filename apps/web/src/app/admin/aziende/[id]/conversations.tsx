import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/form-message";
import { Table, Td, Th } from "@/components/ui/table";
import { errorMessage } from "@/lib/action";
import { formatDateTime } from "@/lib/format";
import { isUuid } from "@/lib/org-selection";
import type { Db } from "@/lib/supabase/types";
import type { Row } from "@ia-connect/core";

const CHANNEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  mail: "Mail",
  sms: "SMS",
  social: "Social",
};
const DELIVERY: Record<string, string> = {
  queued: "In coda",
  sent: "Inviato",
  delivered: "Consegnato",
  read: "Letto",
  failed: "Fallito",
  received: "Ricevuto",
  simulated: "Simulato",
};

/**
 * The same rows the client sees in the Inbox. Staff read them here, one company at a time.
 */
export async function ConversationsSection({
  supabase,
  organization,
  conversationId,
}: {
  supabase: Db;
  organization: Row<"organizations">;
  conversationId?: string;
}) {
  const base = `/admin/aziende/${organization.id}?scheda=conversazioni`;
  const wanted = conversationId && isUuid(conversationId) ? conversationId : null;
  const [list, thread] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, contact_id, channel, status, last_message_at, unread_count, created_at")
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false })
      .limit(50),
    wanted
      ? supabase
          .from("conversations")
          .select("id, contact_id, channel, status")
          .eq("organization_id", organization.id)
          .eq("id", wanted)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (list.error) {
    return (
      <Notice tone="error" announce="alert">
        {errorMessage(list.error)}
      </Notice>
    );
  }
  const rows = list.data ?? [];
  const contactIds = [
    ...new Set([...rows.map((row) => row.contact_id), thread.data?.contact_id].filter(Boolean)),
  ] as string[];
  const contacts = contactIds.length
    ? await supabase.from("contacts").select("id, full_name").in("id", contactIds)
    : { data: [], error: null };
  const contactName = new Map(
    (contacts.data ?? []).map((contact) => [contact.id, contact.full_name || "Senza nome"]),
  );
  const messages = thread.data
    ? await supabase
        .from("messages")
        .select("id, direction, channel, content, delivery_status, created_at")
        .eq("organization_id", organization.id)
        .eq("conversation_id", thread.data.id)
        .order("created_at", { ascending: true })
        .limit(200)
    : null;

  return (
    <div className="grid gap-6">
      {thread.error ? (
        <Notice tone="error" announce="alert">
          {errorMessage(thread.error)}
        </Notice>
      ) : wanted && !thread.data ? (
        <Notice tone="warning" title="Conversazione non trovata">
          Non appartiene a questa azienda, oppure è stata eliminata.
        </Notice>
      ) : null}
      {thread.data ? (
        <section aria-labelledby="filo-titolo">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 id="filo-titolo" className="font-display text-[17px] font-bold tracking-tight">
              {contactName.get(thread.data.contact_id) ?? "Senza nome"} ·{" "}
              {CHANNEL[thread.data.channel] ?? thread.data.channel}
            </h2>
            <ButtonLink href={base} variant="secondary" size="sm">
              Tutte le conversazioni
            </ButtonLink>
          </div>
          {messages?.error ? (
            <Notice tone="error" announce="alert">
              {errorMessage(messages.error)}
            </Notice>
          ) : (messages?.data ?? []).length === 0 ? (
            <EmptyState
              compact
              title="Nessun messaggio"
              description="Questa conversazione non ha ancora messaggi registrati."
            />
          ) : (
            <ol className="grid gap-2">
              {(messages?.data ?? []).map((message) => (
                <li key={message.id} className="rounded-panel border border-line bg-surface px-3 py-2.5">
                  <p className="mb-1 flex flex-wrap gap-x-2 text-[13px] text-muted">
                    <span>{message.direction === "out" ? "In uscita" : "In entrata"}</span>
                    <span>{DELIVERY[message.delivery_status] ?? message.delivery_status}</span>
                    <time dateTime={message.created_at}>{formatDateTime(message.created_at)}</time>
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm">{message.content || "—"}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
      <section aria-labelledby="conversazioni-titolo">
        <h2 id="conversazioni-titolo" className="mb-2 font-display text-[17px] font-bold tracking-tight">
          Conversazioni
        </h2>
        {rows.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="Nessuna conversazione"
            description="Qui compare ciò che IA Connect registra: i messaggi arrivati dal collegamento e gli invii fatti dall'Inbox o da un flusso."
          />
        ) : (
          <Table caption="Conversazioni dell'azienda" minWidth={720}>
            <thead>
              <tr>
                <Th>Contatto</Th>
                <Th>Canale</Th>
                <Th>Stato</Th>
                <Th>Ultimo messaggio</Th>
                <Th align="right">Azioni</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td>
                    {contactName.get(row.contact_id) ?? "Senza nome"}
                    {row.unread_count > 0 ? (
                      <Badge tone="warning" className="ml-2">
                        {row.unread_count} non letti
                      </Badge>
                    ) : null}
                  </Td>
                  <Td>{CHANNEL[row.channel] ?? row.channel}</Td>
                  <Td>{row.status === "closed" ? "Chiusa" : "Aperta"}</Td>
                  <Td mono muted>
                    {row.last_message_at
                      ? formatDateTime(row.last_message_at)
                      : formatDateTime(row.created_at)}
                  </Td>
                  <Td align="right">
                    <ButtonLink href={`${base}&conversazione=${row.id}`} variant="ghost" size="sm">
                      Apri
                    </ButtonLink>
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
