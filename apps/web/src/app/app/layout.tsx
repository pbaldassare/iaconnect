import { endSupportSession } from "@/components/shell/actions";
import { AppShell } from "@/components/shell/app-shell";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { Icon } from "@/components/ui/icons";
import { getBranding } from "@/lib/branding";
import { CUSTOMER_NAV } from "@/lib/nav";
import { requireOrg } from "@/lib/session";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Customer area frame. The layout is not a security check: every page and
 * action under /app calls requireOrg() (or requireOrgManager()) itself.
 */
export default async function CustomerLayout({ children }: { children: ReactNode }) {
  const { supabase, session, org, organizations } = await requireOrg();
  const [brand, unread] = await Promise.all([
    getBranding(supabase, org.organization),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.organization.id)
      .is("read_at", null),
  ]);
  const unreadCount = unread.count ?? 0;
  const inSupport = org.mode === "support";

  return (
    <AppShell
      area="customer"
      brand={{ ...brand, name: brand.name ?? org.organization.name }}
      homeHref="/app"
      items={CUSTOMER_NAV}
      userEmail={session.user.email}
      crossLink={session.isStaff ? { href: "/admin", label: "Area admin" } : undefined}
      top={
        organizations.length > 1 || (inSupport && organizations.length > 0) ? (
          <OrgSwitcher
            organizations={organizations.map((o) => ({ id: o.id, name: o.name }))}
            currentId={inSupport ? null : org.organization.id}
          />
        ) : null
      }
      headerExtra={
        <Link
          href="/app/notifiche"
          className="relative flex size-10 items-center justify-center rounded-lg text-ink hover:bg-surface-2"
        >
          <Icon
            name="bell"
            label={unreadCount > 0 ? `Notifiche: ${unreadCount} da leggere` : "Notifiche: nessuna da leggere"}
            className="size-5"
          />
          {unreadCount > 0 ? (
            <span
              aria-hidden
              className="absolute right-1 top-1 min-w-4 rounded-full bg-accent px-1 text-center font-mono text-[10px] font-semibold leading-4 text-on-accent"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Link>
      }
      banner={
        inSupport ? (
          <aside
            aria-label="Accesso in assistenza"
            className="z-30 flex md:sticky md:top-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-ink px-4 py-2.5 text-bg sm:px-6 md:px-8"
          >
            <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <Icon name="shield" className="size-4" />
              <span>
                Stai lavorando come assistenza su <span className="underline">{org.organization.name}</span>.
                Ogni azione viene registrata ed è visibile al cliente.
              </span>
            </p>
            <form action={endSupportSession}>
              <button
                type="submit"
                className="h-8 rounded-lg border border-bg/40 px-3 text-[13px] font-semibold hover:bg-bg/15 focus-visible:outline-bg"
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
