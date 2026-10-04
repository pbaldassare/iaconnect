import { cn } from "@/lib/cn";
/**
 * EmptyState — what to show instead of an empty list. It must say what the
 * list will contain and what to do first.
 *
 *   import { EmptyState } from "@/components/ui/empty-state";
 *   <EmptyState icon="plug" title="Nessun collegamento"
 *     description="Collega la mail e WhatsApp: i flussi partono da lì."
 *     action={<ButtonLink href="/app/collegamenti">Collega la mail</ButtonLink>} />
 *
 * `compact` for empty states inside a Card that already has a title.
 */
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
  className,
}: {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border border-dashed border-line-strong",
        compact ? "p-4" : "p-6 sm:p-8",
        className,
      )}
    >
      {icon ? <Icon name={icon} className="size-5 text-muted" /> : null}
      <p className="font-semibold">{title}</p>
      {description ? <div className="max-w-[60ch] text-sm text-muted">{description}</div> : null}
      {action ? <div className="mt-2 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}
