"use server";
import { type ActionResult, fail, failFromError, ok, parseForm } from "@/lib/action";
import { brandToJson, parseAccent, parseLogoUrl } from "@/lib/brand";
import { KNOWN_FEATURES, isFeatureEnabled } from "@/lib/features";
import { inviteToOrganization } from "@/lib/invitations";
import { inviteOutcomeMessage } from "@/lib/invite-messages";
import { setOrgCookie } from "@/lib/org-cookie";
import { isUuid } from "@/lib/org-selection";
import { requirePlatformAdmin, requireStaffForOrg } from "@/lib/session";
import { SECTORS } from "@ia-connect/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

/**
 * Actions of the organization page. Each one re-checks that the caller is
 * staff for this organization (requireStaffForOrg); RLS enforces it again.
 * The organization id is bound on the server: `action.bind(null, organization.id)`.
 */

function refresh(organizationId: string) {
  revalidatePath(`/admin/aziende/${organizationId}`);
}

const UpdateSchema = z.object({
  name: z.string().trim().min(2, "Scrivi il nome dell'azienda.").max(120, "Il nome è troppo lungo."),
  sector: z.enum(SECTORS, "Scegli un settore."),
  plan_id: z.uuid("Scegli un piano."),
});

export async function updateOrganization(
  organizationId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requireStaffForOrg(organizationId);
  const parsed = parseForm(UpdateSchema, formData);
  if (!parsed.ok) return parsed.result;
  const { error } = await supabase.from("organizations").update(parsed.data).eq("id", organizationId);
  if (error) return failFromError(error);
  refresh(organizationId);
  return ok("Dati salvati.");
}

export async function setOrganizationStatus(
  organizationId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requireStaffForOrg(organizationId);
  const status = formData.get("status");
  if (status !== "active" && status !== "suspended") return fail("Stato non valido.");
  const { error } = await supabase.from("organizations").update({ status }).eq("id", organizationId);
  if (error) return failFromError(error);
  refresh(organizationId);
  return ok(
    status === "suspended"
      ? "Azienda sospesa: i suoi utenti non possono più entrare."
      : "Azienda riattivata: i suoi utenti possono di nuovo entrare.",
  );
}

const InviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Scrivi un indirizzo mail valido.")),
  role: z.enum(["org_owner", "org_member"], "Scegli un ruolo."),
});

export async function inviteMember(
  organizationId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase, session } = await requireStaffForOrg(organizationId);
  const parsed = parseForm(InviteSchema, formData);
  if (!parsed.ok) return parsed.result;
  const invite = await inviteToOrganization(supabase, {
    organizationId,
    email: parsed.data.email,
    role: parsed.data.role,
    invitedBy: session.user.id,
    actorType: "admin",
  });
  if (!invite.ok) return failFromError(invite.error);
  refresh(organizationId);
  const message = inviteOutcomeMessage(invite.mail, parsed.data.email);
  // A registered invitation whose mail did not leave is still a success, with instructions.
  return ok(message.text);
}

export async function revokeInvitation(
  organizationId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requireStaffForOrg(organizationId);
  const invitationId = formData.get("invitation_id");
  if (typeof invitationId !== "string" || !isUuid(invitationId)) return fail("Invito non valido.");
  const { error } = await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("organization_id", organizationId)
    .eq("status", "pending");
  if (error) return failFromError(error);
  refresh(organizationId);
  return ok("Invito revocato.");
}

export async function removeMember(
  organizationId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requireStaffForOrg(organizationId);
  const membershipId = formData.get("membership_id");
  if (typeof membershipId !== "string" || !isUuid(membershipId)) return fail("Utente non valido.");
  const { data: members, error: readError } = await supabase
    .from("memberships")
    .select("id, role")
    .eq("organization_id", organizationId);
  if (readError) return failFromError(readError);
  const target = members?.find((m) => m.id === membershipId);
  if (!target) return fail("Questo utente non fa più parte dell'azienda.");
  const owners = members?.filter((m) => m.role === "org_owner") ?? [];
  if (target.role === "org_owner" && owners.length === 1) {
    return fail("È l'unico titolare. Prima invita un altro titolare, poi potrai togliere questo.");
  }
  const { error } = await supabase
    .from("memberships")
    .delete()
    .eq("id", membershipId)
    .eq("organization_id", organizationId);
  if (error) return failFromError(error);
  refresh(organizationId);
  return ok("Utente tolto dall'azienda.");
}

export async function markConnectionDisconnected(
  organizationId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requireStaffForOrg(organizationId);
  const connectionId = formData.get("connection_id");
  if (typeof connectionId !== "string" || !isUuid(connectionId)) return fail("Collegamento non valido.");
  const { error } = await supabase
    .from("connections")
    .update({ status: "disconnected" })
    .eq("id", connectionId)
    .eq("organization_id", organizationId);
  if (error) return failFromError(error);
  refresh(organizationId);
  return ok(
    "Collegamento segnato come scollegato. I flussi che lo usano si fermano finché il cliente non lo ricollega.",
  );
}

export async function saveFeatures(
  organizationId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requireStaffForOrg(organizationId);
  const { data: current, error: readError } = await supabase
    .from("org_features")
    .select("feature_key, enabled")
    .eq("organization_id", organizationId);
  if (readError) return failFromError(readError);
  // Only write what changed, so the audit log shows real changes.
  const changes = KNOWN_FEATURES.map((feature) => ({
    organization_id: organizationId,
    feature_key: feature.key,
    enabled: formData.get(`feature:${feature.key}`) === "on",
  })).filter((row) => row.enabled !== isFeatureEnabled(current ?? [], row.feature_key));
  if (changes.length === 0) return ok("Nessuna modifica da salvare.");
  const { error } = await supabase
    .from("org_features")
    .upsert(changes, { onConflict: "organization_id,feature_key" });
  if (error) return failFromError(error);
  refresh(organizationId);
  return ok(changes.length === 1 ? "Funzione aggiornata." : `${changes.length} funzioni aggiornate.`);
}

const SettingsSchema = z.object({
  ai_tone: z.string().trim().max(300, "Massimo 300 caratteri."),
  ai_instructions: z.string().trim().max(4000, "Massimo 4000 caratteri."),
  out_of_scope_reply: z
    .string()
    .trim()
    .min(1, "Questo testo non può restare vuoto.")
    .max(600, "Massimo 600 caratteri."),
  ai_disclosure: z
    .string()
    .trim()
    .min(1, "Questo testo non può restare vuoto.")
    .max(200, "Massimo 200 caratteri."),
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

export async function saveSettings(
  organizationId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requireStaffForOrg(organizationId);
  const parsed = parseForm(SettingsSchema, formData);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const { error } = await supabase.from("org_settings").upsert(
    {
      organization_id: organizationId,
      ai_tone: v.ai_tone || null,
      ai_instructions: v.ai_instructions || null,
      out_of_scope_reply: v.out_of_scope_reply,
      ai_disclosure: v.ai_disclosure,
      brand: brandToJson({ name: v.brand_name, logoUrl: v.brand_logo, accent: v.brand_accent }),
    },
    { onConflict: "organization_id" },
  );
  if (error) return failFromError(error);
  refresh(organizationId);
  return ok("Personalizzazioni salvate.");
}

const SupportSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Scrivi in breve perché entri: il cliente lo vedrà nel registro.")
    .max(300),
});

/** "Accesso in assistenza": records who enters and why, then opens the customer area as that organization. */
export async function startSupportSession(
  organizationId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase, session } = await requireStaffForOrg(organizationId);
  const isMember = session.memberships.some((m) => m.organization_id === organizationId);
  if (!isMember) {
    const parsed = parseForm(SupportSchema, formData);
    if (!parsed.ok) return parsed.result;
    const now = new Date().toISOString();
    // One open session at a time per admin.
    const { error: closeError } = await supabase
      .from("support_sessions")
      .update({ ended_at: now })
      .eq("admin_user_id", session.user.id)
      .is("ended_at", null);
    if (closeError) return failFromError(closeError);
    const { error } = await supabase.from("support_sessions").insert({
      organization_id: organizationId,
      admin_user_id: session.user.id,
      reason: parsed.data.reason,
    });
    if (error) return failFromError(error);
  }
  await setOrgCookie(organizationId);
  redirect("/app");
}

export async function deleteOrganization(
  organizationId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requirePlatformAdmin();
  if (!isUuid(organizationId)) return fail("Azienda non valida.");
  const { data: organization, error: readError } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();
  if (readError) return failFromError(readError);
  if (!organization) return fail("Questa azienda non esiste più.");
  const typed = String(formData.get("confirm") ?? "").trim();
  if (typed !== organization.name.trim()) {
    return fail("Il nome non coincide. Scrivilo esattamente come compare sopra.", {
      confirm: "Il nome non coincide.",
    });
  }
  const { error } = await supabase.rpc("delete_organization", { p_org: organizationId });
  if (error) return failFromError(error);
  revalidatePath("/admin/aziende");
  redirect(`/admin/aziende?eliminata=${encodeURIComponent(organization.name)}`);
}
