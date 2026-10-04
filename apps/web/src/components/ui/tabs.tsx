import { cn } from "@/lib/cn";
/**
 * Tabs — navigation between views of the same page, driven by the URL.
 *
 *   import { Tabs } from "@/components/ui/tabs";
 *   <Tabs label="Sezioni della scheda" items={[
 *     { href: "?scheda=dati", label: "Dati", current: tab === "dati" },
 *     { href: "?scheda=utenti", label: "Utenti", current: tab === "utenti", count: 3 },
 *   ]} />
 *
 * Tabs are links (a search param or a sub-route), so they work in server
 * components, survive reload and can be shared. The row scrolls sideways on
 * narrow screens.
 */
import Link from "next/link";

export interface TabItem {
  href: string;
  label: string;
  current: boolean;
  count?: number;
}

export function Tabs({ label, items, className }: { label: string; items: TabItem[]; className?: string }) {
  return (
    <nav
      aria-label={label}
      className={cn("overflow-x-auto border-b border-line contain-inline-size", className)}
    >
      <ul className="flex min-w-max gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              scroll={false}
              className={cn(
                "-mb-px flex h-10 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold",
                item.current
                  ? "border-accent text-ink"
                  : "border-transparent text-muted hover:border-line-strong hover:text-ink",
              )}
            >
              {item.label}
              {item.count !== undefined ? (
                <span className="rounded bg-surface-2 px-1.5 font-mono text-[11px] text-muted">
                  {item.count}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
