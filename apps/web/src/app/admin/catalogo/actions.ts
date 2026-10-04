"use server";
import { type ActionResult, fail, failFromError, ok } from "@/lib/action";
import { isUuid } from "@/lib/org-selection";
import { requirePlatformAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";

export async function saveConnectorType(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase } = await requirePlatformAdmin();
  const key = formData.get("key");
  if (typeof key !== "string" || !/^[a-z0-9_]{1,64}$/.test(key)) return fail("Connettore non valido.");
  const { data: plans, error: plansError } = await supabase.from("plans").select("key");
  if (plansError) return failFromError(plansError);
  const known = new Set((plans ?? []).map((p) => p.key));
  const chosen = formData.getAll("plans").filter((v): v is string => typeof v === "string" && known.has(v));
  // No plan ticked, or all of them, means "every plan" (stored as null).
  const allowedPlans = chosen.length === 0 || chosen.length === known.size ? null : chosen;
  const { error } = await supabase
    .from("connector_types")
    .update({ is_enabled: formData.get("is_enabled") === "on", allowed_plans: allowedPlans })
    .eq("key", key);
  if (error) return failFromError(error);
  revalidatePath("/admin/catalogo");
  return ok("Salvato.");
}

export async function setTemplatePublished(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase } = await requirePlatformAdmin();
  const id = formData.get("id");
  const publish = formData.get("publish") === "1";
  if (typeof id !== "string" || !isUuid(id)) return fail("Modello non valido.");
  const { error } = await supabase.from("flow_templates").update({ is_published: publish }).eq("id", id);
  if (error) return failFromError(error);
  revalidatePath("/admin/catalogo");
  return ok(
    publish
      ? "Modello pubblicato: i clienti del settore lo vedono in libreria."
      : "Modello ritirato dalla libreria.",
  );
}
