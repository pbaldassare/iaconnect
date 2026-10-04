import { Badge, StatusPill } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { errorMessage } from "@/lib/action";
import { loadConnectorCatalog } from "@/lib/connections/access";
import { connectModeLabel } from "@/lib/connections/catalog";
import { formatRelative } from "@/lib/format";
import { connectionStatus, connectorCategoryLabel } from "@/lib/labels";
import { firstParam } from "@/lib/pagination";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { ConnectionActions } from "./connection-actions";

export const metadata: Metadata = { title: "Collegamenti" };

const STATUS_RANK: Record<string, number> = { expired: 0, error: 1, active: 2, disconnected: 3 };

const OUTCOMES: Record<string, { tone: "ok" | "error" | "warning"; text: string }> = {
  collegato: { tone: "ok", text: "Collegamento creato e attivo." },
  ricollegato: { tone: "ok", text: "Collegamento aggiornato e di nuovo attivo." },
  annullato: { tone: "warning", text: "Autorizzazione annullata: il collegamento non è stato creato." },
  stato: {
    tone: "error",
    text: "La richiesta di autorizzazione è scaduta o non è partita da questa sessione. Riprova dal catalogo qui sotto.",
  },
  permesso: { tone: "error", text: "Questo collegamento non è disponibile per la tua azienda." },
  configurazione: {
    tone: "error",
    text: "La piattaforma non è ancora configurata per questo collegamento. Contatta l'assistenza.",
  },
  chiave: {
    tone: "error",
    text: "Per creare collegamenti il server ha bisogno della chiave di servizio Supabase (SUPABASE_SERVICE_ROLE_KEY), che non è configurata.",
  },
  errore: { tone: "error", text: "Il collegamento non è riuscito. Riprova tra qualche minuto." },
};

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireOrg();
  const { supabase, org } = context;
  const params = await searchParams;
  const outcome = OUTCOMES[firstParam(params.esito)];

  const [connections, catalog] = await Promise.all([
    supabase
      .from("connections")
      .select("id, name, connector_type, status, last_checked_at, last_error, external_account_id")
      .eq("organization_id", org.organization.id)
      .order("name"),
    loadConnectorCatalog(context),
  ]);
  const types = new Map(catalog.types.map((type) => [type.key, type]));
  const available = new Set(
    catalog.groups.flatMap((group) =>
      group.entries.filter((entry) => entry.availability === "available").map((entry) => entry.key),
    ),
  );
  const rows = [...(connections.data ?? [])].sort(
    (a, b) =>
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || a.name.localeCompare(b.name, "it"),
  );
  const broken = rows.filter((row) => row.status === "expired" || row.status === "error");
  const reconnectHref = (row: { id: string; connector_type: string }) =>
    available.has(row.connector_type)
      ? `/app/collegamenti/nuovo/${row.connector_type}?ricollega=${row.id}`
      : null;

  return (
    <>
      <PageHeader
        title="Collegamenti"
        description="I sistemi collegati alla tua azienda: da qui arrivano gli eventi e partono i messaggi dei flussi."
        actions={
          <ButtonLink href="/app/collegamenti/siti" variant="secondary">
            Siti e portali
          </ButtonLink>
        }
      />
      <div className="grid gap-6">
        {outcome ? (
          <Notice tone={outcome.tone} announce="status">
            {outcome.text}
          </Notice>
        ) : null}
        {connections.error || catalog.error ? (
          <Notice tone="error">{errorMessage(connections.error ?? catalog.error)}</Notice>
        ) : null}

        {broken.length > 0 ? (
          <Notice
            tone="warning"
            title={
              broken.length === 1
                ? "Un collegamento ha bisogno di te"
                : `${broken.length} collegamenti hanno bisogno di te`
            }
          >
            <ul className="mt-1 grid gap-1.5">
              {broken.map((row) => {
                const href = reconnectHref(row);
                return (
                  <li key={row.id}>
                    <strong>{row.name}</strong>:{" "}
                    {row.status === "expired" ? "l'accesso è scaduto" : "non risponde"}. I flussi che lo usano
                    sono fermi. {org.canManage && href ? <Link href={href}>Ricollega</Link> : null}
                  </li>
                );
              })}
            </ul>
          </Notice>
        ) : null}

        <section aria-labelledby="connected-title" className="grid gap-3">
          <h2 id="connected-title" className="font-display text-[17px] font-bold tracking-tight">
            Collegati
          </h2>
          {rows.length === 0 ? (
            <EmptyState
              icon="plug"
              title="Nessun collegamento"
              description="Qui compaiono la mail, WhatsApp, il gestionale e gli altri sistemi collegati. Comincia dalla mail o da WhatsApp: scegli dal catalogo qui sotto."
            />
          ) : (
            <ul className="grid gap-3">
              {rows.map((row) => {
                const type = types.get(row.connector_type);
                const attention = row.status === "expired" || row.status === "error";
                return (
                  <Card
                    as="li"
                    key={row.id}
                    className={attention ? "border-warn/50" : undefined}
                    aria-label={row.name}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/app/collegamenti/${row.id}`}
                            className="font-semibold underline-offset-2 hover:underline"
                          >
                            {row.name}
                          </Link>
                          <StatusPill {...connectionStatus(row.status)} />
                        </div>
                        <p className="mt-1 text-sm text-muted">
                          {type
                            ? `${type.name} · ${connectorCategoryLabel(type.category)}`
                            : row.connector_type}
                          {" · "}
                          {row.last_checked_at
                            ? `ultimo controllo ${formatRelative(row.last_checked_at)}`
                            : "mai controllato"}
                        </p>
                        {row.last_error && row.status !== "active" ? (
                          <p className="mt-1.5 text-sm text-danger">{row.last_error}</p>
                        ) : null}
                      </div>
                      {org.canManage ? (
                        <ConnectionActions
                          compact
                          connection={row}
                          reconnectHref={reconnectHref(row)}
                          mode={type?.connect_mode ?? ""}
                        />
                      ) : null}
                    </div>
                  </Card>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="catalog-title" className="grid gap-4">
          <div>
            <h2 id="catalog-title" className="font-display text-[17px] font-bold tracking-tight">
              Cosa puoi collegare
            </h2>
            {!org.canManage ? (
              <p className="mt-1 text-sm text-muted">Solo chi gestisce l'azienda può creare collegamenti.</p>
            ) : null}
          </div>
          {catalog.groups.length === 0 && !catalog.error ? (
            <EmptyState
              compact
              title="Catalogo vuoto"
              description="Nessun tipo di collegamento è attivo sulla piattaforma. Contatta l'assistenza."
            />
          ) : null}
          {catalog.groups.map((group) => (
            <Card key={group.category}>
              <CardHeader title={connectorCategoryLabel(group.category)} />
              <ul className="grid gap-3 sm:grid-cols-2">
                {group.entries.map((entry) => (
                  <li
                    key={entry.key}
                    className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2/60 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{entry.name}</p>
                      {entry.availability === "coming" ? <Badge>In arrivo</Badge> : null}
                      {entry.availability === "plan" ? <Badge tone="warning">Non incluso</Badge> : null}
                    </div>
                    <p className="text-sm text-muted">{entry.description}</p>
                    <p className="font-mono text-[11px] uppercase tracking-wide text-muted">
                      {connectModeLabel(entry.connectMode)}
                    </p>
                    <div className="mt-auto pt-1">
                      {entry.availability === "available" && org.canManage ? (
                        <ButtonLink
                          href={`/app/collegamenti/nuovo/${entry.key}`}
                          size="sm"
                          variant="secondary"
                        >
                          Collega
                        </ButtonLink>
                      ) : entry.availability === "plan" ? (
                        <p className="text-[13px] text-muted">
                          Non è compreso nel tuo piano: chiedi all'assistenza di attivarlo.
                        </p>
                      ) : entry.availability === "coming" ? (
                        <p className="text-[13px] text-muted">Sarà disponibile a breve.</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </section>
      </div>
    </>
  );
}
