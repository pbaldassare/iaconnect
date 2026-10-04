/**
 * PageHeader — the title block at the top of every page (one <h1> per page).
 *
 *   import { PageHeader } from "@/components/ui/page-header";
 *   <PageHeader title="Collegamenti" description="I sistemi collegati alla tua azienda."
 *     actions={<ButtonLink href="…" icon="plus">Nuovo collegamento</ButtonLink>}
 *     back={{ href: "/admin/aziende", label: "Aziende" }} />
 *
 * `context` is a short note next to the back link (the flow a run belongs to, the kind of
 * connection): it sits on the same line, so a detail page does not spend a row on it.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icons";

export function PageHeader({
  title,
  description,
  actions,
  context,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  context?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {back || context ? (
          <p className="mb-1 flex min-w-0 flex-wrap items-center gap-x-2 text-[13px] text-muted">
            {back ? (
              <Link
                href={back.href}
                className="-ml-1 inline-flex h-7 items-center gap-0.5 rounded-md pr-1.5 font-semibold hover:text-ink max-md:h-10"
              >
                <Icon name="chevron-left" className="size-4" />
                {back.label}
              </Link>
            ) : null}
            {back && context ? <span aria-hidden>/</span> : null}
            {context ? <span className="min-w-0 truncate">{context}</span> : null}
          </p>
        ) : null}
        <h1 className="break-words font-display text-[24px] font-extrabold leading-[1.15] tracking-tight sm:text-[26px]">
          {title}
        </h1>
        {description ? <p className="mt-1 max-w-[70ch] text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
