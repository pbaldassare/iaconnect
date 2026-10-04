import {
  CONTINUING_OUTLETS,
  END,
  type FlowDefinition,
  type Outlet,
  type Step,
  getBlock,
  resolveTarget,
} from "@ia-connect/core";
import { blockTitle, outletLabel, showValue } from "./describe";

/**
 * Layout of a flow as a vertical list: one node per step, each with the exits
 * it can take and where they lead. Pure, unit tested.
 */

export interface GraphExit {
  /** Outlet name, or "case"/"default" for the branches of logic.switch. */
  kind: Outlet | "case" | "default";
  /** Italian label: "se risponde", "alla scadenza", "se vale «auto»". */
  label: string;
  /** Step id, or "end". */
  target: string;
  /** "fine", "3. Invia mail", or "passo inesistente «x»". */
  targetLabel: string;
  /** False when the target comes from the default rule (following step or end). */
  explicit: boolean;
  /** True when the target does not exist in the flow. */
  broken: boolean;
}

export interface GraphNode {
  id: string;
  /** 1-based position in the list. */
  position: number;
  block: string;
  title: string;
  usesAi: boolean;
  /** False when the block key is not in the catalog. */
  known: boolean;
  exits: GraphExit[];
  /** Steps that can lead here (ids). The first step is entered by the trigger. */
  incoming: string[];
  reachable: boolean;
}

function exitOf(
  definition: FlowDefinition,
  positions: ReadonlyMap<string, number>,
  kind: GraphExit["kind"],
  label: string,
  target: string,
  explicit: boolean,
): GraphExit {
  const position = positions.get(target);
  const targetStep = position ? definition.steps[position - 1] : undefined;
  const broken = target !== END && !targetStep;
  return {
    kind,
    label,
    target,
    explicit,
    broken,
    targetLabel:
      target === END
        ? "fine"
        : targetStep
          ? `${position}. ${blockTitle(targetStep.block)}`
          : `passo inesistente «${target}»`,
  };
}

function exitsOf(
  definition: FlowDefinition,
  step: Step,
  positions: ReadonlyMap<string, number>,
): GraphExit[] {
  const block = getBlock(step.block);
  const exits: GraphExit[] = [];

  if (step.block === "logic.switch") {
    const params = step.params as { cases?: { equals?: unknown; goto?: unknown }[]; default?: unknown };
    for (const item of Array.isArray(params.cases) ? params.cases : []) {
      if (typeof item?.goto !== "string") continue;
      exits.push(
        exitOf(definition, positions, "case", `se vale «${showValue(item.equals, 40)}»`, item.goto, true),
      );
    }
    const fallback = typeof params.default === "string" && params.default ? params.default : undefined;
    exits.push(
      exitOf(
        definition,
        positions,
        "default",
        "altrimenti",
        fallback ?? resolveTarget(definition, step, "next"),
        Boolean(fallback ?? step.next),
      ),
    );
    return exits;
  }

  const outlets: readonly Outlet[] = block?.outlets ?? ["next"];
  for (const outlet of outlets) {
    const explicit = Boolean(step[outlet]) || (CONTINUING_OUTLETS.includes(outlet) && Boolean(step.next));
    exits.push(
      exitOf(
        definition,
        positions,
        outlet,
        outletLabel(outlet),
        resolveTarget(definition, step, outlet),
        explicit,
      ),
    );
  }
  return exits;
}

/** Builds the readable graph of a (schema-valid) flow definition. */
export function buildFlowGraph(definition: FlowDefinition): GraphNode[] {
  const positions = new Map<string, number>();
  definition.steps.forEach((step, index) => {
    if (!positions.has(step.id)) positions.set(step.id, index + 1);
  });

  const nodes: GraphNode[] = definition.steps.map((step, index) => {
    const block = getBlock(step.block);
    return {
      id: step.id,
      position: index + 1,
      block: step.block,
      title: block?.title ?? step.block,
      usesAi: block?.usesAi ?? false,
      known: Boolean(block),
      exits: exitsOf(definition, step, positions),
      incoming: [],
      reachable: false,
    };
  });

  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    for (const exit of node.exits) {
      const target = byId.get(exit.target);
      if (target && !target.incoming.includes(node.id)) target.incoming.push(node.id);
    }
  }

  const queue = nodes[0] ? [nodes[0].id] : [];
  while (queue.length) {
    const node = byId.get(queue.pop()!);
    if (!node || node.reachable) continue;
    node.reachable = true;
    for (const exit of node.exits) if (exit.target !== END) queue.push(exit.target);
  }
  return nodes;
}

/** Exits worth a line in the diagram: a single plain "poi → following step" is implied by the list order. */
export function visibleExits(node: GraphNode, nodes: readonly GraphNode[]): GraphExit[] {
  if (node.exits.length !== 1) return node.exits;
  const only = node.exits[0]!;
  const following = nodes[node.position]?.id;
  if (only.kind === "next" && !only.broken && only.target === following) return [];
  return node.exits;
}
