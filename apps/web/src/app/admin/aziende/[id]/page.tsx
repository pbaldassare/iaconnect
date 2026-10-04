import { StatusPill } from "@/components/ui/badge";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { INVITE_OUTCOMES, type InviteMailOutcome, inviteOutcomeMessage } from "@/lib/invite-messages";
import { organizationStatus, sectorLabel } from "@/lib/labels";
import { firstParam } from "@/lib/pagination";
import { requireStaffForOrg } from "@/lib/session";
import type { Metadata } from "next";
import {
  ConnectionsSection,
  DataSection,
  FeaturesSection,
  FlowsSection,
  SettingsSection,
  SupportSection,
  UsageSection,
  UsersSection,
} from "./sections";

export const metadata: Metadata = { title: "Scheda azienda" };

const TABS = [
  { key: "dati", label: "Dati" },
  { key: "utenti", label: "Utenti" },
  { key: "collegamenti", label: "Collegamenti" },
  { key: "flussi", label: "Flussi" },
  { key: "consumi", label: "Consumi" },
  { key: "funzioni", label: "Funzioni" },
  { key: "personalizzazioni", label: "Personalizzazioni" },
  { key: "assistenza", label: "Assistenza e dati" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function OrganizationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const context = await requireStaffForOrg(id);
  const { organization } = context;
  const query = await searchParams;
  const requested = firstParam(query.scheda);
  const tab: TabKey = TABS.find((t) => t.key === requested)?.key ?? "dati";
  const base = `/admin/aziende/${organization.id}`;
  const created = firstParam(query.creata) === "1";
  const inviteParam = firstParam(query.invito);
  const invite = INVITE_OUTCOMES.includes(inviteParam as InviteMailOutcome)
    ? inviteOutcomeMessage(inviteParam as InviteMailOutcome, "il titolare")
    : null;

  return (
    <>
      <PageHeader
        context={sectorLabel(organization.sector)}
        title={organization.name}
        back={{ href: "/admin/aziende", label: "Aziende" }}
        actions={<StatusPill {...organizationStatus(organization.status)} />}
      />
      {created ? (
        <Notice tone="ok" announce="status" title="Azienda creata" className="mb-4">
          {invite
            ? invite.text
            : inviteParam === "error"
              ? "L'invito al titolare non è stato registrato: riprova dal modulo qui sotto."
              : "Non hai invitato nessuno: puoi farlo dal modulo qui sotto."}
        </Notice>
      ) : null}
      <Tabs
        label="Sezioni della scheda"
        className="mb-6"
        items={TABS.map((t) => ({
          href: t.key === "dati" ? base : `${base}?scheda=${t.key}`,
          label: t.label,
          current: t.key === tab,
        }))}
      />
      {tab === "dati" ? <DataSection {...context} /> : null}
      {tab === "utenti" ? <UsersSection {...context} /> : null}
      {tab === "collegamenti" ? <ConnectionsSection {...context} /> : null}
      {tab === "flussi" ? <FlowsSection {...context} /> : null}
      {tab === "consumi" ? <UsageSection {...context} /> : null}
      {tab === "funzioni" ? <FeaturesSection {...context} /> : null}
      {tab === "personalizzazioni" ? <SettingsSection {...context} /> : null}
      {tab === "assistenza" ? <SupportSection {...context} /> : null}
    </>
  );
}
