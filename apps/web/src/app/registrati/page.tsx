import { PlainPage } from "@/components/shell/plain-page";
import { LANDING_PATH } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Registrati" };
// The form carries the time it was rendered (abuse check): never serve a cached copy.
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  // The middleware already does this; kept for when it cannot run.
  if (data.user) redirect(LANDING_PATH);

  return (
    <PlainPage
      title="Registrati"
      intro="Crea il tuo account e chiedi l'attivazione della tua azienda. Un amministratore di IA Connect la attiva dopo aver controllato i dati."
    >
      <RegisterForm startedAt={Date.now()} />
      <p className="mt-5 border-t border-line pt-4 text-sm">
        Hai già un account?{" "}
        <Link href="/accedi" className="font-semibold text-accent-strong underline">
          Accedi
        </Link>
      </p>
    </PlainPage>
  );
}
