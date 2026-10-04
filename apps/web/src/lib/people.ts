import "server-only";
import { shortId } from "@/lib/format";
import { resolveUserEmails } from "@/lib/users";

/**
 * Display names for the organization's users (assignees, authors). Auth users are
 * not readable through RLS: with SUPABASE_SERVICE_ROLE_KEY the mail is shown,
 * without it a short id. Call it only with ids read from the current organization's rows.
 */
export async function peopleNames(
  userIds: readonly (string | null | undefined)[],
  currentUser: { id: string; email: string },
): Promise<(id: string | null | undefined) => string> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id) && id !== currentUser.id))];
  const emails = await resolveUserEmails(ids);
  return (id) => {
    if (!id) return "Nessuno";
    if (id === currentUser.id) return "Tu";
    return emails.get(id) ?? `Utente ${shortId(id)}`;
  };
}
