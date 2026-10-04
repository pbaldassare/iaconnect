import { AuditTable } from "@/components/audit-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Tabs } from "@/components/ui/tabs";
import { firstParam, pageWindow, parsePage, withParams } from "@/lib/pagination";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Registro delle azioni" };

const PAGE_SIZE = 50;
const PATH = "/app/impostazioni/registro";

export default async function OrgAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, session, org } = await requireOrg();
  const params = await searchParams;
  const onlySupport = firstParam(params.vista) === "assistenza";
  const page = parsePage(params.pagina);
  const { from, to } = pageWindow(page, PAGE_SIZE);

  let query = supabase
    .from("audit_log")
    .select("*", { count: "exact" })
    .eq("organization_id", org.organization.id)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (onlySupport) query = query.or("is_support_access.eq.true,entity_type.eq.support_sessions");
  const { data, count, error } = await query;
  const rows = data ?? [];

  return (
    <>
      <PageHeader
        title="Registro delle azioni"
        description="Chi ha fatto cosa nella tua azienda. Il registro non si può modificare né cancellare."
        back={{ href: "/app/impostazioni", label: "Impostazioni" }}
      />
      <Notice tone="neutral" title="Accessi dell'assistenza" className="mb-4">
        Quando una persona di IA Connect (o del tuo rivenditore) entra nella tua azienda per aiutarti,
        l'accesso e ogni modifica che fa compaiono qui con l'etichetta «Assistenza».
      </Notice>
      <Tabs
        label="Filtra il registro"
        className="mb-4"
        items={[
          { href: PATH, label: "Tutte le azioni", current: !onlySupport },
          { href: withParams(PATH, { vista: "assistenza" }), label: "Solo assistenza", current: onlySupport },
        ]}
      />
      {error ? (
        <Notice tone="error" announce="alert">
          Il registro non si è caricato. Ricarica la pagina; se succede ancora, contatta l'assistenza.
        </Notice>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="list"
          title={onlySupport ? "Nessun accesso dell'assistenza" : "Ancora nessuna azione registrata"}
          description={
            onlySupport
              ? "Nessuno dell'assistenza è entrato nella tua azienda."
              : "Le azioni compaiono qui man mano: collegamenti, flussi, trattative, utenti."
          }
        />
      ) : (
        <>
          <AuditTable rows={rows} currentUserId={session.user.id} />
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={count ?? rows.length}
            hrefFor={(p) => withParams(PATH, { vista: onlySupport ? "assistenza" : null, pagina: p })}
          />
        </>
      )}
    </>
  );
}
