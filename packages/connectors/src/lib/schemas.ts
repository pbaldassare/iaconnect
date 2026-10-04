import { z } from "zod";

/** What the OAuth redirect hands to `connect`. */
export const OAuthCallbackInput = z.object({
  code: z.string().min(1).describe("Codice di autorizzazione ricevuto dal fornitore"),
  redirectUri: z.string().url().describe("Indirizzo di ritorno usato per l'autorizzazione"),
});

/** Extra action exposed by connectors whose webhook must be registered after the connection exists. */
export const RegisterWebhookInput = z.object({
  url: z.string().url().describe("Indirizzo pubblico del webhook di questo collegamento"),
});
