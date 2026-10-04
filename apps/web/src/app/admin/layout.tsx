import { AppShell } from "@/components/shell/app-shell";
import { pendingAccessRequestCount } from "@/lib/access";
import { EMPTY_BRAND } from "@/lib/brand";
import { adminNav, withPendingRequests } from "@/lib/nav";
import { requireStaff } from "@/lib/session";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: { default: "Area admin", template: "%s · Admin · IA Connect" } };

/**
 * Admin area frame. Not a security check: every page and action under /admin
 * calls requireStaff(), requirePlatformAdmin() or requireStaffForOrg() itself.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { supabase, session } = await requireStaff();
  // Only platform admins decide access requests (RLS shows them to nobody else).
  const pending = session.isPlatformAdmin ? await pendingAccessRequestCount(supabase) : 0;
  const hasOrganization = session.memberships.some((m) => m.organization_id !== null);
  return (
    <AppShell
      area="admin"
      brand={EMPTY_BRAND}
      homeHref="/admin/aziende"
      items={withPendingRequests(adminNav(session), pending)}
      userEmail={session.user.email}
      crossLink={hasOrganization ? { href: "/app", label: "Area cliente" } : undefined}
    >
      {children}
    </AppShell>
  );
}
