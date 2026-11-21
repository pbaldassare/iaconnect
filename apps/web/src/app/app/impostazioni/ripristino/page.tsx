import { RecoverySheetView } from "@/components/connections/recovery-sheet";
import { SettingsNav } from "@/components/settings/settings-nav";
import { StatusPill } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/form-message";
import { Icon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { errorMessage } from "@/lib/action";
import { formatLinePhone, recoverySettingsView, recoverySheet } from "@/lib/connections/recovery";
import { connectionStatus } from "@/lib/labels";
import { isUuid } from "@/lib/org-selection";
import { firstParam, withParams } from "@/lib/pagination";
import { requireOrgManager } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Ripristino WhatsApp" };

const PATH = "/app/impostazioni/ripristino";

export default async function WhatsAppRecoverySettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, org } = await requireOrgManager();
  const selectedRaw = firstParam((await searchParams).collegamento);
  const selectedId = selectedRaw ? selectedRaw : null;
  if (selectedId && !isUuid(selectedId)) notFound();

  const [connectionsResult, typesResult] = await Promise.all([
    supabase
      .from("connections")
      .select("id, name, status, connector_type, config, external_account_id")
      .eq("organization_id", org.organization.id)
      .order("name"),
    supabase.from("connector_types").select("key, connect_mode"),
  ]);
  const failed = connectionsResult.error ?? typesResult.error ?? null;
  const modes = new Map((typesResult.data ?? []).map((type) => [type.key, type.connect_mode]));
  const candidates = (connectionsResult.data ?? [])
    .map((connection) => ({
      id: connection.id,
      name: connection.name,
      status: connection.status,
      connectorType: connection.connector_type,
      connectMode: modes.get(connection.connector_type) ?? "",
      externalAccountId: connection.external_account_id,
      config: connection.config,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "it"));
  const view = failed ? null : recoverySettingsView(candidates, selectedId);
  if (view?.kind === "missing") notFound();

  return (
    <>
      <PageHeader
        title="Ripristino WhatsApp"
        description="Dati pubblici per ripristinare la sessione WhatsApp sul gateway. La chiave di accesso non è in questa pagina."
        context={view?.kind === "sheet" ? view.connection.name : undefined}
        back={{ href: "/app/impostazioni", label: "Impostazioni" }}
        actions={
          view?.kind === "sheet" && view.total > 1 ? (
            <ButtonLink href={PATH} variant="secondary">
              Tutte le linee
            </ButtonLink>
          ) : undefined
        }
      />
      <SettingsNav current="ripristino" canManage={org.canManage} />
      {failed ? (
        <Notice tone="error" announce="alert">
          {errorMessage(failed)}
        </Notice>
      ) : null}
      {view?.kind === "empty" ? (
        <EmptyState
          icon="plug"
          title="Nessuna linea WhatsApp da ripristinare"
          description="Collega un numero WhatsApp con il codice QR. I dati per il ripristino compaiono qui."
          action={<ButtonLink href="/app/collegamenti">Vai ai collegamenti</ButtonLink>}
        />
      ) : null}
      {view?.kind === "list" ? (
        <ul className="grid max-w-3xl gap-3">
          {view.connections.map((connection) => {
            const facts = recoverySheet({
              externalAccountId: connection.externalAccountId,
              config: connection.config,
            });
            const phone = facts.phone ? formatLinePhone(facts.phone) : null;
            const detail = [phone, facts.lineName].filter(Boolean).join(" · ");
            return (
              <li key={connection.id}>
                <Link
                  href={withParams(PATH, { collegamento: connection.id })}
                  className="flex h-full items-start justify-between gap-3 rounded-panel border border-line bg-surface p-4 hover:border-line-strong hover:bg-surface-2/50"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-[16px] font-bold tracking-tight">
                        {connection.name}
                      </span>
                      <StatusPill {...connectionStatus(connection.status)} />
                    </span>
                    <span className="mt-1 block text-sm text-muted">
                      {detail || "Apri i dati pubblici per il ripristino di questa linea."}
                    </span>
                  </span>
                  <Icon name="chevron-right" className="mt-1 text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      {view?.kind === "sheet" ? (
        <RecoverySheetView
          name={view.connection.name}
          status={view.connection.status}
          sheet={recoverySheet({
            externalAccountId: view.connection.externalAccountId,
            config: view.connection.config,
          })}
        />
      ) : null}
    </>
  );
}
