import { z } from "zod";
import { isKnownEventType } from "../events.ts";

export const END = "end";

const StepId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Step id: lowercase letters, digits, underscore");
/** A jump target: another step id, or "end" to stop the run. */
const Target = z.union([StepId, z.literal(END)]);

export const FILTER_OPERATORS = [
  "eq",
  "neq",
  "contains",
  "not_contains",
  "starts_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "not_exists",
  "in",
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const FilterSchema = z.object({
  /** Path inside the event, e.g. "payload.subject". */
  field: z.string().min(1),
  operator: z.enum(FILTER_OPERATORS),
  value: z.unknown().optional(),
});
export type Filter = z.infer<typeof FilterSchema>;

export const TriggerSchema = z.object({
  event: z.string().refine(isKnownEventType, "Unknown event type"),
  /** Restrict to events from one connection. Omitted = any connection of the organization. */
  connection: z.string().uuid().optional(),
  filters: z.array(FilterSchema).default([]),
});

/** Named exits of a step. Which ones a block uses is declared in the catalog. */
export const OUTLETS = [
  "next",
  "onReply",
  "onTimeout",
  "onTrue",
  "onFalse",
  "onApproved",
  "onRejected",
  "onHandoff",
] as const;
export type Outlet = (typeof OUTLETS)[number];

export const StepSchema = z.object({
  id: StepId,
  block: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  /** Omitted = the following step in the array; after the last step the run ends. */
  next: Target.optional(),
  onReply: Target.optional(),
  onTimeout: Target.optional(),
  onTrue: Target.optional(),
  onFalse: Target.optional(),
  onApproved: Target.optional(),
  onRejected: Target.optional(),
  onHandoff: Target.optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const FlowDefinitionSchema = z.object({
  trigger: TriggerSchema,
  steps: z.array(StepSchema).min(1).max(60),
});
export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;

/** Exits that, without an explicit target, continue like `next`. The others end the run. */
export const CONTINUING_OUTLETS: readonly Outlet[] = ["next", "onReply", "onTrue", "onApproved"];

/**
 * Where a run goes when `step` exits through `outlet`. Returns "end" when the run is over.
 * Without an explicit target: next/onReply/onTrue/onApproved continue with `step.next` or
 * the following step; onFalse/onTimeout/onRejected/onHandoff end the run.
 */
export function resolveTarget(definition: FlowDefinition, step: Step, outlet: Outlet): string {
  const explicit = step[outlet];
  if (explicit) return explicit;
  if (!CONTINUING_OUTLETS.includes(outlet)) return END;
  if (step.next) return step.next;
  const index = definition.steps.findIndex((item) => item.id === step.id);
  return definition.steps[index + 1]?.id ?? END;
}

export function evaluateFilter(filter: Filter, actual: unknown): boolean {
  const expected = filter.value;
  const text = (value: unknown) => String(value ?? "").toLowerCase();
  switch (filter.operator) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "not_exists":
      return actual === undefined || actual === null || actual === "";
    case "eq":
      return text(actual) === text(expected);
    case "neq":
      return text(actual) !== text(expected);
    case "contains":
      return text(actual).includes(text(expected));
    case "not_contains":
      return !text(actual).includes(text(expected));
    case "starts_with":
      return text(actual).startsWith(text(expected));
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "in":
      return Array.isArray(expected) && expected.some((item) => text(item) === text(actual));
  }
}
