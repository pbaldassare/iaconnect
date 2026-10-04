import { Meter } from "@/components/ui/meter";
import type { UsageRow } from "@/lib/usage";

/** The four plan meters (messages, AI credits, scrape runs, active flows). Rows come from buildUsage(). */
export function UsageMeters({ rows }: { rows: UsageRow[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {rows.map((row) => (
        <Meter
          key={row.key}
          label={row.label}
          used={row.used}
          limit={row.limit}
          tone={row.tone}
          note={row.note}
        />
      ))}
    </div>
  );
}
