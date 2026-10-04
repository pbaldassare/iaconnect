import { cn } from "@/lib/cn";
/**
 * Card, CardHeader, Panel — surfaces.
 *
 *   import { Card, CardHeader, Panel } from "@/components/ui/card";
 *   <Card>
 *     <CardHeader title="Consumi del mese" description="Ottobre 2026" actions={<ButtonLink …/>} />
 *     …content…
 *   </Card>
 *   <Panel>…</Panel>      quieter, tinted box for secondary content inside a page or a Card
 *
 * Card = white surface with border and 16–20px padding (`padded={false}` to let a
 * Table reach the edges). Do not nest Cards: use Panel or a plain divider inside.
 */
import type { ReactNode } from "react";

export function Card({
  children,
  className,
  padded = true,
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  as?: "section" | "div" | "article" | "li";
  id?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
}) {
  return (
    <Tag
      className={cn("rounded-panel border border-line bg-surface", padded && "p-4 sm:p-5", className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** id of the heading, for aria-labelledby on the Card. */
  id?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <h2 id={id} className="font-display text-[17px] font-bold leading-tight tracking-tight">
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface-2/60 p-3 sm:p-4", className)}>
      {children}
    </div>
  );
}
