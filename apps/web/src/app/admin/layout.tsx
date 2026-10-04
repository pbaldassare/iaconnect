import { AppShell } from "@/components/shell/app-shell";
import { EMPTY_BRAND } from "@/lib/brand";
import { adminNav } from "@/lib/nav";
import { requireStaff } from "@/lib/session";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: { default: "Area admin", template: "%s · Admin · IA Connect" } };

/**
 * Admin area frame. Not a security check: every page and action under /admin
 * calls requireStaff(), requirePlatformAdmin() or requireStaffForOrg() itself.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { session } = await requireStaff();
  const hasOrganization = session.memberships.some((m) => m.organization_id !== null);
  return (
    <AppShell
      area="admin"
      brand={EMPTY_BRAND}
      homeHref="/admin/aziende"
      items={adminNav(session)}
      userEmail={session.user.email}
      crossLink={hasOrganization ? { href: "/app", label: "Area cliente" } : undefined}
    >
      {children}
    </AppShell>
  );
}
