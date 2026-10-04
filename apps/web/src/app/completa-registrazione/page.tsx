import { AccessRequestForm } from "@/components/account/access-request-form";
import { signOut } from "@/components/shell/actions";
import { PlainPage } from "@/components/shell/plain-page";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/form-message";
import { enterLanding } from "@/lib/access";
import { COMPLETE_REGISTRATION_PATH } from "@/lib/landing-route";
import { registrationFromMetadata } from "@/lib/registration";
import { SIGN_IN_PATH } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Completa la registrazione" };

/**
 * For a signed-in person with no role and no request: someone whose account exists in the
 * shared Auth but who never asked for IA Connect, or whose request could not be created at
 * sign-in (for example because the address was not confirmed yet).
 */
export default async function CompleteRegistrationPage() {
  const supabase = await createClient();
  const landing = await enterLanding(supabase);
  if (!landing) redirect(SIGN_IN_PATH);
  if (landing.path !== COMPLETE_REGISTRATION_PATH) redirect(landing.path);
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  const saved = registrationFromMetadata(user?.user_metadata);
  const confirmed = Boolean(user?.email_confirmed_at);

  return (
    <PlainPage
      title="Completa la registrazione"
      intro="Il tuo account esiste, ma non è ancora collegato a un'azienda in IA Connect. Dicci per quale azienda chiedi l'accesso: un amministratore la attiva dopo aver controllato i dati."
    >
      <Notice tone="neutral" className="mb-4">
        Sei entrato come <span className="break-all font-mono text-[13px]">{user?.email}</span>. Se un'azienda
        ti ha invitato con un altro indirizzo, esci e rientra con quello.
      </Notice>
      {confirmed ? null : (
        <Notice tone="warning" title="Indirizzo mail da confermare" className="mb-4">
          Prima di inviare la richiesta apri il link di conferma che hai ricevuto via mail.
        </Notice>
      )}
      <AccessRequestForm
        defaults={
          saved
            ? {
                fullName: saved.fullName,
                companyName: saved.companyName,
                sector: saved.sector,
                phone: saved.phone,
                message: saved.message,
              }
            : undefined
        }
        submitLabel="Invia la richiesta"
      />
      <form action={signOut} className="mt-5 border-t border-line pt-4">
        <Button variant="ghost" icon="logout">
          Esci
        </Button>
      </form>
    </PlainPage>
  );
}
