"use server";
import { completeSignIn } from "@/lib/access";
import { type ActionResult, fail, ok, parseForm } from "@/lib/action";
import { safeNextPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/url";
import { redirect } from "next/navigation";
import { z } from "zod";

const SignInSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Scrivi un indirizzo mail valido.")),
  password: z.string().optional(),
  intent: z.enum(["password", "link"]).default("password"),
  next: z.string().optional(),
});

export async function signIn(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = parseForm(SignInSchema, formData);
  if (!parsed.ok) return parsed.result;
  const { email, password, intent } = parsed.data;
  const next = safeNextPath(parsed.data.next);
  const supabase = await createClient();

  if (intent === "link") {
    const callback = `${await appUrl()}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: callback },
    });
    if (error?.status === 429) {
      return fail("Hai chiesto troppi link in poco tempo. Aspetta qualche minuto e riprova.");
    }
    if (error && !/signups? not allowed|user not found/i.test(error.message)) {
      console.error("[accedi] otp", error.status, error.message);
      return fail("Non siamo riusciti a inviare la mail. Riprova tra poco.");
    }
    // Same answer whether or not the address is registered.
    return ok(
      "Se l'indirizzo è registrato, tra poco ricevi una mail con il link per entrare. Aprilo da questo stesso browser; controlla anche lo spam.",
    );
  }

  if (!password)
    return fail("Scrivi la password, oppure chiedi un link via mail.", { password: "Manca la password." });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.status === 429) return fail("Troppi tentativi. Aspetta qualche minuto e riprova.");
    if (/email not confirmed/i.test(error.message)) {
      return fail(
        "Questo indirizzo non è ancora stato confermato. Apri il link che hai ricevuto alla registrazione, oppure chiedi qui sotto un link via mail per entrare.",
      );
    }
    if (error.status && error.status >= 500)
      return fail("Il servizio di accesso non risponde. Riprova tra poco.");
    return fail(
      "Mail o password non corrette. Se non ricordi la password usa «Password dimenticata?» oppure chiedi un link via mail.",
    );
  }
  // Invitations, registration data and the page this user belongs to.
  redirect((await completeSignIn(supabase, next)) ?? next);
}
