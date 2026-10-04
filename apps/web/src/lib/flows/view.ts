import type { FlowDefinition, FlowIssue } from "@ia-connect/core";
import { groupIssues, issueText } from "./context";
import { type DescribeNames, describeStep, describeTrigger } from "./describe";
import { buildFlowGraph, visibleExits } from "./graph";

/**
 * Everything the readable diagram shows, as plain data: built on the server
 * (or in a server action) and rendered by components/flows/flow-diagram.tsx,
 * also inside client components. Pure, unit tested.
 */

export interface DiagramIssue {
  level: "error" | "warning";
  text: string;
}

export interface DiagramStep {
  id: string;
  position: number;
  title: string;
  /** One-line Italian summary of the step's parameters. */
  summary: string;
  usesAi: boolean;
  known: boolean;
  reachable: boolean;
  exits: { label: string; targetLabel: string; broken: boolean; ends: boolean }[];
  issues: DiagramIssue[];
}

export interface DiagramView {
  trigger: string;
  steps: DiagramStep[];
  /** Issues that do not belong to a step. */
  general: DiagramIssue[];
  errors: number;
  warnings: number;
}

export function buildDiagram(
  definition: FlowDefinition,
  issues: readonly FlowIssue[] = [],
  names: DescribeNames = {},
): DiagramView {
  const grouped = groupIssues(issues);
  const nodes = buildFlowGraph(definition);
  const toView = (issue: FlowIssue): DiagramIssue => ({ level: issue.level, text: issueText(issue) });
  return {
    trigger: describeTrigger(definition.trigger, names),
    steps: nodes.map((node, index) => ({
      id: node.id,
      position: node.position,
      title: node.title,
      summary: describeStep(definition.steps[index]!, names),
      usesAi: node.usesAi,
      known: node.known,
      reachable: node.reachable,
      exits: visibleExits(node, nodes).map((exit) => ({
        label: exit.label,
        targetLabel: exit.targetLabel,
        broken: exit.broken,
        ends: exit.target === "end",
      })),
      issues: (grouped.byStep.get(node.id) ?? []).map(toView),
    })),
    general: grouped.general.map(toView),
    errors: grouped.errors,
    warnings: grouped.warnings,
  };
}
