/**
 * RunSteps — the steps of one run (live or simulated), in order: status, exit
 * taken, what the step did or would have done (`stepOutcome`, one reading per
 * block type), error, duration and AI cost.
 *
 *   <RunSteps steps={rows of flow_run_steps} stageNames={{ quote_sent: "Proposta inviata" }} />
 */
import { AiBadge, StatusPill } from "@/components/ui/badge";
import { blockTitle, outletLabel } from "@/lib/flows/describe";
import { stepOutcome } from "@/lib/flows/outcome";
import { formatDuration, stepStatus } from "@/lib/flows/runs";
import { formatMicros } from "@/lib/format";
import { OUTLETS, type Outlet, getBlock } from "@ia-connect/core";

export interface RunStepRow {
  id: string;
  step_id: string;
  block: string;
  status: string;
  outlet: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  ai_cost_micros: number;
  duration_ms: number;
}

function isEmpty(value: unknown): boolean {
  return !value || (typeof value === "object" && Object.keys(value as object).length === 0);
}

function Json({ label, value }: { label: string; value: unknown }) {
  if (isEmpty(value)) return null;
  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer text-muted">{label}</summary>
      <pre className="mt-1 max-h-72 overflow-auto rounded-md border border-line bg-surface-2 p-2 font-mono text-[12px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

export function RunSteps({
  steps,
  stageNames,
}: {
  steps: RunStepRow[];
  /** Deal stage key → name, so a step shows «Proposta inviata» instead of `quote_sent`. */
  stageNames?: Readonly<Record<string, string>>;
}) {
  if (steps.length === 0) {
    return <p className="text-sm text-muted">Nessun passo registrato.</p>;
  }
  return (
    <ol className="grid gap-2">
      {steps.map((step, index) => {
        const outcome = stepOutcome(step, { stages: stageNames });
        const usesAi = getBlock(step.block)?.usesAi ?? false;
        const outlet = OUTLETS.includes(step.outlet as Outlet)
          ? outletLabel(step.outlet as Outlet)
          : step.outlet;
        return (
          <li key={step.id} className="rounded-lg border border-line bg-surface px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-[12px] tabular-nums text-muted">{index + 1}.</span>
              <span className="font-semibold">{blockTitle(step.block)}</span>
              {usesAi ? <AiBadge /> : null}
              <StatusPill {...stepStatus(step.status)} />
              <span className="font-mono text-[11px] text-muted">{step.step_id}</span>
            </div>
            <p className="mt-1 flex flex-wrap gap-x-3 text-[13px] text-muted">
              {outlet && step.outlet !== "next" ? <span>uscita: {outlet}</span> : null}
              <span>durata {formatDuration(step.duration_ms)}</span>
              {step.ai_cost_micros > 0 ? <span>costo IA {formatMicros(step.ai_cost_micros)}</span> : null}
            </p>
            {outcome.headline ? <p className="mt-2 text-sm font-medium">{outcome.headline}</p> : null}
            {outcome.details.length > 0 ? (
              <dl className="mt-2 grid gap-1 text-sm">
                {outcome.details.map((item) => (
                  <div key={`${item.label}:${item.value}`} className="grid gap-x-2 sm:grid-cols-[8rem_1fr]">
                    <dt className="text-muted">{item.label}</dt>
                    <dd className="whitespace-pre-wrap break-words">{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {outcome.warnings.length > 0 ? (
              <ul className="mt-2 grid gap-1 rounded-md bg-warn-soft px-2 py-1.5 text-[13px] text-ink">
                {outcome.warnings.map((warning) => (
                  <li key={warning}>
                    <span className="font-semibold text-warn">Attenzione: </span>
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}
            {step.error ? (
              <p role="alert" className="mt-2 rounded-md bg-danger-soft px-2 py-1 text-[13px] text-ink">
                <span className="font-semibold text-danger">Errore: </span>
                {step.error}
              </p>
            ) : null}
            <div className="mt-2 grid gap-1">
              <Json label="Dati in ingresso" value={step.input} />
              <Json label="Risultato completo" value={step.output} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
