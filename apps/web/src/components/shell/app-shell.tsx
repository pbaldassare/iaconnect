import { Icon } from "@/components/ui/icons";
import type { Brand } from "@/lib/brand";
import type { NavItem } from "@/lib/nav";
import { DEMO_EXIT_PATH } from "@/lib/routes";
import { SIDEBAR_COOKIE, THEME_COOKIE, parseSidebar, themeChoice } from "@/lib/theme";
import { cookies } from "next/headers";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { signOut } from "./actions";
import { BrandMark } from "./brand-mark";
import { ShellFrame } from "./shell-frame";
import { SHELL_ITEM, SHELL_LABEL } from "./styles";
import { ThemeControl } from "./theme-control";

const FOOTER_ITEM = `${SHELL_ITEM} font-medium text-muted hover:bg-surface-2 hover:text-ink`;

/**
 * The frame shared by the customer area (/app) and the admin area (/admin): a left sidebar
 * (expanded, icon rail, or a drawer on phones) with brand, navigation, notifications, theme
 * and account; the page on the right. Used by the two area layouts only; pages never render
 * it themselves. The open/closed logic is in shell-frame.tsx.
 */
export async function AppShell({
  area,
  brand,
  homeHref,
  items,
  userEmail,
  orgSwitcher,
  notifications,
  banner,
  crossLink,
  demo = false,
  children,
}: {
  area: "customer" | "admin";
  brand: Brand;
  homeHref: string;
  items: readonly NavItem[];
  userEmail: string;
  /** Organization switcher, when the user has more than one. */
  orgSwitcher?: ReactNode;
  /** Notifications page and how many are unread. */
  notifications?: { href: string; unread: number };
  /** Full-width strip above the content (demo, support access). */
  banner?: ReactNode;
  /** Link to the other area, when the user may use both. */
  crossLink?: { href: string; label: string };
  /** Public demo: no account links, "Esci" leaves the demo. */
  demo?: boolean;
  children: ReactNode;
}) {
  const store = await cookies();
  const name = brand.name ?? "IA Connect";
  const style = brand.accent ? ({ "--brand": brand.accent } as CSSProperties) : undefined;

  const mark = brand.logoUrl ? (
    <img src={brand.logoUrl} alt="" className="size-7 shrink-0 rounded-md object-contain" />
  ) : brand.name ? (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-(--brand,var(--accent)) font-display text-[13px] font-extrabold text-on-accent"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  ) : (
    <BrandMark />
  );
  const brandLink = (
    <Link
      href={homeHref}
      style={style}
      title={name}
      className="flex h-10 min-w-0 items-center gap-2.5 rounded-md rail:w-10 rail:justify-center"
    >
      {mark}
      <span className={SHELL_LABEL}>
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
  );

  return (
    <ShellFrame
      initialSidebar={parseSidebar(store.get(SIDEBAR_COOKIE)?.value)}
      navLabel={area === "admin" ? "Area admin" : "Sezioni"}
      items={items}
      orgSwitcher={orgSwitcher}
      notifications={notifications}
      brand={brandLink}
      barBrand={brandLink}
      footer={
        <>
          {crossLink ? (
            <Link href={crossLink.href} title={crossLink.label} className={FOOTER_ITEM}>
              <Icon name={area === "admin" ? "home" : "shield"} />
              <span className={SHELL_LABEL}>{crossLink.label}</span>
            </Link>
          ) : null}
          {demo ? null : (
            <Link href="/imposta-password" title="Cambia password" className={FOOTER_ITEM}>
              <Icon name="key" />
              <span className={SHELL_LABEL}>Cambia password</span>
            </Link>
          )}
          <div className="py-1 rail:py-0">
            <ThemeControl initial={themeChoice(store.get(THEME_COOKIE)?.value)} />
          </div>
          <p
            className="truncate px-2.5 pt-2 font-mono text-[11.5px] text-muted rail:hidden"
            title={userEmail}
          >
            {userEmail}
          </p>
          {demo ? (
            // A plain anchor: the address changes a cookie and must not be prefetched.
            <a href={DEMO_EXIT_PATH} title="Esci dalla demo" className={FOOTER_ITEM}>
              <Icon name="logout" />
              <span className={SHELL_LABEL}>Esci dalla demo</span>
            </a>
          ) : (
            <form action={signOut}>
              <button type="submit" title={`Esci (${userEmail})`} className={FOOTER_ITEM}>
                <Icon name="logout" />
                <span className={SHELL_LABEL}>Esci</span>
              </button>
            </form>
          )}
        </>
      }
    >
      {banner}
      <main id="contenuto" className="mx-auto w-full max-w-[1180px] px-4 py-5 sm:px-6 md:px-8 md:py-7">
        {children}
      </main>
    </ShellFrame>
  );
}
