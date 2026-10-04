"use server";
import { type ActionResult, fail, failFromError, ok } from "@/lib/action";
import { isUuid } from "@/lib/org-selection";
import { eurosToCents, parseLimit } from "@/lib/parse";
import { requirePlatformAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { LIMIT_FIELDS } from "./fields";

export async function savePlan(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase } = await requirePlatformAdmin();
  const id = formData.get("id");
  if (typeof id !== "string" || !isUuid(id)) return fail("Piano non valido.");

  const fieldErrors: Record<string, string> = {};
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 60) fieldErrors.name = "Scrivi un nome tra 2 e 60 caratteri.";
  const price = eurosToCents(String(formData.get("price") ?? ""));
  if (price === null) fieldErrors.price = "Scrivi un importo in euro, ad esempio 249 oppure 249,50.";

  const { data: current, error: readError } = await supabase
    .from("plans")
    .select("limits")
    .eq("id", id)
    .maybeSingle();
  if (readError) return failFromError(readError);
  if (!current) return fail("Questo piano non esiste più.");
  // Keep any extra key already stored; replace only the four limits of the form.
  const limits: Record<string, unknown> =
    typeof current.limits === "object" && current.limits !== null && !Array.isArray(current.limits)
      ? { ...current.limits }
      : {};
  for (const field of LIMIT_FIELDS) {
    const value = parseLimit(String(formData.get(field.key) ?? ""));
    if (value === null) fieldErrors[field.key] = "Scrivi un numero intero; -1 per nessun limite.";
    else limits[field.key] = value;
  }
  if (Object.keys(fieldErrors).length > 0) return fail("Controlla i campi evidenziati.", fieldErrors);

  const { error } = await supabase
    .from("plans")
    .update({
      name,
      price_monthly_cents: price!,
      limits: limits as Record<string, number>,
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  if (error) return failFromError(error);
  revalidatePath("/admin/piani");
  return ok("Piano salvato. I nuovi limiti valgono subito per le aziende che lo usano.");
}
