import { signOut } from "@/components/shell/actions";
import { PlainPage } from "@/components/shell/plain-page";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/form-message";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Servizio non raggiungibile" };

/** Shown when the database cannot be read at all (it must not read the database itself). */
export default function UnavailablePage() {
  return (
    <PlainPage
      title="Il servizio non è raggiungibile"
      intro="L'accesso è riuscito, ma in questo momento non riusciamo a leggere i tuoi dati. Riprova tra qualche minuto."
    >
      <Notice tone="neutral" title="Per chi gestisce la piattaforma" className="mb-4">
        La causa più comune è lo schema <span className="font-mono text-[13px]">ia_connect</span> non ancora
        aggiunto agli «Exposed schemas» (Supabase → Project Settings → API). Il dettaglio dell'errore è nei
        log del server.
      </Notice>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/app">Riprova</ButtonLink>
        <form action={signOut}>
          <Button variant="ghost" icon="logout">
            Esci
          </Button>
        </form>
      </div>
    </PlainPage>
  );
}
