"use server";
import { type ActionResult, fail, parseForm } from "@/lib/action";
import { LANDING_PATH } from "@/lib/routes";
import { requireUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { z } from "zod";

const Schema = z
  .object({
    password: z.string().min(10, "Usa almeno 10 caratteri."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Le due password non coincidono." });

export async function setPassword(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const parsed = parseForm(Schema, formData);
  if (!parsed.ok) return parsed.result;
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (/weak|should be|at least/i.test(error.message)) {
      return fail("La password è troppo semplice. Usane una più lunga, con lettere e numeri.");
    }
    if (/different from the old/i.test(error.message))
      return fail("La nuova password è uguale a quella attuale.");
    console.error("[imposta-password]", error.status, error.message);
    return fail("Non siamo riusciti a salvare la password. Esci, rientra con un link via mail e riprova.");
  }
  redirect(LANDING_PATH);
}
