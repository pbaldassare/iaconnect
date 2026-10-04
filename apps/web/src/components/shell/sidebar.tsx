"use client";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { type NavItem, isNavItemActive } from "@/lib/nav";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

/**
 * Sidebar on desktop, collapsible top bar on small screens. The server shell
 * passes ready-made slots; this component only handles the active link and
 * the open/closed state.
 */
export function Sidebar({
  brand,
  headerExtra,
  top,
  items,
  navLabel,
  footer,
}: {
  brand: ReactNode;
  /** Always visible next to the brand (notifications bell). */
  headerExtra?: ReactNode;
  /** Above the navigation (organization switcher). */
  top?: ReactNode;
  items: readonly NavItem[];
  navLabel: string;
  footer: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the mobile menu after each navigation
  useEffect(() => setOpen(false), [pathname]);

  return (
    <aside className="border-b border-line bg-surface md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:border-b-0 md:border-r">
      <div className="flex h-14 items-center justify-between gap-2 px-4 md:h-16">
        {brand}
        <div className="flex items-center gap-1">
          {headerExtra}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="shell-menu"
            onClick={() => setOpen((v) => !v)}
            className="flex size-10 items-center justify-center rounded-lg text-ink hover:bg-surface-2 md:hidden"
          >
            <Icon
              name={open ? "x" : "menu"}
              label={open ? "Chiudi il menu" : "Apri il menu"}
              className="size-5"
            />
          </button>
        </div>
      </div>
      <div
        id="shell-menu"
        className={cn(
          "min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-4 md:flex",
          open ? "flex" : "hidden",
        )}
      >
        {top ? <div className="px-1">{top}</div> : null}
        <nav aria-label={navLabel}>
          <ul className="grid gap-0.5">
            {items.map((item) => {
              const active = isNavItemActive(item, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold",
                      active
                        ? "bg-accent-soft text-accent-strong"
                        : "text-ink/85 hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    <Icon name={item.icon} className={active ? "text-accent" : "text-muted"} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mt-auto grid gap-0.5 border-t border-line pt-3">{footer}</div>
      </div>
    </aside>
  );
}
