import { signOut, switchOrganization } from "@/components/shell/actions";
import { PlainPage } from "@/components/shell/plain-page";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/form-message";
import { resolveLanding } from "@/lib/access";
import { COMPLETE_REGISTRATION_PATH, WAITING_PATH } from "@/lib/landing-route";
import { firstParam } from "@/lib/pagination";
import { getOrgContext } from "@/lib/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Nessuna azienda" };

export default async function NoOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const suspended = firstParam((await searchParams).motivo) === "sospesa";
  const { supabase, session, organizations } = await getOrgContext();
  if (organizations.length === 0) {
    // An invitation may have arrived after sign-in: accept it now instead of asking to sign in again.
    const { data: accepted } = await supabase.rpc("accept_invitations");
    if (accepted && accepted > 0) redirect("/app");
    // No organization because the person is still waiting for one, or never asked: those
    // cases have their own pages. What stays here: suspended, or access taken away.
    const landing = await resolveLanding(supabase);
    if (landing && (landing.path === WAITING_PATH || landing.path === COMPLETE_REGISTRATION_PATH)) {
      redirect(landing.path);
    }
  }
  const usable = organizations.filter((o) => o.status === "active");

  return (
    <PlainPage
      title={suspended ? "Azienda sospesa" : "Nessuna azienda collegata"}
      intro={
        suspended
          ? "L'accesso a questa azienda è sospeso. I dati sono al sicuro; per riattivarla contatta chi ti segue in IA Connect."
          : "Il tuo account non è ancora collegato a un'azienda."
      }
    >
      {!suspended ? (
        <Notice tone="neutral" className="mb-4">
          Sei entrato come <span className="font-mono text-[13px]">{session.user.email}</span>. Se sei stato
          invitato con un altro indirizzo, esci e rientra con quello. Altrimenti chiedi un invito al titolare
          della tua azienda, oppure scrivi a chi ti segue in IA Connect.
        </Notice>
      ) : null}
      {usable.length > 0 ? (
        <div className="mb-4">
          <p className="mb-2 text-sm font-semibold">Le tue aziende</p>
          <ul className="grid gap-2">
            {usable.map((o) => (
              <li key={o.id}>
                <form action={switchOrganization}>
                  <input type="hidden" name="org" value={o.id} />
                  <Button variant="secondary" className="w-full justify-start">
                    {o.name}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <form action={signOut}>
        <Button variant="ghost" icon="logout">
          Esci
        </Button>
      </form>
    </PlainPage>
  );
}
