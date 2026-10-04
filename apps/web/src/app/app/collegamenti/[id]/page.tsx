import { CopyBlock } from "@/components/connections/copy-button";
import { StatusPill } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { canConnect } from "@/lib/connections/access";
import { availablePages, configSummary, connectModeLabel, webhookExample } from "@/lib/connections/catalog";
import { hasOwnWebhook, webhookUrlOf } from "@/lib/connections/server";
import { formatDateTime, formatRelative } from "@/lib/format";
import { connectionStatus, connectorCategoryLabel } from "@/lib/labels";
import { isUuid } from "@/lib/org-selection";
import { firstParam } from "@/lib/pagination";
import { requireOrg } from "@/lib/session";
import { getConnector } from "@ia-connect/connectors";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConnectionActions } from "../connection-actions";

export const metadata: Metadata = { title: "Collegamento" };

const WEBHOOK_HINTS: Record<string, string> = {
  webhook_inbound:
    "Il tuo sito o gestionale invia qui gli eventi, con una richiesta POST firmata (intestazione x-ia-signature).",
  signature_link: "Il servizio di firma conferma qui l'avvenuta firma, con una richiesta POST firmata.",
  ghl_social:
    "Va inserito nell'azione «Webhook» di un workflow GoHighLevel, insieme al segreto mostrato alla creazione.",
  sms_twilio: "Va impostato sul numero Twilio, alla voce «A message comes in» (metodo POST).",
  payment_stripe: "Lo registriamo noi su Stripe. Se non risulta registrato, usa il pulsante qui sopra.",
  whatsapp_wawebapi: "Lo registriamo noi sul gateway. Se i messaggi non arrivano, registralo di nuovo.",
};

export default async function ConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireOrg();
  const { supabase, org } = context;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;

  const { data: connection } = await supabase
    .from("connections")
    .select("*")
    .eq("id", id)
    .eq("organization_id", org.organization.id)
    .maybeSingle();
  if (!connection) notFound();

  const { data: type } = await supabase
    .from("connector_types")
    .select("key, name, category, connect_mode")
    .eq("key", connection.connector_type)
    .maybeSingle();
  const connector = getConnector(connection.connector_type);
  const allowed = org.canManage && connector ? await canConnect(context, connector.key) : false;
  const mode = connector?.connectMode ?? type?.connect_mode ?? "";
  const reconnectHref = allowed
    ? `/app/collegamenti/nuovo/${connection.connector_type}?ricollega=${connection.id}`
    : null;
  const webhookUrl = org.canManage && connector && hasOwnWebhook(connector) ? webhookUrlOf(connection) : null;
  const summary = configSummary(connection.config);
  const pages = connection.connector_type === "meta_social" ? availablePages(connection.config) : [];
  const currentPage = (connection.config as { pageId?: unknown } | null)?.pageId;
  const outcome = firstParam(query.esito);
  const choosing = firstParam(query.passo) === "pagina";
  const attention = connection.status === "expired" || connection.status === "error";

  return (
    <>
      <PageHeader
        title={connection.name}
        eyebrow={type ? `${type.name} · ${connectorCategoryLabel(type.category)}` : connection.connector_type}
        back={{ href: "/app/collegamenti", label: "Collegamenti" }}
      />
      <div className="grid max-w-3xl gap-5">
        {outcome === "collegato" || outcome === "ricollegato" ? (
          <Notice tone="ok" announce="status">
            {outcome === "collegato"
              ? "Collegamento creato e attivo."
              : "Collegamento aggiornato e di nuovo attivo."}
          </Notice>
        ) : null}

        {attention ? (
          <Notice
            tone={connection.status === "expired" ? "warning" : "error"}
            title={connection.status === "expired" ? "L'accesso è scaduto" : "Il collegamento non funziona"}
          >
            {connection.last_error ?? "I flussi che lo usano sono fermi."}{" "}
            {reconnectHref
              ? "Ricollegalo per farli ripartire."
              : "Chiedi a chi gestisce l'azienda di ricollegarlo."}
          </Notice>
        ) : null}

        <Card>
          <CardHeader title="Stato" actions={<StatusPill {...connectionStatus(connection.status)} />} />
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Ultimo controllo</dt>
              <dd>
                {connection.last_checked_at
                  ? `${formatDateTime(connection.last_checked_at)} (${formatRelative(connection.last_checked_at)})`
                  : "Mai controllato"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Modalità</dt>
              <dd>{connectModeLabel(mode)}</dd>
            </div>
            <div>
              <dt className="text-muted">Creato il</dt>
              <dd>{formatDateTime(connection.created_at)}</dd>
            </div>
            {connection.external_account_id ? (
              <div>
                <dt className="text-muted">Account</dt>
                <dd className="break-all">{connection.external_account_id}</dd>
              </div>
            ) : null}
            {summary.map((item) => (
              <div key={item.label}>
                <dt className="text-muted">{item.label}</dt>
                <dd className="break-all">{item.value}</dd>
              </div>
            ))}
          </dl>
          {org.canManage ? (
            <div className="mt-5 border-t border-line pt-4">
              <ConnectionActions
                connection={connection}
                reconnectHref={reconnectHref}
                mode={mode}
                canRegisterWebhook={Boolean(connector?.actions.registerWebhook)}
              />
            </div>
          ) : null}
        </Card>

        {pages.length > 1 && org.canManage ? (
          <Card id="pagina">
            <CardHeader
              title="Pagina Facebook collegata"
              description={
                choosing
                  ? "Il tuo profilo amministra più pagine: abbiamo collegato la prima. Se è quella giusta non devi fare altro."
                  : "Puoi passare a un'altra pagina che amministri."
              }
            />
            <ul className="grid gap-2">
              {pages.map((page) => (
                <li
                  key={page.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
                >
                  <span className="min-w-0 break-words text-sm font-medium">{page.name}</span>
                  {page.id === currentPage ? (
                    <StatusPill tone="ok" label="Collegata" />
                  ) : allowed ? (
                    <a
                      href={`/api/oauth/meta_social/start?ricollega=${connection.id}&pagina=${encodeURIComponent(page.id)}`}
                      className={buttonClass("secondary", "sm")}
                    >
                      Collega questa
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] text-muted">
              Per cambiare pagina Facebook ti chiede di nuovo l'autorizzazione: è un passaggio di pochi
              secondi.
            </p>
          </Card>
        ) : null}

        {webhookUrl ? (
          <Card>
            <CardHeader title="Indirizzo del webhook" />
            <div className="grid gap-4">
              <CopyBlock
                label="Indirizzo"
                value={webhookUrl}
                hint={WEBHOOK_HINTS[connection.connector_type]}
              />
              {connection.connector_type === "webhook_inbound" ? (
                <>
                  <CopyBlock
                    label="Esempio di richiesta"
                    value={webhookExample(webhookUrl)}
                    pre
                    hint="Sostituisci IL_TUO_SEGRETO con il segreto di firma. La firma è l'HMAC-SHA256 del corpo, in esadecimale."
                  />
                  <p className="text-[13px] text-muted">
                    Il segreto di firma è stato mostrato una sola volta alla creazione. Se l'hai perso,
                    ricollega: ne verrà creato uno nuovo.
                  </p>
                </>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
