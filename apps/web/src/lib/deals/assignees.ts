import "server-only";
import { peopleNames } from "@/lib/people";
import type { OrgContext } from "@/lib/session";

/**
 * People a deal can be assigned to. Managers read every membership; a collaborator
 * reads only their own (RLS), so they can assign to themselves or keep the current person.
 */
export async function loadAssignees(
  context: OrgContext,
  alsoInclude: readonly (string | null | undefined)[] = [],
): Promise<{ id: string; label: string }[]> {
  const { supabase, org, session } = context;
  const { data } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("organization_id", org.organization.id)
    .limit(200);
  const ids = new Set<string>((data ?? []).map((m) => m.user_id));
  if (org.mode === "member") ids.add(session.user.id);
  for (const id of alsoInclude) if (id) ids.add(id);
  const nameOf = await peopleNames([...ids], session.user);
  return [...ids]
    .map((id) => ({ id, label: nameOf(id) }))
    .sort((a, b) => (a.label === "Tu" ? -1 : b.label === "Tu" ? 1 : a.label.localeCompare(b.label, "it")));
}
