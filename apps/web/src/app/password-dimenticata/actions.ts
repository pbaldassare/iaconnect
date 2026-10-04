"use server";
import { type ActionResult, fail, ok, parseForm } from "@/lib/action";
import { createClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/url";
import { z } from "zod";

const Schema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Scrivi un indirizzo mail valido.")),
});

/** Sends the password reset mail. The answer is the same whether or not the address is registered. */
export async function requestPasswordReset(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = parseForm(Schema, formData);
  if (!parsed.ok) return parsed.result;
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await appUrl()}/auth/callback?next=${encodeURIComponent("/imposta-password")}`,
  });
  if (error) {
    if (error.status === 429 || /rate limit|security purposes/i.test(error.message)) {
      return fail("Hai chiesto troppe mail in poco tempo. Aspetta qualche minuto e riprova.");
    }
    if (error.status && error.status >= 500) {
      console.error("[password-dimenticata]", error.status, error.message);
      return fail("Il servizio di accesso non risponde. Riprova tra poco.");
    }
    console.error("[password-dimenticata]", error.status, error.message);
  }
  return ok(
    "Se l'indirizzo è registrato, tra poco ricevi una mail con il link per scegliere una nuova password. Aprilo da questo stesso browser; controlla anche lo spam.",
  );
}
