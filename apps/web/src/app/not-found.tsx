import { PlainPage } from "@/components/shell/plain-page";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PlainPage
      title="Pagina non trovata"
      intro="L'indirizzo non esiste, oppure non hai accesso a questa pagina."
    >
      <ButtonLink href="/app">Torna all'inizio</ButtonLink>
    </PlainPage>
  );
}
