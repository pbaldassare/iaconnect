import { SettingsNav } from "@/components/settings/settings-nav";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Dati e privacy" };

export default async function PrivacySettingsPage() {
  const { org } = await requireOrg();
  return (
    <>
      <PageHeader
        title="Dati e privacy"
        back={{ href: "/app/impostazioni", label: "Impostazioni" }}
        description="Chi è responsabile dei dati e come ottenerne una copia."
      />
      <SettingsNav current="privacy" />
      <div className="grid max-w-3xl gap-4">
        <Card aria-labelledby="ruoli">
          <CardHeader id="ruoli" title="Chi fa cosa" />
          <div className="grid gap-3 text-sm">
            <p>
              <span className="font-semibold">{org.organization.name} è il titolare del trattamento.</span>{" "}
              Decide quali contatti inserire, per quali scopi scrivere loro e raccoglie il loro consenso.
            </p>
            <p>
              <span className="font-semibold">IA Connect è il responsabile del trattamento.</span> Conserva ed
              elabora i dati solo per far funzionare i tuoi flussi, secondo le tue istruzioni, su server
              nell'Unione Europea.
            </p>
            <ul className="list-disc space-y-1.5 pl-5 text-muted">
              <li>
                Nessun messaggio parte verso un contatto senza un consenso valido per quel canale. Consensi e
                revoche, con data e origine, sono nella scheda di ogni contatto.
              </li>
              <li>
                Se un contatto chiede una copia dei suoi dati o la cancellazione, trovi «Esporta dati» ed
                «Elimina contatto» in fondo alla sua{" "}
                <Link href="/app/contatti" className="underline">
                  scheda
                </Link>
                .
              </li>
              <li>
                Ogni azione di persone, automazioni e assistenza resta nel{" "}
                <Link href="/app/impostazioni/registro" className="underline">
                  registro
                </Link>
                , che non si può modificare.
              </li>
            </ul>
          </div>
        </Card>
        <Card aria-labelledby="esporta">
          <CardHeader
            id="esporta"
            title="Esporta tutti i dati dell'azienda"
            description="Un file JSON con impostazioni, contatti, conversazioni, messaggi, trattative, flussi, modelli, collegamenti (le credenziali cifrate non sono incluse) e consumi."
          />
          {org.canManage ? (
            <>
              <a href="/app/impostazioni/privacy/export" className={buttonClass("secondary")} download>
                Scarica l'esportazione (JSON)
              </a>
              <p className="mt-3 text-[13px] text-muted">
                Il file contiene dati personali: conservalo con cura. L'esportazione viene annotata nel
                registro. Con molti dati può richiedere qualche secondo.
              </p>
            </>
          ) : (
            <Notice tone="neutral">L'esportazione è riservata ai titolari dell'azienda.</Notice>
          )}
        </Card>
        <Card aria-labelledby="chiusura">
          <CardHeader id="chiusura" title="Chiudere l'account" className="mb-2" />
          <p className="text-sm text-muted">
            La cancellazione dell'intera azienda e di tutti i suoi dati la esegue IA Connect su richiesta
            scritta di un titolare. Scrivi a chi ti segue: prima della cancellazione puoi scaricare
            l'esportazione qui sopra.
          </p>
        </Card>
      </div>
    </>
  );
}
