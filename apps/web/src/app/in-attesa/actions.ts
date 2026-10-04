"use server";
import { type ActionResult, fail, failFromError, parseForm } from "@/lib/action";
import { WAITING_PATH } from "@/lib/landing-route";
import {
  COMPANY_NAME_MIN,
  REQUEST_LIMITS,
  REQUEST_SECTORS,
  accessRequestErrorMessage,
  requestAccessArgs,
} from "@/lib/registration";
import { requireUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { z } from "zod";

const Schema = z.object({
  full_name: z.string().trim().max(REQUEST_LIMITS.fullName, "Il nome è troppo lungo.").default(""),
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
  message: z.string().trim().max(REQUEST_LIMITS.message, "La nota è troppo lunga.").default(""),
});

/**
 * Creates the signed-in user's access request, or rewrites it while it is pending or after a
 * rejection (/completa-registrazione and /in-attesa). The database function decides who may
 * ask: confirmed email, no organization yet, not already approved.
 */
export async function saveAccessRequest(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const parsed = parseForm(Schema, formData);
  if (!parsed.ok) return parsed.result;
  const input = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "request_access",
    requestAccessArgs({
      fullName: input.full_name || null,
      companyName: input.company_name,
      sector: input.sector,
      phone: input.phone || null,
      message: input.message || null,
    }),
  );
  if (error) {
    const message = accessRequestErrorMessage(error);
    if (message) {
      console.error("[in-attesa] request_access", error.code, error.message);
      return fail(message);
    }
    return failFromError(error);
  }
  redirect(`${WAITING_PATH}?inviata=1`);
}
