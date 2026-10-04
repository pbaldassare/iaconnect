"use server";
import { type ActionResult, fail, failFromError, ok, parseForm } from "@/lib/action";
import { brandToJson, parseAccent, parseLogoUrl } from "@/lib/brand";
import { isUuid } from "@/lib/org-selection";
import { slugify } from "@/lib/parse";
import { requirePlatformAdmin } from "@/lib/session";
import { hasServiceKey } from "@/lib/supabase/service";
import { findUserIdByEmail } from "@/lib/users";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const CreateSchema = z.object({
  name: z.string().trim().min(2, "Scrivi il nome del rivenditore.").max(80, "Il nome è troppo lungo."),
  slug: z.string().trim().max(48),
});

export async function createReseller(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase } = await requirePlatformAdmin();
  const parsed = parseForm(CreateSchema, formData);
  if (!parsed.ok) return parsed.result;
  const slug = slugify(parsed.data.slug || parsed.data.name);
  if (slug.length < 2)
    return fail("Controlla i campi evidenziati.", { slug: "Usa lettere e numeri, almeno due." });
  const { data, error } = await supabase
    .from("resellers")
    .insert({ name: parsed.data.name, slug })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return fail("Esiste già un rivenditore con questo identificativo.", {
        slug: "Già usato: scegline un altro.",
      });
    }
    return failFromError(error);
  }
  revalidatePath("/admin/rivenditori");
  redirect(`/admin/rivenditori/${data.id}`);
}

const UpdateSchema = z.object({
  name: z.string().trim().min(2, "Scrivi il nome del rivenditore.").max(80, "Il nome è troppo lungo."),
  status: z.enum(["active", "suspended"]),
  brand_name: z.string().trim().max(60, "Massimo 60 caratteri."),
  brand_logo: z
    .string()
    .trim()
    .refine((v) => v === "" || parseLogoUrl(v) !== null, "Serve un indirizzo che inizia con https://"),
  brand_accent: z
    .string()
    .trim()
    .refine((v) => v === "" || parseAccent(v) !== null, "Scrivi un colore come #06724f."),
});

export async function updateReseller(
  resellerId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requirePlatformAdmin();
  if (!isUuid(resellerId)) return fail("Rivenditore non valido.");
  const parsed = parseForm(UpdateSchema, formData);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const { error } = await supabase
    .from("resellers")
    .update({
      name: v.name,
      status: v.status,
      brand: brandToJson({ name: v.brand_name, logoUrl: v.brand_logo, accent: v.brand_accent }),
    })
    .eq("id", resellerId);
  if (error) return failFromError(error);
  revalidatePath(`/admin/rivenditori/${resellerId}`);
  revalidatePath("/admin/rivenditori");
  return ok("Rivenditore salvato.");
}

const AdminSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Scrivi un indirizzo mail valido.")),
});

export async function addResellerAdmin(
  resellerId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requirePlatformAdmin();
  if (!isUuid(resellerId)) return fail("Rivenditore non valido.");
  const parsed = parseForm(AdminSchema, formData);
  if (!parsed.ok) return parsed.result;
  if (!hasServiceKey()) {
    return fail(
      "Per cercare un utente dalla mail serve la chiave di servizio Supabase, che su questo server non è configurata. Imposta SUPABASE_SERVICE_ROLE_KEY e riprova.",
    );
  }
  let userId: string | null;
  try {
    userId = await findUserIdByEmail(parsed.data.email);
  } catch (error) {
    return failFromError(error);
  }
  if (!userId) {
    return fail(
      "Nessun utente registrato con questa mail. Qui si possono aggiungere solo persone che hanno già un account: falla prima accedere (o creala da Supabase → Authentication), poi riprova.",
      { email: "Utente non trovato." },
    );
  }
  const { error } = await supabase
    .from("memberships")
    .insert({ user_id: userId, reseller_id: resellerId, role: "reseller_admin" });
  if (error) {
    if (error.code === "23505") return fail("Questa persona è già amministratore del rivenditore.");
    return failFromError(error);
  }
  revalidatePath(`/admin/rivenditori/${resellerId}`);
  return ok("Amministratore aggiunto. Vedrà l'area admin al prossimo accesso.");
}

export async function removeResellerAdmin(
  resellerId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requirePlatformAdmin();
  const membershipId = formData.get("membership_id");
  if (!isUuid(resellerId) || typeof membershipId !== "string" || !isUuid(membershipId)) {
    return fail("Amministratore non valido.");
  }
  const { error } = await supabase
    .from("memberships")
    .delete()
    .eq("id", membershipId)
    .eq("reseller_id", resellerId)
    .eq("role", "reseller_admin");
  if (error) return failFromError(error);
  revalidatePath(`/admin/rivenditori/${resellerId}`);
  return ok("Amministratore tolto.");
}
