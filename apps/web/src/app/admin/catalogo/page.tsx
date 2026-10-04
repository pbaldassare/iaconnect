import { AiBadge, Badge, StatusPill } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Checkbox, Switch } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/action";
import { blockCategoryLabel, connectorCategoryLabel, sectorLabel } from "@/lib/labels";
import { firstParam } from "@/lib/pagination";
import { requirePlatformAdmin } from "@/lib/session";
import type { Db } from "@/lib/supabase/types";
import { type BlockDefinition, listBlocks } from "@ia-connect/core";
import type { Metadata } from "next";
import { saveConnectorType, setTemplatePublished } from "./actions";

export const metadata: Metadata = { title: "Catalogo" };

const PATH = "/admin/catalogo";
const TABS = [
  { key: "connettori", label: "Connettori" },
  { key: "blocchi", label: "Blocchi" },
  { key: "modelli", label: "Modelli di flusso" },
] as const;

const CONNECT_MODE: Record<string, string> = {
  oauth: "Autorizzazione con account",
  api_key: "Chiave API",
  credentials: "Credenziali",
  qr: "Codice QR",
  webhook: "Webhook",
};
const EFFECT: Record<BlockDefinition["effect"], string> = {
  none: "Solo calcolo",
  internal: "Scrive nei dati",
  external: "Esce dalla piattaforma",
};
const CONSUMES: Record<string, string> = { messages: "1 messaggio", ai_credits: "Crediti IA" };

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requirePlatformAdmin();
  const requested = firstParam((await searchParams).scheda);
  const tab = TABS.find((t) => t.key === requested)?.key ?? "connettori";

  return (
    <>
      <PageHeader title="Catalogo" description="Quello che i clienti possono collegare e usare nei flussi." />
      <Tabs
        label="Sezioni del catalogo"
        className="mb-6"
        items={TABS.map((t) => ({
          href: t.key === "connettori" ? PATH : `${PATH}?scheda=${t.key}`,
          label: t.label,
          current: t.key === tab,
        }))}
      />
      {tab === "connettori" ? <Connectors supabase={supabase} /> : null}
      {tab === "blocchi" ? <Blocks /> : null}
      {tab === "modelli" ? <Templates supabase={supabase} /> : null}
    </>
  );
}

async function Connectors({ supabase }: { supabase: Db }) {
  const [types, plans] = await Promise.all([
    supabase.from("connector_types").select("*").order("category").order("name"),
    supabase.from("plans").select("key, name, price_monthly_cents").order("price_monthly_cents"),
  ]);
  if (types.error) {
    return (
      <Notice tone="error" announce="alert">
        {errorMessage(types.error)}
      </Notice>
    );
  }
  const rows = types.data ?? [];
  const planRows = plans.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="plug"
        title="Nessun connettore nel catalogo"
        description="I connettori vengono inseriti dalle migrazioni del database. Controlla che siano state applicate."
      />
    );
  }
  return (
    <>
      <p className="mb-4 max-w-[70ch] text-sm text-muted">
        Un connettore spento sparisce dal catalogo dei clienti; i collegamenti già fatti restano. Se non
        spunti nessun piano, il connettore è disponibile per tutti.
      </p>
      <ul className="grid gap-3 lg:grid-cols-2">
        {rows.map((t) => (
          <Card as="li" key={t.key}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-semibold">{t.name}</h2>
                <p className="font-mono text-[12px] text-muted">{t.key}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge>{connectorCategoryLabel(t.category)}</Badge>
                <Badge>{CONNECT_MODE[t.connect_mode] ?? t.connect_mode}</Badge>
              </div>
            </div>
            {t.description ? <p className="mb-3 text-sm text-muted">{t.description}</p> : null}
            <ActionForm action={saveConnectorType} className="grid gap-3 border-t border-line pt-3">
              <input type="hidden" name="key" value={t.key} />
              <Switch name="is_enabled" defaultChecked={t.is_enabled} label="Disponibile per i clienti" />
              <fieldset>
                <legend className="mb-1.5 text-sm font-semibold">Piani ammessi</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {planRows.map((p) => (
                    <Checkbox
                      key={p.key}
                      name="plans"
                      value={p.key}
                      label={p.name}
                      defaultChecked={t.allowed_plans?.includes(p.key) ?? false}
                    />
                  ))}
                </div>
                <p className="mt-1 text-[13px] text-muted">
                  {t.allowed_plans === null
                    ? "Ora: tutti i piani."
                    : `Ora: solo ${t.allowed_plans.join(", ")}.`}
                </p>
              </fieldset>
              <div>
                <SubmitButton variant="secondary" size="sm">
                  Salva
                </SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ))}
      </ul>
    </>
  );
}

function Blocks() {
  const blocks = listBlocks();
  const categories = [...new Set(blocks.map((b) => b.category))];
  return (
    <>
      <p className="mb-4 max-w-[70ch] text-sm text-muted">
        I blocchi sono i mattoni dei flussi: codice nostro, provato. Un flusso può usare solo questi. L'elenco
        si legge dal codice (<span className="font-mono text-[12px]">packages/core</span>) e qui non si
        modifica.
      </p>
      <div className="grid gap-6">
        {categories.map((category) => {
          const inCategory = blocks.filter((b) => b.category === category);
          return (
            <section key={category} aria-labelledby={`blocchi-${category}`}>
              <h2
                id={`blocchi-${category}`}
                className="mb-2 flex items-center gap-2 font-display text-[17px] font-bold tracking-tight"
              >
                {blockCategoryLabel(category)}
                <span className="font-mono text-[12px] font-normal text-muted">{inCategory.length}</span>
              </h2>
              <Table caption={`Blocchi: ${blockCategoryLabel(category)}`} minWidth={760}>
                <thead>
                  <tr>
                    <Th>Blocco</Th>
                    <Th>Cosa fa</Th>
                    <Th>Effetto</Th>
                    <Th>Richiede</Th>
                    <Th>Consuma</Th>
                  </tr>
                </thead>
                <tbody>
                  {inCategory.map((b) => (
                    <tr key={b.key}>
                      <Td className="whitespace-nowrap">
                        <span className="flex items-center gap-2 font-semibold">
                          {b.title}
                          {b.usesAi ? <AiBadge /> : null}
                        </span>
                        <span className="font-mono text-[12px] text-muted">{b.key}</span>
                      </Td>
                      <Td muted className="min-w-[240px]">
                        {b.description}
                      </Td>
                      <Td className="whitespace-nowrap">{EFFECT[b.effect]}</Td>
                      <Td className="whitespace-nowrap">
                        {b.requires ? connectorCategoryLabel(b.requires) : "—"}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {b.consumes ? (CONSUMES[b.consumes] ?? b.consumes) : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </section>
          );
        })}
      </div>
    </>
  );
}

async function Templates({ supabase }: { supabase: Db }) {
  const templates = await supabase.from("flow_templates").select("*").order("sector").order("name");
  if (templates.error) {
    return (
      <Notice tone="error" announce="alert">
        {errorMessage(templates.error)}
      </Notice>
    );
  }
  const rows = templates.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="flow"
        title="Nessun modello di flusso"
        description="I modelli nascono nel codice (packages/core/src/flow/templates.ts) e arrivano nel database con le migrazioni."
      />
    );
  }
  return (
    <>
      <p className="mb-4 max-w-[70ch] text-sm text-muted">
        Un modello pubblicato compare nella libreria dei clienti del suo settore. La definizione si modifica
        nel codice, non da qui.
      </p>
      <ul className="grid gap-3">
        {rows.map((t) => (
          <Card as="li" key={t.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold">{t.name}</h2>
                <p className="mt-0.5 flex flex-wrap items-center gap-2">
                  <Badge>{sectorLabel(t.sector)}</Badge>
                  <span className="font-mono text-[12px] text-muted">{t.key}</span>
                </p>
              </div>
              <StatusPill
                tone={t.is_published ? "ok" : "neutral"}
                label={t.is_published ? "Pubblicato" : "Non pubblicato"}
              />
            </div>
            {t.description ? <p className="mt-2 max-w-[80ch] text-sm text-muted">{t.description}</p> : null}
            <details className="mt-3">
              <summary className="text-sm font-semibold text-accent">Mostra la definizione</summary>
              <pre className="mt-2 max-h-96 overflow-auto contain-inline-size rounded-lg border border-line bg-surface-2/60 p-3 font-mono text-[12px] leading-relaxed">
                {JSON.stringify({ definition: t.definition, requirements: t.requirements }, null, 2)}
              </pre>
            </details>
            <ActionForm action={setTemplatePublished} className="mt-3 grid gap-3 border-t border-line pt-3">
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="publish" value={t.is_published ? "0" : "1"} />
              <div>
                <SubmitButton variant="secondary" size="sm">
                  {t.is_published ? "Ritira dalla libreria" : "Pubblica"}
                </SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ))}
      </ul>
    </>
  );
}
