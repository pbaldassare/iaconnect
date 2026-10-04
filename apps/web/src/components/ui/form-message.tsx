import type { ActionResult } from "@/lib/action";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/labels";
/**
 * FormMessage, Notice — inline feedback (we do not use toasts: messages stay
 * next to what caused them and do not disappear).
 *
 *   import { FormMessage, Notice } from "@/components/ui/form-message";
 *   <FormMessage result={state} />          result of a server action; renders nothing while idle
 *   <Notice tone="warning" title="Collegamento scaduto">Ricollega la casella…</Notice>
 *   <Notice tone="error" announce="alert">…</Notice>     announced by screen readers when it appears
 *
 * Tones: ok, warning, error, neutral, ai.
 */
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

const TONES: Record<Tone, { box: string; icon: IconName }> = {
  ok: { box: "border-accent/40 bg-accent-soft text-ink", icon: "check" },
  warning: { box: "border-warn/40 bg-warn-soft text-ink", icon: "alert" },
  error: { box: "border-danger/40 bg-danger-soft text-ink", icon: "alert" },
  neutral: { box: "border-line bg-surface-2 text-ink", icon: "info" },
  ai: { box: "border-ai/40 bg-ai-soft text-ink", icon: "spark" },
};
const ICON_COLOR: Record<Tone, string> = {
  ok: "text-accent",
  warning: "text-warn",
  error: "text-danger",
  neutral: "text-muted",
  ai: "text-ai",
};

export function Notice({
  tone = "neutral",
  title,
  children,
  className,
  announce,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Read out by screen readers when it appears: "status" politely, "alert" at once. */
  announce?: "status" | "alert";
}) {
  const style = TONES[tone];
  return (
    <div
      role={announce}
      className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm", style.box, className)}
    >
      <Icon name={style.icon} className={cn("mt-0.5 size-4", ICON_COLOR[tone])} />
      <div className="min-w-0 space-y-0.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-ink/90 [&_a]:underline">{children}</div> : null}
      </div>
    </div>
  );
}

export function FormMessage({ result, className }: { result: ActionResult; className?: string }) {
  if (!result.message) return null;
  return (
    <Notice tone={result.ok ? "ok" : "error"} announce={result.ok ? "status" : "alert"} className={className}>
      {result.message}
    </Notice>
  );
}
