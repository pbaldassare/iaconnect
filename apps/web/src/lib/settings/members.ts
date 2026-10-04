/** Rules for changing the organization's users. Pure, unit tested. */

export interface MemberLike {
  id: string;
  user_id: string;
  role: string;
  permissions: unknown;
}

/** `memberships.permissions.manage`: a collaborator who may change connections and flows. */
export function hasManagePermission(permissions: unknown): boolean {
  return (
    typeof permissions === "object" &&
    permissions !== null &&
    (permissions as Record<string, unknown>).manage === true
  );
}

/** Stored permissions with `manage` set, other keys untouched. */
export function withManagePermission(permissions: unknown, manage: boolean): Record<string, unknown> {
  const base =
    typeof permissions === "object" && permissions !== null && !Array.isArray(permissions)
      ? (permissions as Record<string, unknown>)
      : {};
  return { ...base, manage };
}

/**
 * Why a member cannot be removed or demoted, or null when it is fine.
 * An organization must always keep at least one owner.
 */
export function memberChangeProblem(
  members: readonly MemberLike[],
  membershipId: string,
  change: "remove" | "demote",
): string | null {
  const target = members.find((member) => member.id === membershipId);
  if (!target) return "Questo utente non fa più parte dell'azienda.";
  const owners = members.filter((member) => member.role === "org_owner");
  if (target.role === "org_owner" && owners.length <= 1) {
    return change === "remove"
      ? "È l'unico titolare. Prima nomina un altro titolare, poi potrai togliere questo."
      : "È l'unico titolare: l'azienda deve averne almeno uno. Nomina prima un altro titolare.";
  }
  return null;
}
