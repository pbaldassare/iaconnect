import { cn } from "@/lib/cn";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import type { DayPoint, FunnelStep } from "@/lib/report/metrics";

/**
 * Report charts: plain SVG and CSS, colors from the theme tokens (both themes),
 * every chart with a text summary and the figures in a table for screen readers.
 */

export function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "error";
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 font-display text-2xl font-extrabold tabular-nums tracking-tight",
          tone === "error" && "text-danger",
        )}
      >
        {value}
      </p>
      {note ? <p className="mt-0.5 text-[13px] text-muted">{note}</p> : null}
    </div>
  );
}

const HEIGHT = 120;
const STEP = 12;

/** Two bars per day: messages sent (accent) and received (grey). */
export function MessagesPerDayChart({ points }: { points: DayPoint[] }) {
  const max = Math.max(1, ...points.map((point) => Math.max(point.sent, point.received)));
  const sent = points.reduce((sum, point) => sum + point.sent, 0);
  const received = points.reduce((sum, point) => sum + point.received, 0);
  const width = Math.max(points.length * STEP, STEP);
  const bar = (value: number) => (value === 0 ? 0 : Math.max((value / max) * HEIGHT, 2));
  if (sent + received === 0) {
    return <p className="text-sm text-muted">Nessun messaggio in questo periodo.</p>;
  }
  return (
    <figure>
      <div className="flex items-start gap-2">
        <span className="w-8 shrink-0 text-right font-mono text-[11px] text-muted" aria-hidden>
          {formatNumber(max)}
        </span>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-32 w-full min-w-0 border-b border-l border-line"
          role="img"
          aria-label={`Messaggi per giorno: ${formatNumber(sent)} inviati e ${formatNumber(received)} ricevuti nel periodo. Il giorno più intenso ne conta ${formatNumber(max)}.`}
        >
          {points.map((point, index) => (
            <g key={point.day}>
              <title>{`${formatDate(point.day)}: ${point.sent} inviati, ${point.received} ricevuti`}</title>
              <rect
                x={index * STEP + 1.5}
                y={HEIGHT - bar(point.sent)}
                width={4}
                height={bar(point.sent)}
                className="fill-accent"
              />
              <rect
                x={index * STEP + 6.5}
                y={HEIGHT - bar(point.received)}
                width={4}
                height={bar(point.received)}
                className="fill-muted"
              />
            </g>
          ))}
        </svg>
      </div>
      <div className="ml-10 mt-1 flex justify-between font-mono text-[11px] text-muted" aria-hidden>
        <span>{formatDate(points[0]?.day)}</span>
        <span>{formatDate(points[points.length - 1]?.day)}</span>
      </div>
      <figcaption className="ml-10 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-accent" />
          Inviati ({formatNumber(sent)})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-muted" />
          Ricevuti ({formatNumber(received)})
        </span>
      </figcaption>
      <details className="ml-10 mt-2 text-[13px]">
        <summary className="cursor-pointer text-muted">Vedi i numeri giorno per giorno</summary>
        <table className="mt-2 w-full max-w-sm text-left font-mono text-[12.5px] tabular-nums">
          <thead>
            <tr className="text-muted">
              <th scope="col" className="py-0.5 pr-3 font-medium">
                Giorno
              </th>
              <th scope="col" className="py-0.5 pr-3 text-right font-medium">
                Inviati
              </th>
              <th scope="col" className="py-0.5 text-right font-medium">
                Ricevuti
              </th>
            </tr>
          </thead>
          <tbody>
            {points
              .filter((point) => point.sent + point.received > 0)
              .map((point) => (
                <tr key={point.day}>
                  <td className="py-0.5 pr-3">{formatDate(point.day)}</td>
                  <td className="py-0.5 pr-3 text-right">{point.sent}</td>
                  <td className="py-0.5 text-right">{point.received}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

const FUNNEL_BAR: Record<string, string> = { open: "bg-accent", won: "bg-accent-strong", lost: "bg-danger" };

/** Deals by stage as horizontal bars, in pipeline order. The numbers are in the text, not only in the bars. */
export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  if (steps.every((step) => step.count === 0)) {
    return <p className="text-sm text-muted">Nessuna trattativa da mostrare in questo periodo.</p>;
  }
  return (
    <ol className="grid gap-2.5">
      {steps.map((step) => (
        <li key={step.stageId}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="font-semibold">
              {step.name}
              {step.kind !== "open" ? (
                <span className="font-normal text-muted">
                  {" "}
                  · {step.kind === "won" ? "vinte" : "perse"} nel periodo
                </span>
              ) : null}
            </span>
            <span className="font-mono text-[13px] tabular-nums">
              {formatNumber(step.count)} · {formatMoney(step.valueCents)}
            </span>
          </div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div
              className={cn("h-full rounded-full", FUNNEL_BAR[step.kind] ?? "bg-accent")}
              style={{ width: `${step.count === 0 ? 0 : Math.max(step.share * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** One horizontal bar per row, relative to the largest value. */
export function BarList({
  rows,
  empty,
}: {
  rows: { key: string; label: string; value: number; display: string }[];
  empty: string;
}) {
  const max = Math.max(0, ...rows.map((row) => row.value));
  if (max === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="grid gap-2.5">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-semibold">{row.label}</span>
            <span className="font-mono text-[13px] tabular-nums">{row.display}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${row.value === 0 ? 0 : Math.max((row.value / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
