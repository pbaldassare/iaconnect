/**
 * WhatsApp lets a business write free text only within 24 hours of the contact's
 * last message (`conversations.window_expires_at`, set by the worker). Outside the
 * window only an approved template may be sent. The worker enforces it; this is
 * what the composer shows. Pure, unit tested.
 */
export interface WindowState {
  /** False for every channel but WhatsApp: the rule does not apply. */
  applies: boolean;
  open: boolean;
  expiresAt: string | null;
  /** Whole minutes left; 0 when closed. */
  minutesLeft: number;
  /** Plain Italian explanation for the operator. */
  note: string;
}

export function whatsappWindow(
  channel: string,
  windowExpiresAt: string | null | undefined,
  now: Date = new Date(),
): WindowState {
  if (channel !== "whatsapp") {
    return { applies: false, open: true, expiresAt: null, minutesLeft: 0, note: "" };
  }
  const expires = windowExpiresAt ? new Date(windowExpiresAt) : null;
  const valid = expires !== null && !Number.isNaN(expires.getTime());
  const msLeft = valid ? expires.getTime() - now.getTime() : 0;
  if (!valid || msLeft <= 0) {
    return {
      applies: true,
      open: false,
      expiresAt: valid ? expires.toISOString() : null,
      minutesLeft: 0,
      note: valid
        ? "Sono passate più di 24 ore dall'ultimo messaggio del contatto: WhatsApp non permette testo libero. Puoi inviare solo un modello approvato; appena il contatto risponde potrai scrivere di nuovo liberamente."
        : "Il contatto non ha ancora scritto su WhatsApp: per iniziare la conversazione puoi inviare solo un modello approvato. Dopo la sua risposta potrai scrivere liberamente per 24 ore.",
    };
  }
  const minutesLeft = Math.floor(msLeft / 60_000);
  return {
    applies: true,
    open: true,
    expiresAt: expires.toISOString(),
    minutesLeft,
    note: `Puoi scrivere liberamente ancora per ${formatLeft(minutesLeft)}. Poi servirà un modello approvato.`,
  };
}

function formatLeft(minutes: number): string {
  if (minutes < 1) return "meno di un minuto";
  if (minutes < 60) return minutes === 1 ? "1 minuto" : `${minutes} minuti`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = hours === 1 ? "1 ora" : `${hours} ore`;
  return rest === 0 ? h : `${h} e ${rest} min`;
}

export type ComposerMode = "free_or_template" | "template_only";

/** What the composer allows for this conversation. */
export function composerMode(state: WindowState): ComposerMode {
  return state.applies && !state.open ? "template_only" : "free_or_template";
}
