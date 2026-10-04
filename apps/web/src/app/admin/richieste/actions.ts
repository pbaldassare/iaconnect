"use server";
import { type ActionResult, fail, failFromError, ok, parseForm } from "@/lib/action";
import { isUuid } from "@/lib/org-selection";
import { accessRequestErrorMessage } from "@/lib/registration";
import { requirePlatformAdmin } from "@/lib/session";
import type { Db } from "@/lib/supabase/types";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const ApproveSchema = z.object({
  plan_key: z.string().trim().min(1, "Scegli un piano.").max(60),
});
const RejectSchema = z.object({
  note: z
    .string()
    .trim()
    .min(3, "Scrivi il motivo: la persona lo legge nella propria pagina.")
    .max(1000, "La nota è troppo lunga."),
});

async function decide(
  supabase: Db,
  args: { p_request: string; p_approve: boolean; p_plan_key?: string; p_note?: string | null },
): Promise<ActionResult | null> {
  const { error } = await supabase.rpc("decide_access_request", args);
  if (!error) return null;
  const message = accessRequestErrorMessage(error);
  if (message) {
    console.error("[admin/richieste]", error.code, error.message);
    return fail(message);
  }
  return failFromError(error);
}

/** «Approva»: the database creates the organization and makes the requester its owner. */
export async function approveAccessRequest(
  requestId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requirePlatformAdmin();
  if (!isUuid(requestId)) return fail("Richiesta non valida. Ricarica la pagina.");
  const parsed = parseForm(ApproveSchema, formData);
  if (!parsed.ok) return parsed.result;
  const failure = await decide(supabase, {
    p_request: requestId,
    p_approve: true,
    p_plan_key: parsed.data.plan_key,
  });
  if (failure) return failure;
  revalidatePath("/admin", "layout");
  return ok("Azienda creata. Avvisa la persona: non parte una mail automatica.");
}

/** «Rifiuta»: the note is shown to the requester, who may correct the data and ask again. */
export async function rejectAccessRequest(
  requestId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requirePlatformAdmin();
  if (!isUuid(requestId)) return fail("Richiesta non valida. Ricarica la pagina.");
  const parsed = parseForm(RejectSchema, formData);
  if (!parsed.ok) return parsed.result;
  const failure = await decide(supabase, {
    p_request: requestId,
    p_approve: false,
    p_note: parsed.data.note,
  });
  if (failure) return failure;
  revalidatePath("/admin", "layout");
  return ok("Richiesta rifiutata.");
}
