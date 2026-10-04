import { PlainPage } from "@/components/shell/plain-page";
import { Notice } from "@/components/ui/form-message";
import { firstParam } from "@/lib/pagination";
import { safeNextPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Accedi" };

const ERRORS: Record<string, string> = {
  link: "Il link non è più valido o è già stato usato. Chiedine uno nuovo qui sotto.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect(next);
  const error = ERRORS[firstParam(params.errore)];

  return (
    <PlainPage title="Accedi" intro="Entra con la mail con cui sei stato invitato.">
      {error ? (
        <Notice tone="error" announce="alert" className="mb-4">
          {error}
        </Notice>
      ) : null}
      <SignInForm next={next} />
      <p className="mt-5 border-t border-line pt-4 text-[13px] text-muted">
        Non hai un account? Si entra su invito: chiedi al titolare della tua azienda o a chi ti segue in IA
        Connect. Al primo accesso usa «Ricevi un link via mail», poi potrai scegliere una password.
      </p>
    </PlainPage>
  );
}
