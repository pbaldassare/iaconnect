import { CopyBlock } from "@/components/connections/copy-button";
import { StatusPill } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { type RecoverySheet, formatLinePhone, publicHttpUrl } from "@/lib/connections/recovery";
import { connectionStatus } from "@/lib/labels";
import type { ReactNode } from "react";

function Fact({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {children}
    </Card>
  );
}

function Missing() {
  return <p className="text-sm text-muted">Non indicato su questo collegamento.</p>;
}

/**
 * Restore sheet. Receives only the public facts from `recoverySheet`:
 * no gateway token, no Vault payload.
 */
export function RecoverySheetView({
  name,
  status,
  sheet,
}: {
  name: string;
  status: string;
  sheet: RecoverySheet;
}) {
  const phone = sheet.phone ? formatLinePhone(sheet.phone) : null;
  const sessionHref = sheet.sessionStatusUrl ? publicHttpUrl(sheet.sessionStatusUrl) : null;

  return (
    <div className="grid max-w-3xl gap-5">
      <Fact title="Collegamento" description="Nome e stato del collegamento da ripristinare.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 break-words text-sm font-medium">{name}</p>
          <StatusPill {...connectionStatus(status)} />
        </div>
      </Fact>

      <Fact
        title="Numero della linea"
        description="Numero WhatsApp della linea, quello da cui partono i messaggi."
      >
        {phone ? <CopyBlock label="Numero" value={phone} /> : <Missing />}
        {sheet.lineName ? (
          <div className={phone ? "mt-4" : undefined}>
            <CopyBlock label="Nome della linea" value={sheet.lineName} />
          </div>
        ) : null}
      </Fact>

      <Fact
        title="Gateway"
        description="Indirizzo di base del gateway Futureflow a cui è collegata la sessione."
      >
        {sheet.baseUrl ? <CopyBlock label="Indirizzo di base" value={sheet.baseUrl} /> : <Missing />}
      </Fact>

      <Fact
        title="Istanza"
        description="Identificativo della sessione sul gateway. Insieme all'indirizzo di base ricostruisce il link dello stato."
      >
        {sheet.instanceId ? <CopyBlock label="Identificativo" value={sheet.instanceId} /> : <Missing />}
      </Fact>

      <Fact
        title="Stato della sessione"
        description="Serve per il ripristino della sessione. È l'indirizzo di base seguito da /sessionStatus/ e dall'identificativo."
      >
        {sessionHref ? (
          <div className="grid gap-3">
            <CopyBlock label="Indirizzo" value={sessionHref} />
            <a
              href={sessionHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-accent underline-offset-2 hover:underline"
            >
              Apri lo stato della sessione
            </a>
          </div>
        ) : (
          <Missing />
        )}
      </Fact>

      <Fact
        title="Webhook in ingresso"
        description="Indirizzo che Futureflow deve chiamare quando arrivano messaggi su questa linea."
      >
        {sheet.inboundWebhookUrl ? (
          <CopyBlock label="Indirizzo" value={sheet.inboundWebhookUrl} />
        ) : (
          <Missing />
        )}
      </Fact>

      {sheet.notes.map((note) => (
        <Fact
          key={`${note.label}:${note.value}`}
          title={note.label}
          description="Numero o appunto salvato accanto alla linea. Non è il numero WhatsApp da cui partono i messaggi."
        >
          <CopyBlock label="Valore" value={note.value} />
        </Fact>
      ))}

      {sheet.extras.length > 0 ? (
        <Card>
          <CardHeader
            title="Altri dati"
            description="Altri valori non segreti già salvati su questo collegamento."
          />
          <div className="grid gap-4">
            {sheet.extras.map((item) => (
              <CopyBlock key={item.key} label={item.label} value={item.value} />
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
