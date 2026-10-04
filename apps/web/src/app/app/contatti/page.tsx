import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/form-message";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Table, Td, Th } from "@/components/ui/table";
import { errorMessage } from "@/lib/action";
import { hasConsent, parseConsents } from "@/lib/contacts/consents";
import { contactSearchFilter } from "@/lib/contacts/fields";
import { CHANNEL_KEYS, channelLabel } from "@/lib/customer-labels";
import { formatDate, formatPhone } from "@/lib/format";
import { firstParam, pageWindow, parsePage, withParams } from "@/lib/pagination";
import { requireOrg } from "@/lib/session";
import { normalizePhone } from "@ia-connect/core";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Contatti" };

const PAGE_SIZE = 25;
const PATH = "/app/contatti";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, org } = await requireOrg();
  const organizationId = org.organization.id;
  const params = await searchParams;
  const search = firstParam(params.q).trim().slice(0, 80);
  const page = parsePage(params.pagina);
  const { from, to } = pageWindow(page, PAGE_SIZE);

  let query = supabase
    .from("contacts")
    .select("id, full_name, phones, emails, consents, created_at", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);
  const filter = contactSearchFilter(search, (raw) => normalizePhone(raw));
  if (filter) query = query.or(filter);
  const { data, count, error } = await query;
  const contacts = data ?? [];

  // Open deals per contact of this page: two reads and a Map (the generated types have no relations).
  const openDeals = new Map<string, number>();
  if (contacts.length > 0) {
    const [stages, deals] = await Promise.all([
      supabase.from("deal_stages").select("id, kind").eq("organization_id", organizationId),
      supabase
        .from("deals")
        .select("contact_id, stage_id")
        .eq("organization_id", organizationId)
        .in(
          "contact_id",
          contacts.map((c) => c.id),
        )
        .limit(1000),
    ]);
    const open = new Set((stages.data ?? []).filter((s) => s.kind === "open").map((s) => s.id));
    for (const deal of deals.data ?? []) {
      if (open.has(deal.stage_id)) openDeals.set(deal.contact_id, (openDeals.get(deal.contact_id) ?? 0) + 1);
    }
  }

  return (
    <>
      <PageHeader
        title="Contatti"
        description="Le persone con cui la tua azienda parla: recapiti, consensi per canale e trattative."
        actions={
          <ButtonLink href={`${PATH}/nuovo`} icon="plus">
            Nuovo contatto
          </ButtonLink>
        }
      />
      {firstParam(params.eliminato) === "1" ? (
        <Notice tone="ok" announce="status" className="mb-4">
          Contatto eliminato con le sue conversazioni, i messaggi e le trattative.
        </Notice>
      ) : null}
      <form action={PATH} method="get" className="mb-4 flex flex-wrap gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="contacts-q" className="sr-only">
            Cerca tra i contatti
          </label>
          <Input
            id="contacts-q"
            name="q"
            type="search"
            defaultValue={search}
            placeholder="Nome, telefono completo o mail completa"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold hover:bg-surface-2"
        >
          <Icon name="search" className="size-4" />
          Cerca
        </button>
        {search ? (
          <ButtonLink href={PATH} variant="ghost">
            Togli la ricerca
          </ButtonLink>
        ) : null}
      </form>
      {error ? (
        <Notice tone="error" announce="alert">
          {errorMessage(error)}
        </Notice>
      ) : contacts.length === 0 ? (
        search ? (
          <EmptyState
            title="Nessun contatto trovato"
            description="Il nome si cerca anche per una parte; telefono e mail vanno scritti per intero."
          />
        ) : (
          <EmptyState
            icon="people"
            title="Nessun contatto"
            description="I contatti si creano da soli quando qualcuno scrive su un canale collegato o quando un flusso ne registra uno. Puoi anche aggiungerli a mano."
            action={
              <ButtonLink href={`${PATH}/nuovo`} icon="plus">
                Nuovo contatto
              </ButtonLink>
            }
          />
        )
      ) : (
        <>
          <Table caption="Contatti" minWidth={720}>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Recapiti</Th>
                <Th>Consensi</Th>
                <Th align="right">Trattative aperte</Th>
                <Th>Creato</Th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => {
                const consents = parseConsents(contact.consents);
                const granted = CHANNEL_KEYS.filter((channel) => hasConsent(consents, channel));
                return (
                  <tr key={contact.id}>
                    <Td>
                      <Link href={`${PATH}/${contact.id}`} className="font-semibold underline">
                        {contact.full_name.trim() || "Senza nome"}
                      </Link>
                    </Td>
                    <Td muted>
                      <span className="block break-all">
                        {contact.phones[0] ? formatPhone(contact.phones[0]) : "—"}
                      </span>
                      {contact.emails[0] ? (
                        <span className="block break-all">{contact.emails[0]}</span>
                      ) : null}
                    </Td>
                    <Td>
                      {granted.length === 0 ? (
                        <span className="text-muted">Nessuno</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {granted.map((channel) => (
                            <Badge key={channel} tone="ok">
                              {channelLabel(channel)}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </Td>
                    <Td align="right" mono>
                      {openDeals.get(contact.id) ?? 0}
                    </Td>
                    <Td mono muted>
                      {formatDate(contact.created_at)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={count ?? 0}
            hrefFor={(p) => withParams(PATH, { q: search, pagina: p })}
          />
        </>
      )}
    </>
  );
}
