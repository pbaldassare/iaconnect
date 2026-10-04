import { READ_ONLY_NOTE, SettingsNav } from "@/components/settings/settings-nav";
import { StatusPill } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/action";
import { CHANNEL_KEYS, channelLabel, isChannel, templateApprovalStatus } from "@/lib/customer-labels";
import { formatDate } from "@/lib/format";
import { messagePreview } from "@/lib/inbox/filters";
import { variableCount } from "@/lib/message-templates";
import { firstParam, withParams } from "@/lib/pagination";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Modelli di messaggio" };

const PATH = "/app/impostazioni/modelli";

export default async function TemplatesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, org } = await requireOrg();
  const wanted = firstParam((await searchParams).canale);
  const channel = isChannel(wanted) ? wanted : "whatsapp";
  const { data, error } = await supabase
    .from("message_templates")
    .select("id, channel, name, language, body, approval_status, external_name, updated_at")
    .eq("organization_id", org.organization.id)
    .order("name")
    .limit(500);
  const all = data ?? [];
  const templates = all.filter((template) => template.channel === channel);

  return (
    <>
      <PageHeader
        title="Modelli di messaggio"
        back={{ href: "/app/impostazioni", label: "Impostazioni" }}
        description="Testi pronti con valori da riempire. Li usano i flussi e chi risponde dall'inbox."
        actions={
          org.canManage ? (
            <ButtonLink href={withParams(`${PATH}/nuovo`, { canale: channel })} icon="plus">
              Nuovo modello
            </ButtonLink>
          ) : undefined
        }
      />
      <SettingsNav current="modelli" />
      {!org.canManage ? (
        <Notice tone="neutral" className="mb-4">
          {READ_ONLY_NOTE}
        </Notice>
      ) : null}
      <Tabs
        label="Canale"
        className="mb-4"
        items={CHANNEL_KEYS.map((key) => ({
          href: withParams(PATH, { canale: key === "whatsapp" ? null : key }),
          label: channelLabel(key),
          current: key === channel,
          count: all.filter((template) => template.channel === key).length,
        }))}
      />
      {channel === "whatsapp" ? (
        <Notice tone="neutral" className="mb-4" title="WhatsApp: serve l'approvazione di Meta">
          Fuori dalle 24 ore dall'ultimo messaggio del contatto WhatsApp accetta solo modelli approvati da
          Meta. L'approvazione si chiede nel tuo account WhatsApp Business; qui registri il nome del modello
          su Meta e il suo stato.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" announce="alert">
          {errorMessage(error)}
        </Notice>
      ) : templates.length === 0 ? (
        <EmptyState
          title={`Nessun modello per ${channelLabel(channel)}`}
          description="Un modello è un messaggio che invii spesso: un promemoria, una conferma, un primo contatto. Lo scrivi una volta e poi riempi solo i valori che cambiano."
          action={
            org.canManage ? (
              <ButtonLink href={withParams(`${PATH}/nuovo`, { canale: channel })} icon="plus">
                Nuovo modello
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <Table caption={`Modelli per ${channelLabel(channel)}`} minWidth={640}>
          <thead>
            <tr>
              <Th>Nome</Th>
              <Th>Testo</Th>
              <Th align="right">Valori</Th>
              {channel === "whatsapp" ? <Th>Stato</Th> : null}
              <Th>Modificato</Th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <tr key={template.id}>
                <Td>
                  <Link href={`${PATH}/${template.id}`} className="font-semibold underline">
                    {template.name}
                  </Link>
                  <span className="block font-mono text-[12px] text-muted">
                    {template.language}
                    {template.external_name ? ` · ${template.external_name}` : ""}
                  </span>
                </Td>
                <Td muted>{messagePreview(template.body, 90)}</Td>
                <Td align="right" mono>
                  {variableCount(template.body)}
                </Td>
                {channel === "whatsapp" ? (
                  <Td>
                    <StatusPill {...templateApprovalStatus(template.approval_status)} />
                  </Td>
                ) : null}
                <Td mono muted>
                  {formatDate(template.updated_at)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
