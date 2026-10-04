"use server";
import { completeSignIn } from "@/lib/access";
import { formToObject } from "@/lib/action";
import { WAITING_PATH } from "@/lib/landing-route";
import {
  COMPANY_NAME_MIN,
  HONEYPOT_FIELD,
  PASSWORD_MIN,
  REQUEST_LIMITS,
  REQUEST_SECTORS,
  STARTED_AT_FIELD,
  checkFormSubmission,
  registrationMetadata,
} from "@/lib/registration";
import { createClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/url";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { RegisterState, RegisterValues, ResendState } from "./state";

const Email = z.string().trim().toLowerCase().pipe(z.email("Scrivi un indirizzo mail valido."));

const RegisterSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, "Scrivi nome e cognome.")
    .max(REQUEST_LIMITS.fullName, "Il nome è troppo lungo."),
  company_name: z
    .string()
    .trim()
    .min(COMPANY_NAME_MIN, "Scrivi il nome dell'azienda.")
    .max(REQUEST_LIMITS.companyName, "Il nome dell'azienda è troppo lungo."),
  sector: z.enum(REQUEST_SECTORS, "Scegli un settore."),
  phone: z
    .string()
    .trim()
    .max(REQUEST_LIMITS.phone, "Il numero è troppo lungo.")
    .regex(/^$|^[+0-9][0-9 ()./-]{4,}$/, "Scrivi un numero di telefono valido, oppure lascia vuoto.")
    .default(""),
  email: Email,
  password: z
    .string()
    .min(PASSWORD_MIN, `Usa almeno ${PASSWORD_MIN} caratteri.`)
    .max(72, "Usa al massimo 72 caratteri."),
  message: z.string().trim().max(REQUEST_LIMITS.message, "La nota è troppo lunga.").default(""),
  privacy: z.literal("on", "Per registrarti devi confermare di aver letto l'informativa."),
});

/** Where the confirmation link of the sign-up mail comes back. */
async function confirmationRedirect(): Promise<string> {
  return `${await appUrl()}/auth/callback?next=${encodeURIComponent("/benvenuto")}`;
}

function typedValues(raw: Record<string, string | string[]>): RegisterValues {
  const pick = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string).slice(0, 1000) : "");
  return {
    full_name: pick("full_name"),
    company_name: pick("company_name"),
    sector: pick("sector"),
    phone: pick("phone"),
    email: pick("email"),
    message: pick("message"),
  };
}

/**
 * Public sign-up. Creates the Auth account with the form in `user_metadata` (so it survives
 * the confirmation mail); the access request itself is created by the database as soon as
 * the person is signed in with a confirmed address (lib/access.ts).
 * The answer is the same whether or not the address was already registered.
 */
export async function register(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const raw = formToObject(formData);
  const values = typedValues(raw);
  const back = (message: string, fieldErrors?: Record<string, string>): RegisterState => ({
    step: "form",
    message,
    fieldErrors,
    values,
  });

  const check = checkFormSubmission({
    honeypot: typeof raw[HONEYPOT_FIELD] === "string" ? (raw[HONEYPOT_FIELD] as string) : "",
    startedAt: typeof raw[STARTED_AT_FIELD] === "string" ? (raw[STARTED_AT_FIELD] as string) : "",
    now: Date.now(),
  });
  // A script filled the hidden field: answer as if it worked, do nothing.
  if (check === "honeypot") return { step: "sent", email: values.email.trim().toLowerCase().slice(0, 254) };
  if (check === "too_fast") {
    return back(
      "Hai inviato il modulo molto in fretta. Aspetta qualche secondo e premi di nuovo «Crea l'account».",
    );
  }
  if (check === "stale") {
    return back("La pagina è rimasta aperta a lungo. Controlla i dati e premi di nuovo «Crea l'account».");
  }

  const parsed = RegisterSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return back("Controlla i campi evidenziati.", fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: await confirmationRedirect(),
      data: registrationMetadata(
        {
          fullName: input.full_name,
          companyName: input.company_name,
          sector: input.sector,
          phone: input.phone || null,
          message: input.message || null,
        },
        new Date().toISOString(),
      ),
    },
  });

  if (error) {
    const code = error.code ?? "";
    if (code === "user_already_exists" || /already (been )?registered/i.test(error.message)) {
      // Same answer as for a new address: do not reveal who has an account.
      return { step: "sent", email: input.email };
    }
    if (error.status === 429 || /rate limit/i.test(error.message)) {
      return back("Ci sono state troppe registrazioni in poco tempo. Aspetta qualche minuto e riprova.");
    }
    if (code === "weak_password" || /weak|should be at least|should contain/i.test(error.message)) {
      return back("La password è troppo semplice.", {
        password: "Scegline una più lunga, con lettere maiuscole, minuscole e numeri.",
      });
    }
    if (code === "signup_disabled" || /signups? (not allowed|disabled)/i.test(error.message)) {
      return back("Le registrazioni non sono attive in questo momento. Riprova più tardi.");
    }
    if (/captcha/i.test(error.message)) {
      return back(
        "La registrazione richiede una verifica che questa pagina non offre ancora. Riprova più tardi.",
      );
    }
    console.error("[registrati] signUp", error.status, code, error.message);
    return back("Non siamo riusciti a creare l'account. Riprova tra poco.");
  }

  if (data.session) {
    // Mail confirmation is switched off in Supabase Auth: the person is already signed in.
    redirect((await completeSignIn(supabase, null)) ?? WAITING_PATH);
  }
  return { step: "sent", email: input.email };
}

/** «Rinvia la mail»: sends the confirmation mail again. Same answer for every address. */
export async function resendConfirmation(_prev: ResendState, formData: FormData): Promise<ResendState> {
  const parsed = Email.safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, message: "Indirizzo mail non valido: torna al modulo e riprova." };
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data,
    options: { emailRedirectTo: await confirmationRedirect() },
  });
  if (error) {
    if (error.status === 429 || /rate limit|security purposes/i.test(error.message)) {
      return { ok: false, message: "Hai appena chiesto una mail. Aspetta un minuto e riprova." };
    }
    console.error("[registrati] resend", error.status, error.code, error.message);
  }
  return {
    ok: true,
    message:
      "Se la registrazione è in attesa di conferma, la mail è stata inviata di nuovo. Controlla anche lo spam.",
  };
}
