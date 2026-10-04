"use server";
import { type ActionResult, fail, failFromError, ok } from "@/lib/action";
import { buildDealFieldDefs } from "@/lib/deals/stages";
import { requireOrgManager } from "@/lib/session";
import { buildOrgBrand } from "@/lib/settings/brand";
import { type Json, normalizePhone } from "@ia-connect/core";
import { revalidatePath } from "next/cache";

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};
const list = (formData: FormData, name: string) =>
  formData.getAll(name).map((value) => (typeof value === "string" ? value : ""));

export async function saveAssistant(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, org } = await requireOrgManager();
  const tone = text(formData, "ai_tone").slice(0, 300);
  const instructions = text(formData, "ai_instructions");
  const outOfScope = text(formData, "out_of_scope_reply");
  const disclosure = text(formData, "ai_disclosure");
  const fieldErrors: Record<string, string> = {};
  if (instructions.length > 4000) fieldErrors.ai_instructions = "Al massimo 4.000 caratteri.";
  if (outOfScope.length < 5)
    fieldErrors.out_of_scope_reply = "Scrivi la frase da usare: non può restare vuota.";
  if (outOfScope.length > 500) fieldErrors.out_of_scope_reply = "Al massimo 500 caratteri.";
  if (disclosure.length < 5)
    fieldErrors.ai_disclosure = "Scrivi la frase: chi riceve un messaggio automatico deve saperlo.";
  if (disclosure.length > 300) fieldErrors.ai_disclosure = "Al massimo 300 caratteri.";
  if (Object.keys(fieldErrors).length > 0) return fail("Controlla i campi evidenziati.", fieldErrors);
  const { error } = await supabase
    .from("org_settings")
    .update({
      ai_tone: tone || null,
      ai_instructions: instructions || null,
      out_of_scope_reply: outOfScope,
      ai_disclosure: disclosure,
    })
    .eq("organization_id", org.organization.id);
  if (error) return failFromError(error);
  revalidatePath("/app/impostazioni/assistente");
  return ok("Salvato. Vale dalle prossime risposte dell'IA.");
}

export async function saveBrand(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, org } = await requireOrgManager();
  const { data: settings, error: readError } = await supabase
    .from("org_settings")
    .select("brand")
    .eq("organization_id", org.organization.id)
    .maybeSingle();
  if (readError) return failFromError(readError);
  const built = buildOrgBrand(
    {
      name: text(formData, "name"),
      logoUrl: text(formData, "logoUrl"),
      accent: text(formData, "accent"),
      ownerPhone: text(formData, "ownerPhone"),
      ownerEmail: text(formData, "ownerEmail"),
    },
    settings?.brand,
    (raw) => normalizePhone(raw),
  );
  if (!built.ok) return fail("Controlla i campi evidenziati.", built.errors);
  const { error } = await supabase
    .from("org_settings")
    .update({ brand: built.brand as Json })
    .eq("organization_id", org.organization.id);
  if (error) return failFromError(error);
  revalidatePath("/app", "layout");
  return ok("Marchio salvato.");
}

export async function saveDealFields(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, org } = await requireOrgManager();
  const keys = list(formData, "def_key");
  const labels = list(formData, "def_label");
  const types = list(formData, "def_type");
  const built = buildDealFieldDefs(
    labels.map((label, index) => ({ key: keys[index] ?? "", label, type: types[index] ?? "text" })),
  );
  if (built.errors.length > 0) return fail(built.errors.join(" "));
  if (built.defs.length > 30) return fail("Al massimo 30 campi.");
  const { error } = await supabase
    .from("org_settings")
    .update({ deal_custom_fields: built.defs as unknown as Json })
    .eq("organization_id", org.organization.id);
  if (error) return failFromError(error);
  revalidatePath("/app/impostazioni/campi");
  revalidatePath("/app/trattative");
  return ok("Campi salvati. Li trovi nella scheda di ogni trattativa.");
}
