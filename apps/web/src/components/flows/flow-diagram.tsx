/**
 * FlowDiagram — a flow as a readable vertical list: the trigger, then each step
 * with its block, a one-line summary, where its exits lead and the issues that
 * refer to it.
 *
 *   <FlowDiagram view={buildDiagram(definition, issues, names)} />
 *
 * `view` is plain data (lib/flows/view.ts), so this renders the same inside
 * server pages and inside the assistant's client chat.
 */
import { AiBadge, Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { DiagramIssue, DiagramView } from "@/lib/flows/view";

function Issues({ issues }: { issues: DiagramIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-2 grid gap-1">
      {issues.map((issue) => (
        <li
          key={`${issue.level}:${issue.text}`}
          className={cn(
            "flex gap-1.5 rounded-md px-2 py-1 text-[13px]",
            issue.level === "error" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn",
          )}
        >
          <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
          <span className="text-ink">
            <span className="font-semibold">{issue.level === "error" ? "Errore: " : "Attenzione: "}</span>
            {issue.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function FlowDiagram({ view }: { view: DiagramView }) {
  return (
    <div className="grid gap-0">
      <div className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-2.5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-accent-strong">
          Quando parte
        </p>
        <p className="mt-0.5 break-words text-sm font-semibold">{view.trigger}</p>
        <Issues issues={view.general} />
      </div>
      <ol className="grid gap-0">
        {view.steps.map((step) => (
          <li key={`${step.position}:${step.id}`} className="grid">
            <span aria-hidden className="ml-5 h-4 w-px bg-line-strong" />
            <div
              className={cn(
                "rounded-lg border bg-surface px-3 py-2.5",
                step.issues.some((issue) => issue.level === "error")
                  ? "border-danger/50"
                  : step.usesAi
                    ? "border-ai/40"
                    : "border-line",
                !step.reachable && "opacity-70",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[12px] tabular-nums text-muted">{step.position}.</span>
                <span className="font-semibold">{step.title}</span>
                {step.usesAi ? <AiBadge /> : null}
                {!step.known ? <Badge tone="error">Blocco sconosciuto</Badge> : null}
                {!step.reachable ? <Badge tone="warning">Mai raggiunto</Badge> : null}
              </div>
              <p className="mt-1 break-words text-sm text-ink/90">{step.summary}</p>
              {step.exits.length > 0 ? (
                <ul className="mt-2 grid gap-0.5 text-[13px]">
                  {step.exits.map((exit) => (
                    <li key={`${exit.label}:${exit.targetLabel}`} className="flex flex-wrap gap-x-1.5">
                      <span className="text-muted">{exit.label}</span>
                      <span aria-hidden className="text-muted">
                        →
                      </span>
                      <span className="sr-only">porta a</span>
                      <span
                        className={cn("font-medium", exit.broken && "text-danger", exit.ends && "text-muted")}
                      >
                        {exit.targetLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Issues issues={step.issues} />
            </div>
          </li>
        ))}
      </ol>
      <span aria-hidden className="ml-5 h-4 w-px bg-line-strong" />
      <p className="w-fit rounded-full border border-line bg-surface-2 px-3 py-1 text-[13px] text-muted">
        Fine
      </p>
    </div>
  );
}
