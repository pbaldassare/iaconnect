"use server";
import { type ActionResult, fail, failFromError, ok } from "@/lib/action";
import { grantConsent, revokeConsent } from "@/lib/contacts/consents";
import { parseCustomFields, parseEmails, parsePhones } from "@/lib/contacts/fields";
import { channelLabel, isChannel } from "@/lib/customer-labels";
import { isUuid } from "@/lib/org-selection";
import { requireOrg } from "@/lib/session";
import { type Json, normalizePhone } from "@ia-connect/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};
const list = (formData: FormData, name: string) =>
  formData.getAll(name).map((value) => (typeof value === "string" ? value : ""));

function readContactForm(formData: FormData):
  | { ok: false; result: ActionResult }
  | {
      ok: true;
      data: { full_name: string; phones: string[]; emails: string[]; custom_fields: Record<string, Json> };
    } {
  const fieldErrors: Record<string, string> = {};
  const fullName = text(formData, "full_name").slice(0, 120);
  if (fullName.length < 2) fieldErrors.full_name = "Scrivi il nome.";
  const phones = parsePhones(text(formData, "phones"), (raw) => normalizePhone(raw));
  if (phones.invalid.length > 0)
    fieldErrors.phones = `Non sembra un numero di telefono: ${phones.invalid.join(", ")}`;
  const emails = parseEmails(text(formData, "emails"));
  if (emails.invalid.length > 0)
    fieldErrors.emails = `Non sembra un indirizzo mail: ${emails.invalid.join(", ")}`;
  const custom = parseCustomFields(list(formData, "field_key"), list(formData, "field_value"));
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, result: fail("Controlla i campi evidenziati.", fieldErrors) };
  }
  if (custom.errors.length > 0) return { ok: false, result: fail(custom.errors.join(" ")) };
  return {
    ok: true,
    data: { full_name: fullName, phones: phones.phones, emails: emails.emails, custom_fields: custom.fields },
  };
}

export async function createContact(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, org } = await requireOrg();
  const parsed = readContactForm(formData);
  if (!parsed.ok) return parsed.result;
  const { data, error } = await supabase
    .from("contacts")
    .insert({ organization_id: org.organization.id, ...parsed.data })
    .select("id")
    .single();
  if (error) return failFromError(error);
  revalidatePath("/app/contatti");
  redirect(`/app/contatti/${data.id}`);
}

export async function updateContact(
  contactId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase, org } = await requireOrg();
  if (!isUuid(contactId)) return fail("Contatto non valido.");
  const parsed = readContactForm(formData);
  if (!parsed.ok) return parsed.result;
  const { data, error } = await supabase
    .from("contacts")
    .update(parsed.data)
    .eq("id", contactId)
    .eq("organization_id", org.organization.id)
    .select("id");
  if (error) return failFromError(error);
  if (!data || data.length === 0) return fail("Questo contatto non esiste più.");
  revalidatePath("/app/contatti");
  revalidatePath(`/app/contatti/${contactId}`);
  redirect(`/app/contatti/${contactId}`);
}

/** Records or revokes the consent for one channel. A revocation stays on record with date and source. */
export async function setConsent(
  contactId: string,
  channel: string,
  granted: boolean,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase, org } = await requireOrg();
  if (!isUuid(contactId) || !isChannel(channel)) return fail("Richiesta non valida.");
  const source = text(formData, "source").slice(0, 200);
  if (granted && source.length < 3) {
    return fail("Scrivi da dove viene il consenso, per esempio «Modulo firmato in agenzia».", {
      source: "Scrivi l'origine del consenso.",
    });
  }
  const { data: contact, error: readError } = await supabase
    .from("contacts")
    .select("consents")
    .eq("id", contactId)
    .eq("organization_id", org.organization.id)
    .maybeSingle();
  if (readError) return failFromError(readError);
  if (!contact) return fail("Questo contatto non esiste più.");
  const consents = granted
    ? grantConsent(contact.consents, channel, source)
    : revokeConsent(contact.consents, channel, source);
  const { error } = await supabase
    .from("contacts")
    .update({ consents: consents as Json })
    .eq("id", contactId)
    .eq("organization_id", org.organization.id);
  if (error) return failFromError(error);
  revalidatePath(`/app/contatti/${contactId}`);
  return ok(
    granted
      ? `Consenso per ${channelLabel(channel)} registrato.`
      : `Consenso per ${channelLabel(channel)} revocato: su questo canale non parte più nulla.`,
  );
}

export async function saveMemory(
  contactId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase, org } = await requireOrg();
  if (!isUuid(contactId)) return fail("Contatto non valido.");
  const memory = text(formData, "memory");
  if (memory.length > 4000) return fail("La memoria è troppo lunga: al massimo 4.000 caratteri.");
  const { error } = await supabase
    .from("contacts")
    .update({ memory })
    .eq("id", contactId)
    .eq("organization_id", org.organization.id);
  if (error) return failFromError(error);
  revalidatePath(`/app/contatti/${contactId}`);
  return ok("Memoria salvata.");
}

/** GDPR erasure: the database cascades to conversations, messages, deals and appointments. */
export async function deleteContact(
  contactId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase, org } = await requireOrg();
  if (!isUuid(contactId)) return fail("Contatto non valido.");
  if (text(formData, "confirm").toUpperCase() !== "ELIMINA") {
    return fail("Per confermare scrivi ELIMINA nel campo.", { confirm: "Scrivi ELIMINA." });
  }
  const { data, error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", contactId)
    .eq("organization_id", org.organization.id)
    .select("id");
  if (error) return failFromError(error);
  if (!data || data.length === 0) return fail("Questo contatto non esiste più.");
  revalidatePath("/app/contatti");
  revalidatePath("/app/inbox");
  revalidatePath("/app/trattative");
  redirect("/app/contatti?eliminato=1");
}
