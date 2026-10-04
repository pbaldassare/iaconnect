/**
 * PageHeader — the title block at the top of every page (one <h1> per page).
 *
 *   import { PageHeader } from "@/components/ui/page-header";
 *   <PageHeader title="Collegamenti" description="I sistemi collegati alla tua azienda."
 *     actions={<ButtonLink href="…" icon="plus">Nuovo collegamento</ButtonLink>}
 *     back={{ href: "/admin/aziende", label: "Aziende" }} />
 *
 * `eyebrow` is a short mono label above the title (e.g. the section name on a detail page).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icons";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {back ? (
          <Link
            href={back.href}
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"
          >
            <Icon name="chevron-left" className="size-4" />
            {back.label}
          </Link>
        ) : null}
        {eyebrow ? (
          <p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-accent">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-[28px]">
          {title}
        </h1>
        {description ? <p className="mt-1.5 max-w-[70ch] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
