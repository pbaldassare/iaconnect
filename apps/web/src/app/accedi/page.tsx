import { PlainPage } from "@/components/shell/plain-page";
import { Notice } from "@/components/ui/form-message";
import { firstParam } from "@/lib/pagination";
import { LANDING_PATH, safeNextPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Accedi" };

const ERRORS: Record<string, string> = {
  link: "Il link non è più valido, è già stato usato, oppure è stato aperto da un browser diverso da quello della richiesta. Se hai appena confermato la registrazione entra con mail e password; altrimenti chiedi un nuovo link qui sotto.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawNext = firstParam(params.next);
  const next = safeNextPath(rawNext);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  // The middleware already does this; kept for when it cannot run.
  if (data.user) redirect(rawNext ? `${LANDING_PATH}?next=${encodeURIComponent(next)}` : LANDING_PATH);
  const error = ERRORS[firstParam(params.errore)];

  return (
    <PlainPage title="Accedi" intro="Entra nell'area riservata con la tua mail.">
      {error ? (
        <Notice tone="error" announce="alert" className="mb-4">
          {error}
        </Notice>
      ) : null}
      <SignInForm next={next} />
      <div className="mt-5 grid gap-2 border-t border-line pt-4 text-sm">
        <p>
          Non hai un account?{" "}
          <Link href="/registrati" className="font-semibold text-accent-strong underline">
            Registrati
          </Link>
        </p>
        <p className="text-[13px] text-muted">
          Sei stato invitato da un'azienda? Al primo accesso usa «Ricevi un link via mail» con l'indirizzo
          dell'invito, poi potrai scegliere una password.
        </p>
      </div>
    </PlainPage>
  );
}
