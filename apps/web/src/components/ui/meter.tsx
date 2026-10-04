/**
 * Meter — a value against a limit (plan usage).
 *
 *   import { Meter } from "@/components/ui/meter";
 *   <Meter label="Messaggi inviati" used={420} limit={1000} tone="ok" note="Restano 580" />
 *
 * `limit={null}` means unlimited: the bar is hidden and only the number shows.
 * Build the rows with buildUsage() from lib/usage.ts.
 */
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import type { Tone } from "@/lib/labels";

const BAR: Record<Tone, string> = {
  ok: "bg-accent",
  warning: "bg-warn",
  error: "bg-danger",
  neutral: "bg-muted/60",
  ai: "bg-ai",
};

export function Meter({
  label,
  used,
  limit,
  tone = "ok",
  note,
}: {
  label: string;
  used: number;
  limit: number | null;
  tone?: Tone;
  note?: string;
}) {
  const ratio = limit && limit > 0 ? Math.min(used / limit, 1) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{label}</span>
        <span className="font-mono text-[13px] tabular-nums">
          {formatNumber(used)}
          <span className="text-muted"> / {limit === null ? "∞" : formatNumber(limit)}</span>
        </span>
      </div>
      {limit !== null && limit > 0 ? (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"
        >
          <div
            className={cn("h-full rounded-full", BAR[tone])}
            style={{ width: `${Math.max(ratio * 100, used > 0 ? 2 : 0)}%` }}
          />
        </div>
      ) : null}
      {note ? (
        <p className={cn("mt-1 text-[13px]", tone === "error" ? "font-medium text-danger" : "text-muted")}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
