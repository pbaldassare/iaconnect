import { AccessRequestForm } from "@/components/account/access-request-form";
import { signOut } from "@/components/shell/actions";
import { PlainPage } from "@/components/shell/plain-page";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/form-message";
import { enterLanding } from "@/lib/access";
import { formatDateTime } from "@/lib/format";
import { sectorLabel } from "@/lib/labels";
import { WAITING_PATH } from "@/lib/landing-route";
import { firstParam } from "@/lib/pagination";
import { SIGN_IN_PATH } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Richiesta di accesso" };

/**
 * The page of someone who asked for access and is waiting for an administrator. Checks on
 * every load: once the company is active (or an invitation arrived) it forwards to the app.
 */
export default async function WaitingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const landing = await enterLanding(supabase);
  if (!landing) redirect(SIGN_IN_PATH);
  if (landing.path !== WAITING_PATH || !landing.request) redirect(landing.path);
  const request = landing.request;
  const rejected = request.status === "rejected";
  const justSent = firstParam((await searchParams).inviata) === "1";
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email ?? "";

  const defaults = {
    fullName: request.full_name,
    companyName: request.company_name,
    sector: request.sector,
    phone: request.phone,
    message: request.message,
  };
  const rows: [string, string][] = [
    ["Azienda", request.company_name],
    ["Settore", sectorLabel(request.sector)],
    ["Nome", request.full_name ?? "—"],
    ["Telefono", request.phone ?? "—"],
    ["Account", email],
    ["Inviata", formatDateTime(request.updated_at)],
  ];

  return (
    <PlainPage
      title={rejected ? "Richiesta non accettata" : "Richiesta ricevuta"}
      intro={
        rejected
          ? "Un amministratore ha esaminato la richiesta e non l'ha accettata. Puoi correggere i dati e inviarla di nuovo."
          : "Abbiamo la tua richiesta. L'azienda non è ancora attiva: la attiva un amministratore di IA Connect."
      }
    >
      {justSent && !rejected ? (
        <Notice tone="ok" announce="status" className="mb-4">
          Richiesta inviata.
        </Notice>
      ) : null}
      {rejected ? (
        <Notice tone="error" title="Motivo indicato dall'amministratore" className="mb-4">
          <span className="whitespace-pre-line break-words">
            {request.decision_note ?? "Nessun motivo indicato."}
          </span>
        </Notice>
      ) : (
        <section aria-labelledby="next-steps" className="mb-5">
          <h2 id="next-steps" className="text-sm font-semibold">
            Cosa succede adesso
          </h2>
          <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-sm">
            <li>Un amministratore controlla i dati che hai inviato.</li>
            <li>Se è tutto in ordine attiva la tua azienda e sceglie il piano.</li>
            <li>
              Torna su questa pagina o accedi di nuovo: quando l'azienda è attiva entri direttamente nell'area
              riservata. Per ora non parte una mail automatica di avviso.
            </li>
          </ol>
        </section>
      )}

      <section aria-labelledby="sent-data" className="mb-5">
        <h2 id="sent-data" className="text-sm font-semibold">
          I dati inviati
        </h2>
        <dl className="mt-2 grid gap-1.5 rounded-lg border border-line bg-surface-2 p-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
              <dt className="text-muted">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
          {request.message ? (
            <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
              <dt className="text-muted">Nota</dt>
              <dd className="whitespace-pre-line break-words">{request.message}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {rejected ? (
        <section aria-labelledby="resubmit" className="mb-5">
          <h2 id="resubmit" className="mb-3 text-sm font-semibold">
            Correggi e invia di nuovo
          </h2>
          <AccessRequestForm defaults={defaults} submitLabel="Invia di nuovo la richiesta" />
        </section>
      ) : (
        <details className="mb-5 rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">Modifica i dati della richiesta</summary>
          <div className="mt-4">
            <AccessRequestForm defaults={defaults} submitLabel="Salva e invia di nuovo" />
          </div>
        </details>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {rejected ? null : (
          <ButtonLink href={WAITING_PATH} variant="secondary">
            Controlla di nuovo
          </ButtonLink>
        )}
        <form action={signOut}>
          <Button variant="ghost" icon="logout">
            Esci
          </Button>
        </form>
      </div>
    </PlainPage>
  );
}
