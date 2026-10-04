"use server";
import { type ActionResult, fail, failFromError, ok, parseForm } from "@/lib/action";
import { inviteToOrganization } from "@/lib/invitations";
import { inviteOutcomeMessage } from "@/lib/invite-messages";
import { isUuid } from "@/lib/org-selection";
import { actorOf, requireOrgManager } from "@/lib/session";
import { memberChangeProblem, withManagePermission } from "@/lib/settings/members";
import type { Json } from "@ia-connect/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const PATH = "/app/impostazioni/utenti";

const InviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Scrivi un indirizzo mail valido.")),
  role: z.enum(["org_owner", "org_member"], "Scegli un ruolo."),
});

export async function inviteMember(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const context = await requireOrgManager();
  const parsed = parseForm(InviteSchema, formData);
  if (!parsed.ok) return parsed.result;
  const actor = actorOf(context);
  const invite = await inviteToOrganization(context.supabase, {
    organizationId: context.org.organization.id,
    email: parsed.data.email,
    role: parsed.data.role,
    invitedBy: actor.id,
    actorType: actor.type,
  });
  if (!invite.ok) return failFromError(invite.error);
  revalidatePath(PATH);
  // An invitation whose mail did not leave is still registered: the message says what to do next.
  return ok(inviteOutcomeMessage(invite.mail, parsed.data.email).text);
}

export async function revokeInvitation(invitationId: string, _prev: ActionResult): Promise<ActionResult> {
  const { supabase, org } = await requireOrgManager();
  if (!isUuid(invitationId)) return fail("Invito non valido.");
  const { error } = await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("organization_id", org.organization.id)
    .eq("status", "pending");
  if (error) return failFromError(error);
  revalidatePath(PATH);
  return ok("Invito revocato.");
}

async function loadMembers() {
  const context = await requireOrgManager();
  const { data, error } = await context.supabase
    .from("memberships")
    .select("id, user_id, role, permissions")
    .eq("organization_id", context.org.organization.id);
  return { context, members: data ?? [], error };
}

export async function changeRole(
  membershipId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { context, members, error: readError } = await loadMembers();
  if (readError) return failFromError(readError);
  const role = formData.get("role");
  if (role !== "org_owner" && role !== "org_member") return fail("Scegli un ruolo.");
  const target = members.find((member) => member.id === membershipId);
  if (!target) return fail("Questo utente non fa più parte dell'azienda.");
  if (target.role === role) return ok("Il ruolo era già questo.");
  if (role === "org_member") {
    const problem = memberChangeProblem(members, membershipId, "demote");
    if (problem) return fail(problem);
  }
  const { error } = await context.supabase
    .from("memberships")
    .update({ role })
    .eq("id", membershipId)
    .eq("organization_id", context.org.organization.id);
  if (error) return failFromError(error);
  revalidatePath(PATH);
  return ok(role === "org_owner" ? "Ora è titolare." : "Ora è collaboratore.");
}

export async function setManagePermission(
  membershipId: string,
  manage: boolean,
  _prev: ActionResult,
): Promise<ActionResult> {
  const { context, members, error: readError } = await loadMembers();
  if (readError) return failFromError(readError);
  const target = members.find((member) => member.id === membershipId);
  if (!target) return fail("Questo utente non fa più parte dell'azienda.");
  const { error } = await context.supabase
    .from("memberships")
    .update({ permissions: withManagePermission(target.permissions, manage) as Json })
    .eq("id", membershipId)
    .eq("organization_id", context.org.organization.id);
  if (error) return failFromError(error);
  revalidatePath(PATH);
  return ok(
    manage
      ? "Ora può gestire collegamenti, flussi e impostazioni."
      : "Non può più gestire collegamenti e flussi: continua a usare inbox, contatti e trattative.",
  );
}

export async function removeMember(membershipId: string, _prev: ActionResult): Promise<ActionResult> {
  const { context, members, error: readError } = await loadMembers();
  if (readError) return failFromError(readError);
  const problem = memberChangeProblem(members, membershipId, "remove");
  if (problem) return fail(problem);
  const { error } = await context.supabase
    .from("memberships")
    .delete()
    .eq("id", membershipId)
    .eq("organization_id", context.org.organization.id);
  if (error) return failFromError(error);
  revalidatePath(PATH);
  return ok("Utente tolto dall'azienda. Non può più entrare.");
}
