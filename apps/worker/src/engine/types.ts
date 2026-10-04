import type { BlockDefinition, FlowDefinition, Outlet, Step } from "@ia-connect/core";
import type { RunRow } from "../db/repo.ts";
import type { Sql } from "../db/sql.ts";
import type { Deps } from "../deps.ts";

/** What woke a waiting run up. Stored in the run context, so a restart sees it again. */
export type Signal =
  | { kind: "timer"; key: string }
  | { kind: "retry"; key: string }
  | { kind: "timeout"; key: string }
  | { kind: "reply"; text: string; messageId: string }
  | { kind: "approval"; decision: "approved" | "rejected" };

/** `flow_runs.context`. Keys starting with "_" are engine bookkeeping, not template roots. */
export interface RunState {
  event: { id: string | null; type: string; payload: Record<string, unknown>; connectionId?: string | null };
  steps: Record<string, { output: Record<string, unknown> }>;
  reply?: { text: string; messageId: string | null };
  /** How many times each step was entered: the n-th visit uses the key `<step>#n`. */
  _visits: Record<string, number>;
  /** Steps executed so far, to stop flows that loop forever. */
  _count: number;
  _signal?: Signal;
  /** Simulation only: the contact and deal that would exist, since nothing is written. */
  _sim?: { contact?: Record<string, unknown>; deal?: Record<string, unknown> };
}

export interface StepContext {
  deps: Deps;
  /** The step's transaction for local blocks; the pool for blocks that call out. */
  sql: Sql;
  /** Mutable: executors set contact_id, conversation_id and deal_id; the engine persists them. */
  run: RunRow;
  org: { id: string; name: string };
  definition: FlowDefinition;
  step: Step;
  block: BlockDefinition;
  /** Idempotency key of this execution: `<step id>` or `<step id>#<n>`. */
  key: string;
  stepRowId: string;
  simulation: boolean;
  signal?: Signal;
  state: RunState;
  now: Date;
  /** AI spend of this execution, stored on the step row. */
  meter: { aiCostMicros: number };
}

export type StepResult =
  | { type: "next"; outlet: Outlet; output: Record<string, unknown>; goto?: string }
  | {
      type: "wait";
      waitingFor: "reply" | "timer" | "approval";
      until: Date;
      /** Job that wakes the run up at `until`. */
      job: "resume_run" | "wait_timeout";
      output?: Record<string, unknown>;
      /** True when this execution is complete and the wake-up starts a new one (ai.reply turns). */
      repeat?: boolean;
    };

// biome-ignore lint/suspicious/noExplicitAny: params are validated by the block's zod schema before `run`
export interface Executor<P = any> {
  /** Blocks that leave the platform only for some params (human.notify_owner via WhatsApp). */
  external?(params: P): boolean;
  run(ctx: StepContext, params: P): Promise<StepResult>;
  /** Simulation: no external call, no write to customer data. Falls back to `run` when absent. */
  simulate?(ctx: StepContext, params: P): Promise<StepResult>;
}

export const next = (output: Record<string, unknown> = {}, outlet: Outlet = "next"): StepResult => ({
  type: "next",
  outlet,
  output,
});

export function stepKey(state: RunState, stepId: string): string {
  const visit = state._visits?.[stepId] ?? 1;
  return visit <= 1 ? stepId : `${stepId}#${visit}`;
}
