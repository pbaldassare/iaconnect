/** What happened to the invitation mail, and what to tell the admin. Pure. */
export type InviteMailOutcome = "sent" | "existing" | "no_key" | "failed";

export const INVITE_OUTCOMES: readonly InviteMailOutcome[] = ["sent", "existing", "no_key", "failed"];

export function inviteOutcomeMessage(
  outcome: InviteMailOutcome,
  email: string,
): { tone: "ok" | "warning"; text: string } {
  switch (outcome) {
    case "sent":
      return {
        tone: "ok",
        text: `Invito inviato a ${email}. Dal link nella mail sceglie la password ed entra nell'azienda.`,
      };
    case "existing":
      return {
        tone: "ok",
        text: `${email} ha già un account: non riceve una nuova mail. Entrerà nell'azienda al prossimo accesso da /accedi (se è già dentro, deve uscire e rientrare).`,
      };
    case "no_key":
      return {
        tone: "warning",
        text: `Invito registrato per ${email}, ma la mail automatica non è partita: su questo server manca SUPABASE_SERVICE_ROLE_KEY. Se la persona ha già un account, le basta accedere da /accedi (anche con «Ricevi un link via mail»). Altrimenti crea l'utente da Supabase → Authentication → Add user con questo indirizzo: al primo accesso verrà collegato all'azienda.`,
      };
    case "failed":
      return {
        tone: "warning",
        text: `Invito registrato per ${email}, ma l'invio della mail non è riuscito. Riprova con «Invia di nuovo»; se la persona ha già un account può comunque accedere da /accedi.`,
      };
  }
}
