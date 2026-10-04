"use server";
import { type ActionResult, fail, failFromError, ok } from "@/lib/action";
import { TEMPLATE_APPROVAL_KEYS, isChannel } from "@/lib/customer-labels";
import { missingPlaceholders, normalizeTemplateLanguage, variableCount } from "@/lib/message-templates";
import { isUuid } from "@/lib/org-selection";
import { requireOrgManager } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const PATH = "/app/impostazioni/modelli";

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

function readTemplateForm(formData: FormData, channel: string) {
  const fieldErrors: Record<string, string> = {};
  const name = text(formData, "name").slice(0, 80);
  const language = normalizeTemplateLanguage(text(formData, "language") || "it");
  const subject = text(formData, "subject").slice(0, 200);
  const body = text(formData, "body");
  const externalName = text(formData, "external_name").slice(0, 120);
  const status = text(formData, "approval_status");
  if (name.length < 2) fieldErrors.name = "Scrivi un nome.";
  if (!language) fieldErrors.language = "Usa un codice come it, en o en_US.";
  if (body.length < 2) fieldErrors.body = "Scrivi il testo del messaggio.";
  if (body.length > 4000) fieldErrors.body = "Al massimo 4.000 caratteri.";
  const missing = missingPlaceholders(channel === "mail" ? subject : "", body);
  if (missing.length > 0) {
    fieldErrors.body = `I valori vanno numerati di seguito a partire da {{1}}: manca ${missing.map((n) => `{{${n}}}`).join(", ")}.`;
  }
  if (variableCount(body, subject) > 20) fieldErrors.body = "Al massimo 20 valori da riempire.";
  const isWhatsapp = channel === "whatsapp";
  if (isWhatsapp && externalName && !/^[a-z0-9_]+$/.test(externalName)) {
    fieldErrors.external_name = "Su Meta i nomi dei modelli hanno solo lettere minuscole, numeri e _.";
  }
  if (isWhatsapp && !(TEMPLATE_APPROVAL_KEYS as readonly string[]).includes(status)) {
    fieldErrors.approval_status = "Scegli lo stato.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false as const, result: fail("Controlla i campi evidenziati.", fieldErrors) };
  }
  return {
    ok: true as const,
    data: {
      name,
      language: language ?? "it",
      subject: channel === "mail" && subject ? subject : null,
      body,
      external_name: isWhatsapp && externalName ? externalName : null,
      // Only WhatsApp has an approval step: the other channels can always use their templates.
      approval_status: isWhatsapp ? status : "approved",
    },
  };
}

const DUPLICATE = "Esiste già un modello con questo nome per questo canale. Scegli un altro nome.";

export async function createTemplate(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, org } = await requireOrgManager();
  const channel = text(formData, "channel");
  if (!isChannel(channel)) return fail("Scegli il canale.", { channel: "Scegli il canale." });
  const parsed = readTemplateForm(formData, channel);
  if (!parsed.ok) return parsed.result;
  const { error } = await supabase
    .from("message_templates")
    .insert({ organization_id: org.organization.id, channel, ...parsed.data });
  if (error)
    return error.code === "23505" ? fail(DUPLICATE, { name: "Nome già usato." }) : failFromError(error);
  revalidatePath(PATH);
  redirect(`${PATH}?canale=${channel}`);
}

export async function updateTemplate(
  templateId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase, org } = await requireOrgManager();
  if (!isUuid(templateId)) return fail("Modello non valido.");
  const { data: template, error: readError } = await supabase
    .from("message_templates")
    .select("id, channel")
    .eq("id", templateId)
    .eq("organization_id", org.organization.id)
    .maybeSingle();
  if (readError) return failFromError(readError);
  if (!template) return fail("Questo modello non esiste più.");
  const parsed = readTemplateForm(formData, template.channel);
  if (!parsed.ok) return parsed.result;
  const { error } = await supabase
    .from("message_templates")
    .update(parsed.data)
    .eq("id", template.id)
    .eq("organization_id", org.organization.id);
  if (error)
    return error.code === "23505" ? fail(DUPLICATE, { name: "Nome già usato." }) : failFromError(error);
  revalidatePath(PATH);
  revalidatePath(`${PATH}/${template.id}`);
  return ok("Modello salvato.");
}

export async function deleteTemplate(templateId: string, _prev: ActionResult): Promise<ActionResult> {
  const { supabase, org } = await requireOrgManager();
  if (!isUuid(templateId)) return fail("Modello non valido.");
  const { error } = await supabase
    .from("message_templates")
    .delete()
    .eq("id", templateId)
    .eq("organization_id", org.organization.id);
  if (error) return failFromError(error);
  revalidatePath(PATH);
  redirect(PATH);
}
