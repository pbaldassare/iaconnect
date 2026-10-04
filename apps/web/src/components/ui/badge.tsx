import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/labels";
/**
 * Badge, StatusPill, AiBadge — small labels with semantic colors.
 *
 *   import { Badge, StatusPill, AiBadge } from "@/components/ui/badge";
 *   <StatusPill {...connectionStatus(row.status)} />     label + tone from lib/labels.ts
 *   <StatusPill tone="error" label="In errore" />
 *   <Badge tone="neutral">Pro</Badge>                     plain tag (plan, sector, count)
 *   <AiBadge />                                           marks anything that uses AI (amber, always)
 *
 * Tones: ok (green), warning (ochre), error (red), neutral (grey), ai (amber).
 * Amber is reserved for AI: never use tone="ai" for warnings.
 * StatusPill has a dot so status is not conveyed by color alone.
 */
import type { ReactNode } from "react";
import { Icon } from "./icons";

const TONES: Record<Tone, string> = {
  ok: "bg-accent-soft text-accent-strong",
  warning: "bg-warn-soft text-warn",
  error: "bg-danger-soft text-danger",
  neutral: "bg-surface-2 text-muted",
  ai: "bg-ai-soft text-ai",
};
const DOTS: Record<Tone, string> = {
  ok: "bg-accent",
  warning: "bg-warn",
  error: "bg-danger",
  neutral: "bg-muted/60",
  ai: "bg-ai",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusPill({ tone, label, className }: { tone: Tone; label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12.5px] font-semibold",
        TONES[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOTS[tone])} />
      {label}
    </span>
  );
}

export function AiBadge({ children = "IA", className }: { children?: ReactNode; className?: string }) {
  return (
    <Badge tone="ai" className={className}>
      <Icon name="spark" className="size-3" />
      {children}
    </Badge>
  );
}
