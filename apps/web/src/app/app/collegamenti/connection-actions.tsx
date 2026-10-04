import { ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import {
  checkConnectionNow,
  disconnectConnection,
  registerWebhookAgain,
  verifyConnectionNow,
} from "./actions";

/** Buttons for one connection: verifica ora, ricollega, scollega. Rendered only for managers. */
export function ConnectionActions({
  connection,
  reconnectHref,
  mode,
  canRegisterWebhook = false,
  compact = false,
}: {
  connection: { id: string; name: string; status: string };
  /** Where "Ricollega" goes; null when the connector type is no longer available. */
  reconnectHref: string | null;
  mode: string;
  canRegisterWebhook?: boolean;
  /** List rows: small buttons, no extra actions. */
  compact?: boolean;
}) {
  const size = compact ? "sm" : undefined;
  const needsReconnect = connection.status === "expired" || connection.status === "error";
  const disconnected = connection.status === "disconnected";
  return (
    <div className="flex flex-wrap items-start gap-2">
      {reconnectHref && (needsReconnect || disconnected) ? (
        <ButtonLink href={reconnectHref} size={size}>
          Ricollega
        </ButtonLink>
      ) : null}
      {!disconnected && mode === "qr" ? (
        <ActionForm action={checkConnectionNow.bind(null, connection.id)} className="grid gap-2">
          <SubmitButton variant="secondary" size={size} pendingLabel="Controllo…">
            Controlla stato
          </SubmitButton>
        </ActionForm>
      ) : null}
      {!disconnected && mode !== "qr" ? (
        <ActionForm action={verifyConnectionNow.bind(null, connection.id)} className="grid gap-2">
          <SubmitButton variant="secondary" size={size} pendingLabel="Richiesta…">
            Verifica ora
          </SubmitButton>
        </ActionForm>
      ) : null}
      {!compact && reconnectHref && !needsReconnect && !disconnected ? (
        <ButtonLink href={reconnectHref} variant="secondary">
          Ricollega
        </ButtonLink>
      ) : null}
      {!compact && canRegisterWebhook && !disconnected ? (
        <ActionForm action={registerWebhookAgain.bind(null, connection.id)} className="grid gap-2">
          <SubmitButton variant="secondary" pendingLabel="Registrazione…">
            Registra di nuovo il webhook
          </SubmitButton>
        </ActionForm>
      ) : null}
      {!disconnected ? (
        <Dialog
          triggerLabel="Scollega"
          triggerVariant="ghost"
          triggerSize={size}
          title={`Scollegare «${connection.name}»?`}
          description="I flussi che usano questo collegamento si fermano finché non lo ricolleghi. I dati già raccolti restano."
        >
          <ActionForm action={disconnectConnection.bind(null, connection.id)} className="grid gap-3">
            <SubmitButton variant="danger" pendingLabel="Scollego…">
              Scollega
            </SubmitButton>
          </ActionForm>
        </Dialog>
      ) : null}
    </div>
  );
}
