import "server-only";
import { DEMO_USER_EMAILS } from "@/lib/demo/fixtures";
import { assertNotDemo, isDemoRequest } from "@/lib/demo/server";
import { createServiceClient, hasServiceKey } from "@/lib/supabase/service";
import { confirmedUserByEmail } from "@/lib/users-match";

/**
 * Auth users are not readable through RLS: these helpers use the service
 * client and must be called only after the caller's permission was checked.
 */

/** user id → email. Empty map when the service key is not configured. */
export async function resolveUserEmails(userIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (await isDemoRequest()) {
    // Demo: the made-up addresses of the fixtures; Supabase Auth is never asked.
    for (const id of userIds) {
      const email = DEMO_USER_EMAILS[id];
      if (email) out.set(id, email);
    }
    return out;
  }
  if (!hasServiceKey() || userIds.length === 0) return out;
  const service = createServiceClient();
  const unique = [...new Set(userIds)].slice(0, 100);
  const results = await Promise.all(unique.map((id) => service.auth.admin.getUserById(id)));
  for (const { data } of results) {
    if (data.user?.email) out.set(data.user.id, data.user.email);
  }
  return out;
}

const PAGE_SIZE = 200;
const MAX_PAGES = 25;

/**
 * Finds an existing auth user with a CONFIRMED email (the Auth admin API has no lookup by
 * email, so this pages through the users: fine up to a few thousand).
 * Throws MissingServiceKeyError when the key is not configured.
 */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  await assertNotDemo();
  const service = createServiceClient();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;
    const match = confirmedUserByEmail(data.users, email);
    if (match) return match.id;
    if (data.users.length < PAGE_SIZE) break;
  }
  return null;
}
