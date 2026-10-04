import { endSupportSession } from "@/components/shell/actions";
import { AppShell } from "@/components/shell/app-shell";
import { DemoBanner } from "@/components/shell/demo-banner";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { Icon } from "@/components/ui/icons";
import { getBranding } from "@/lib/branding";
import { CUSTOMER_NAV } from "@/lib/nav";
import { requireOrg } from "@/lib/session";
import type { ReactNode } from "react";

/**
 * Customer area frame. The layout is not a security check: every page and
 * action under /app calls requireOrg() (or requireOrgManager()) itself.
 */
export default async function CustomerLayout({ children }: { children: ReactNode }) {
  const { supabase, session, org, organizations, demo } = await requireOrg();
  const [brand, unread] = await Promise.all([
    getBranding(supabase, org.organization),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.organization.id)
      .is("read_at", null),
  ]);
  const inSupport = org.mode === "support";

  return (
    <AppShell
      area="customer"
      brand={{ ...brand, name: brand.name ?? org.organization.name }}
      homeHref="/app"
      items={CUSTOMER_NAV}
      userEmail={demo ? "Demo" : session.user.email}
      demo={demo}
      crossLink={session.isStaff ? { href: "/admin", label: "Area admin" } : undefined}
      orgSwitcher={
        organizations.length > 1 || (inSupport && organizations.length > 0) ? (
          <OrgSwitcher
            organizations={organizations.map((o) => ({ id: o.id, name: o.name }))}
            currentId={inSupport ? null : org.organization.id}
          />
        ) : null
      }
      notifications={{ href: "/app/notifiche", unread: unread.count ?? 0 }}
      banner={
        demo ? (
          <DemoBanner />
        ) : inSupport ? (
          <aside
            aria-label="Accesso in assistenza"
            className="z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 bg-ink px-4 py-2 text-bg sm:px-6 md:sticky md:top-0 md:px-8"
          >
            <p className="flex min-w-0 items-start gap-2 text-[13px] font-semibold leading-snug">
              <Icon name="shield" className="mt-0.5 size-4" />
              <span>
                Stai lavorando come assistenza su <span className="underline">{org.organization.name}</span>.
                Ogni azione viene registrata ed è visibile al cliente.
              </span>
            </p>
            <form action={endSupportSession}>
              <button
                type="submit"
                className="h-8 rounded-lg border border-bg/40 px-3 text-[13px] font-semibold hover:bg-bg/15 focus-visible:outline-bg max-md:h-10"
              >
                Esci dall'assistenza
              </button>
            </form>
          </aside>
        ) : null
      }
    >
      {children}
    </AppShell>
  );
}
