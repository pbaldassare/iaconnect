import { Icon } from "@/components/ui/icons";
import type { Brand } from "@/lib/brand";
import type { NavItem } from "@/lib/nav";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { signOut } from "./actions";
import { Sidebar } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";

/**
 * The frame shared by the customer area (/app) and the admin area (/admin):
 * sidebar with brand, navigation and account links; main content on the right.
 * Used by the two area layouts only; pages never render it themselves.
 */
export function AppShell({
  area,
  brand,
  homeHref,
  items,
  userEmail,
  top,
  headerExtra,
  banner,
  crossLink,
  children,
}: {
  area: "customer" | "admin";
  brand: Brand;
  homeHref: string;
  items: readonly NavItem[];
  userEmail: string;
  top?: ReactNode;
  headerExtra?: ReactNode;
  /** Full-width strip above the content (support access). */
  banner?: ReactNode;
  /** Link to the other area, when the user may use both. */
  crossLink?: { href: string; label: string };
  children: ReactNode;
}) {
  const name = brand.name ?? "IA Connect";
  const style = brand.accent ? ({ "--brand": brand.accent } as CSSProperties) : undefined;
  const footerLink =
    "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink";

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_minmax(0,1fr)]" style={style}>
      <a
        href="#contenuto"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:font-semibold focus:shadow-panel"
      >
        Vai al contenuto
      </a>
      <Sidebar
        navLabel={area === "admin" ? "Area admin" : "Sezioni"}
        items={items}
        top={top}
        headerExtra={headerExtra}
        brand={
          <Link href={homeHref} className="flex min-w-0 items-center gap-2.5 rounded-md">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt="" className="size-7 shrink-0 rounded-md object-contain" />
            ) : (
              <span
                aria-hidden
                className="flex size-7 shrink-0 items-center justify-center rounded-md bg-(--brand,var(--accent)) font-display text-[13px] font-extrabold text-on-accent"
              >
                {name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate font-display text-[15px] font-extrabold leading-tight tracking-tight">
                {name}
              </span>
              {area === "admin" ? (
                <span className="block font-mono text-[10.5px] uppercase tracking-wider text-muted">
                  Area admin
                </span>
              ) : null}
            </span>
          </Link>
        }
        footer={
          <>
            {crossLink ? (
              <Link href={crossLink.href} className={footerLink}>
                <Icon name={area === "admin" ? "home" : "shield"} />
                {crossLink.label}
              </Link>
            ) : null}
            <ThemeToggle />
            <Link href="/imposta-password" className={footerLink}>
              <Icon name="key" />
              Cambia password
            </Link>
            <form action={signOut}>
              <button type="submit" className={footerLink}>
                <Icon name="logout" />
                Esci
              </button>
            </form>
            <p className="truncate px-2.5 pt-1 font-mono text-[11.5px] text-muted" title={userEmail}>
              {userEmail}
            </p>
          </>
        }
      />
      <div className="min-w-0">
        {banner}
        <main id="contenuto" className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
