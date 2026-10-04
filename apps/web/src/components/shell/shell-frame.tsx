"use client";
import { Icon, type IconName } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { type NavItem, isNavItemActive } from "@/lib/nav";
import { SIDEBAR_COOKIE, type SidebarState, preferenceCookie } from "@/lib/theme";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { SHELL_ITEM, SHELL_LABEL } from "./styles";

const WIDE = "(min-width: 1100px)";
const DESKTOP = "(min-width: 768px)";
const ICON_BUTTON =
  "flex size-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink";

/**
 * The interactive frame of the two areas. From 768px: a left sidebar that is either expanded
 * (icon + label) or an icon rail; the choice is stored in a cookie and rendered by the server.
 * Below 768px: a top bar with the menu button on the left and an off-canvas drawer.
 * The server shell (app-shell.tsx) passes ready-made slots; this component owns only the
 * open/closed state, the active link and the keyboard handling of the drawer.
 */
export function ShellFrame({
  initialSidebar,
  brand,
  barBrand,
  orgSwitcher,
  items,
  navLabel,
  notifications,
  footer,
  children,
}: {
  initialSidebar: SidebarState;
  /** Brand link inside the sidebar. */
  brand: ReactNode;
  /** Brand link in the phone top bar. */
  barBrand: ReactNode;
  /** Organization switcher, when the user has more than one. */
  orgSwitcher?: ReactNode;
  items: readonly NavItem[];
  navLabel: string;
  notifications?: { href: string; unread: number };
  footer: ReactNode;
  /** Banner and main content. */
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [sidebar, setSidebar] = useState<SidebarState>(initialSidebar);
  // Only for the toggle's label and aria-expanded while the state is "auto".
  const [wide, setWide] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const aside = useRef<HTMLElement>(null);

  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer after each navigation
  useEffect(() => setDrawer(false), [pathname]);

  useEffect(() => {
    if (!drawer) return;
    const desktop = window.matchMedia(DESKTOP);
    const closeOnDesktop = () => desktop.matches && setDrawer(false);
    desktop.addEventListener("change", closeOnDesktop);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      desktop.removeEventListener("change", closeOnDesktop);
      document.body.style.overflow = previous;
    };
  }, [drawer]);

  function closeDrawer() {
    setDrawer(false);
    menuButton.current?.focus();
  }

  function onDrawerKey(event: KeyboardEvent<HTMLElement>) {
    if (!drawer) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab" || !aside.current) return;
    const focusable = [
      ...aside.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), select, input"),
    ].filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const expanded = sidebar === "auto" ? wide : sidebar === "expanded";
  function store(next: Exclude<SidebarState, "auto">) {
    setSidebar(next);
    document.cookie = preferenceCookie(SIDEBAR_COOKIE, next);
  }
  function showOrgSwitcher() {
    store("expanded");
    // After the labels are back (the rail hides the select).
    window.setTimeout(() => document.getElementById("org-switcher")?.focus(), 220);
  }

  const toggleLabel = expanded ? "Riduci la barra laterale" : "Espandi la barra laterale";

  return (
    <div className="shell" data-sidebar={sidebar} data-drawer={drawer ? "open" : "closed"}>
      <a
        href="#contenuto"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:font-semibold focus:shadow-panel"
      >
        Vai al contenuto
      </a>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-line bg-surface px-2 md:hidden">
        <button
          ref={menuButton}
          type="button"
          aria-expanded={drawer}
          aria-controls="shell-sidebar"
          onClick={() => setDrawer(true)}
          className={cn(ICON_BUTTON, "text-ink")}
        >
          <Icon name="menu" label="Apri il menu" className="size-5" />
        </button>
        <div className="min-w-0 flex-1">{barBrand}</div>
        {notifications ? <Bell {...notifications} /> : null}
      </header>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the drawer; the backdrop is a pointer shortcut */}
      <div className="shell-backdrop" onClick={closeDrawer} aria-hidden />

      <aside
        ref={aside}
        id="shell-sidebar"
        className="shell-sidebar"
        onKeyDown={onDrawerKey}
        {...(drawer ? { role: "dialog", "aria-modal": true, "aria-label": "Menu" } : {})}
      >
        <div className="flex h-14 shrink-0 items-center gap-1 pl-4 pr-2 rail:h-auto rail:flex-col rail:gap-2 rail:px-0 rail:pb-1 rail:pt-3">
          <div className="min-w-0 flex-1 rail:flex-none">{brand}</div>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="shell-sidebar"
            onClick={() => store(expanded ? "collapsed" : "expanded")}
            title={toggleLabel}
            className={cn(ICON_BUTTON, "max-md:hidden")}
          >
            <Icon name="sidebar" label={toggleLabel} />
          </button>
          <button
            ref={closeButton}
            type="button"
            onClick={closeDrawer}
            className={cn(ICON_BUTTON, "md:hidden")}
          >
            <Icon name="x" label="Chiudi il menu" className="size-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-3 pb-3 pt-2">
          {orgSwitcher ? (
            <>
              <div className="rail:hidden">{orgSwitcher}</div>
              <button
                type="button"
                onClick={showOrgSwitcher}
                title="Cambia azienda"
                className={cn(ICON_BUTTON, "hidden rail:flex")}
              >
                <Icon name="building" label="Cambia azienda" />
              </button>
            </>
          ) : null}
          <nav aria-label={navLabel}>
            <ul className="grid gap-0.5">
              {items.map((item) => (
                <li key={item.href}>
                  <NavLink
                    href={item.href}
                    icon={item.icon}
                    label={item.label}
                    active={isNavItemActive(item, pathname)}
                    count={item.badge}
                    countLabel="in attesa"
                    tone="warn"
                  />
                </li>
              ))}
            </ul>
            {notifications ? (
              <div className="mt-2 border-t border-line pt-2 max-md:hidden">
                <NavLink
                  href={notifications.href}
                  icon="bell"
                  label="Notifiche"
                  active={isNavItemActive({ href: notifications.href }, pathname)}
                  count={notifications.unread}
                  countLabel="da leggere"
                  tone="accent"
                />
              </div>
            ) : null}
          </nav>
          <div className="mt-auto grid gap-0.5 border-t border-line pt-3">{footer}</div>
        </div>
      </aside>

      <div className="min-w-0">{children}</div>
    </div>
  );
}

function NavLink({
  href,
  icon,
  label,
  active,
  count,
  countLabel,
  tone,
}: {
  href: string;
  icon: IconName;
  label: string;
  active: boolean;
  count?: number;
  countLabel: string;
  tone: "warn" | "accent";
}) {
  const shown = count && count > 0 ? (count > 99 ? "99+" : String(count)) : null;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={label}
      className={cn(
        SHELL_ITEM,
        "relative",
        active
          ? "bg-accent-soft font-bold text-accent-strong"
          : "font-medium text-ink/85 hover:bg-surface-2 hover:text-ink",
      )}
    >
      <Icon name={icon} className={active ? "text-accent" : "text-muted"} />
      <span className={SHELL_LABEL}>{label}</span>
      {shown ? (
        <span
          className={cn(
            "ml-auto rounded-full px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none",
            "rail:absolute rail:right-0 rail:top-0 rail:ml-0 rail:min-w-4 rail:px-1 rail:text-center rail:text-[10px] rail:leading-3",
            tone === "warn" ? "bg-warn-soft text-warn" : "bg-accent text-on-accent",
          )}
        >
          {shown}
          <span className="sr-only"> {countLabel}</span>
        </span>
      ) : null}
    </Link>
  );
}

/** Notifications in the phone top bar (from 768px they are a row of the sidebar). */
function Bell({ href, unread }: { href: string; unread: number }) {
  return (
    <Link href={href} className={cn(ICON_BUTTON, "relative text-ink")}>
      <Icon
        name="bell"
        label={unread > 0 ? `Notifiche: ${unread} da leggere` : "Notifiche: nessuna da leggere"}
        className="size-5"
      />
      {unread > 0 ? (
        <span
          aria-hidden
          className="absolute right-1 top-1 min-w-4 rounded-full bg-accent px-1 text-center font-mono text-[10px] font-semibold leading-4 text-on-accent"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
