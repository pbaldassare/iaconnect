import { ConnectForm } from "@/components/connections/connect-form";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { canConnect } from "@/lib/connections/access";
import { connectModeLabel } from "@/lib/connections/catalog";
import { schemaToFields } from "@/lib/connections/form-fields";
import { connectHelp } from "@/lib/connections/help";
import { isUuid } from "@/lib/org-selection";
import { firstParam } from "@/lib/pagination";
import { requireOrgManager } from "@/lib/session";
import { MissingServiceKeyError, hasServiceKey } from "@/lib/supabase/service";
import { getConnector } from "@ia-connect/connectors";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { connectWithForm } from "../../actions";

export const metadata: Metadata = { title: "Nuovo collegamento" };

export default async function NewConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ connector: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireOrgManager();
  const { connector: key } = await params;
  const connector = getConnector(key);
  if (!connector) notFound();
  const allowed = await canConnect(context, connector.key);

  const reconnectParam = firstParam((await searchParams).ricollega);
  let reconnect: { id: string; name: string } | null = null;
  if (isUuid(reconnectParam)) {
    const { data } = await context.supabase
      .from("connections")
      .select("id, name")
      .eq("id", reconnectParam)
      .eq("organization_id", context.org.organization.id)
      .eq("connector_type", connector.key)
      .maybeSingle();
    reconnect = data;
  }

  const help = connectHelp(connector.key);
  const isOAuth = connector.connectMode === "oauth";
  const fields = isOAuth
    ? []
    : schemaToFields(z.toJSONSchema(connector.inputSchema, { io: "input", unrepresentable: "any" }), {
        omit: ["code", "redirectUri", "statusCallbackUrl"],
      });
  const startHref = `/api/oauth/${connector.key}/start${reconnect ? `?ricollega=${reconnect.id}` : ""}`;

  return (
    <>
      <PageHeader
        title={reconnect ? `Ricollega «${reconnect.name}»` : `Collega ${connector.name}`}
        description={connector.description}
        context={connectModeLabel(connector.connectMode)}
        back={{ href: "/app/collegamenti", label: "Collegamenti" }}
      />
      <div className="grid max-w-2xl gap-5">
        {!allowed ? (
          <Notice tone="warning" title="Non disponibile">
            Questo collegamento non è compreso nel piano o nelle funzioni attive della tua azienda. Chiedi
            all'assistenza di attivarlo.
          </Notice>
        ) : !context.demo && !hasServiceKey() ? (
          <Notice tone="error" title="Il server non è pronto per creare collegamenti">
            {new MissingServiceKeyError().message}
          </Notice>
        ) : (
          <>
            {help.length > 0 ? (
              <Notice tone="neutral" title="Prima di cominciare">
                <ul className="grid list-disc gap-1 pl-4">
                  {help.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            {isOAuth ? (
              <Card className="grid gap-3">
                <p className="text-sm">
                  Non ti chiediamo la password: l'autorizzazione avviene sul sito del fornitore e puoi
                  revocarla da lì in ogni momento.
                </p>
                <div>
                  {/* A plain link on purpose: next/link would prefetch a route that sets a cookie. */}
                  <a href={startHref} className={buttonClass()}>
                    {reconnect ? "Autorizza di nuovo" : `Continua con ${connector.name}`}
                  </a>
                </div>
              </Card>
            ) : (
              <Card>
                <ConnectForm
                  action={connectWithForm.bind(null, connector.key, reconnect?.id ?? null)}
                  fields={fields}
                  defaultName={reconnect?.name ?? connector.name}
                  showName={!reconnect}
                  submitLabel={
                    reconnect
                      ? "Ricollega"
                      : connector.connectMode === "webhook"
                        ? "Crea l'indirizzo"
                        : "Collega"
                  }
                />
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}
