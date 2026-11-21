import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { errorMessage } from "@/lib/action";
import { formatDateTime } from "@/lib/format";
import { requirePlatformAdmin } from "@/lib/session";
import type { Metadata } from "next";
import { revokeApiKey } from "./actions";
import { IssueKeyForm } from "./issue-key-form";

export const metadata: Metadata = { title: "API" };

export default async function ApiPage() {
  const { supabase } = await requirePlatformAdmin();
  const [keys, organizations] = await Promise.all([
    supabase
      .from("api_keys")
      .select("id, name, key_prefix, organization_id, created_at, last_used_at, revoked_at")
      .order("created_at", { ascending: false }),
    supabase.from("organizations").select("id, name").order("name"),
  ]);
  const names = new Map(
    (organizations.data ?? []).map((organization) => [organization.id, organization.name]),
  );
  const rows = keys.data ?? [];

  return (
    <>
      <PageHeader
        title="API"
        description="Due livelli: l'admin vede ogni cliente, il cliente solo la propria azienda. Le chiavi servono alle altre piattaforme per leggere aziende, conversazioni e messaggi."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Nuova chiave" description="La chiave intera compare una volta sola." />
          {organizations.error ? (
            <Notice tone="error" announce="alert">
              {errorMessage(organizations.error)}
            </Notice>
          ) : (
            <IssueKeyForm organizations={organizations.data ?? []} />
          )}
        </Card>
        <Card>
          <CardHeader title="Come si chiama" />
          <div className="space-y-3 text-sm text-ink/90">
            <p>
              Indirizzo del sito più il percorso. Al posto del cookie si manda{" "}
              <code className="font-mono text-[13px]">Authorization: Bearer iac_…</code>
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <code className="font-mono text-[13px]">GET /api/v1/organizations</code>
              </li>
              <li>
                <code className="font-mono text-[13px]">
                  GET /api/v1/organizations/{"{id}"}/conversations
                </code>
              </li>
              <li>
                <code className="font-mono text-[13px]">
                  GET /api/v1/organizations/{"{id}"}/conversations/{"{id}"}/messages
                </code>
              </li>
            </ul>
            <p>
              <code className="font-mono text-[13px]">limit</code> va da 1 a 100,{" "}
              <code className="font-mono text-[13px]">before</code> è un istante: la pagina successiva parte
              dalla riga più vecchia già ricevuta. L'invio dei messaggi resta nell'Inbox, dove passano
              consenso e quota.
            </p>
          </div>
        </Card>
      </div>
      <section className="mt-6" aria-labelledby="chiavi-titolo">
        <h2 id="chiavi-titolo" className="mb-2 font-display text-[17px] font-bold tracking-tight">
          Chiavi
        </h2>
        {keys.error ? (
          <Notice tone="error" announce="alert">
            {errorMessage(keys.error)}
          </Notice>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="plug"
            title="Nessuna chiave"
            description="Creane una per collegare un gestionale, un sito o un'altra piattaforma. Scegli «Tutti i clienti» solo per un sistema tuo."
          />
        ) : (
          <Table caption="Chiavi API" minWidth={760}>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Ambito</Th>
                <Th>Prefisso</Th>
                <Th>Ultimo uso</Th>
                <Th>Stato</Th>
                <Th align="right">Azioni</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((key) => (
                <tr key={key.id}>
                  <Td>{key.name}</Td>
                  <Td>
                    {key.organization_id ? (names.get(key.organization_id) ?? "Azienda") : "Tutti i clienti"}
                  </Td>
                  <Td mono>{key.key_prefix}</Td>
                  <Td mono muted>
                    {key.last_used_at ? formatDateTime(key.last_used_at) : "Mai"}
                  </Td>
                  <Td>
                    <Badge tone={key.revoked_at ? "neutral" : "ok"}>
                      {key.revoked_at ? "Revocata" : "Attiva"}
                    </Badge>
                  </Td>
                  <Td align="right">
                    {key.revoked_at ? null : (
                      <ActionForm
                        action={revokeApiKey.bind(null, key.id)}
                        className="grid justify-items-end gap-2"
                      >
                        <SubmitButton variant="ghost" size="sm">
                          Revoca
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}
