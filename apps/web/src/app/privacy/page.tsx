import { PlainPage } from "@/components/shell/plain-page";
import { Notice } from "@/components/ui/form-message";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Informativa sulla privacy", robots: { index: false } };

/**
 * PLACEHOLDER. The legal text must be written by the owner (with whoever follows privacy for
 * the company) before the registration goes public: nothing here is, or pretends to be, a
 * privacy notice. Replace the whole body of this page.
 */
export default function PrivacyPage() {
  return (
    <PlainPage title="Informativa sulla privacy">
      <Notice tone="warning" title="Testo da completare" className="mb-4">
        Questa pagina è un segnaposto. L'informativa sul trattamento dei dati personali deve essere fornita
        dal titolare di IA Connect prima dell'apertura al pubblico della registrazione.
      </Notice>
      <div className="grid gap-3 text-sm">
        <p>Il testo definitivo dovrà indicare almeno:</p>
        <ul className="grid list-disc gap-1.5 pl-5">
          <li>chi è il titolare del trattamento e come contattarlo;</li>
          <li>quali dati vengono raccolti con la registrazione e perché;</li>
          <li>la base giuridica del trattamento e per quanto tempo i dati sono conservati;</li>
          <li>a quali fornitori vengono comunicati i dati;</li>
          <li>i diritti dell'interessato e come esercitarli.</li>
        </ul>
        <p className="text-muted">
          L'elenco qui sopra è un promemoria per chi deve scrivere l'informativa, non un testo legale.
        </p>
      </div>
      <p className="mt-5 border-t border-line pt-4 text-sm">
        <Link href="/registrati" className="font-semibold text-accent-strong underline">
          Torna alla registrazione
        </Link>
      </p>
    </PlainPage>
  );
}
