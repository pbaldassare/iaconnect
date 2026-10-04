import "server-only";
import { writeAudit } from "@/lib/audit";
import { assertNotDemo } from "@/lib/demo/server";
import type { InviteMailOutcome } from "@/lib/invite-messages";
import { createServiceClient, hasServiceKey } from "@/lib/supabase/service";
import type { Db } from "@/lib/supabase/types";
import { appUrl } from "@/lib/url";

/**
 * Invites a person to an organization:
 * 1. writes (or re-opens) the `invitations` row through the caller's session
 *    client, so RLS decides whether the caller may invite;
 * 2. asks Supabase Auth to send the invitation mail (service key needed).
 * The row alone is enough for an existing user: `accept_invitations()` turns
 * it into a membership at the next sign-in.
 */
export async function inviteToOrganization(
  supabase: Db,
  input: {
    organizationId: string;
    email: string;
    role: "org_owner" | "org_member";
    invitedBy: string;
    actorType: "user" | "admin";
  },
): Promise<{ ok: false; error: unknown } | { ok: true; mail: InviteMailOutcome }> {
  const email = input.email.trim().toLowerCase();
  const { data: invitation, error } = await supabase
    .from("invitations")
    .upsert(
      {
        organization_id: input.organizationId,
        email,
        role: input.role,
        status: "pending",
        invited_by: input.invitedBy,
      },
      { onConflict: "organization_id,email" },
    )
    .select("id")
    .single();
  if (error) return { ok: false, error };

  // Never reached in the demo (the insert above is refused); kept as a second lock.
  await assertNotDemo();
  if (!hasServiceKey()) return { ok: true, mail: "no_key" };
  const { error: mailError } = await createServiceClient().auth.admin.inviteUserByEmail(email, {
    redirectTo: `${await appUrl()}/auth/callback?next=${encodeURIComponent("/imposta-password")}`,
  });
  if (mailError) {
    if (mailError.code === "email_exists" || /already (been )?registered/i.test(mailError.message)) {
      return { ok: true, mail: "existing" };
    }
    console.error("[invite] mail", mailError.status, mailError.message);
    return { ok: true, mail: "failed" };
  }
  await writeAudit(supabase, {
    organizationId: input.organizationId,
    actorId: input.invitedBy,
    actorType: input.actorType,
    action: "organization.invite_sent",
    entityType: "invitations",
    entityId: invitation.id,
    isSupportAccess: input.actorType === "admin",
  });
  return { ok: true, mail: "sent" };
}
