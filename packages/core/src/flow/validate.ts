import type { ConnectionStatus, ConnectorCategory, PlanLimits } from "../domain";
import { listReferences } from "../template";
import { getBlock } from "./catalog";
import {
  CONTINUING_OUTLETS,
  END,
  type FlowDefinition,
  FlowDefinitionSchema,
  OUTLETS,
  type Step,
} from "./schema";

export interface ValidationContext {
  connections: { id: string; category: ConnectorCategory; status: ConnectionStatus }[];
  /** Message templates of the organization. */
  templates: { name: string; channel: string; approvalStatus: string }[];
  /** Deal stage keys of the organization. */
  stages: string[];
  limits?: PlanLimits;
  /** Flows already active, not counting this one. */
  activeFlows?: number;
  /** AI credits left this month. */
  aiCreditsLeft?: number;
}

export interface FlowIssue {
  level: "error" | "warning";
  code: string;
  /** Italian, shown to the customer. */
  message: string;
  stepId?: string;
}

export interface ValidationResult {
  ok: boolean;
  definition?: FlowDefinition;
  issues: FlowIssue[];
}

const TEMPLATE_ROOTS = new Set(["event", "steps", "contact", "deal", "org", "reply"]);

/**
 * Validates a flow before simulation or activation: schema, catalog, jumps,
 * connections, message templates, stages and plan limits.
 */
export function validateFlow(input: unknown, context: ValidationContext): ValidationResult {
  const parsed = FlowDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        level: "error" as const,
        code: "schema",
        message: `${issue.path.join(".") || "flusso"}: ${issue.message}`,
      })),
    };
  }
  const definition = parsed.data;
  const issues: FlowIssue[] = [];
  const error = (code: string, message: string, stepId?: string) =>
    issues.push({ level: "error", code, message, stepId });
  const warning = (code: string, message: string, stepId?: string) =>
    issues.push({ level: "warning", code, message, stepId });

  const ids = new Set<string>();
  for (const step of definition.steps) {
    if (ids.has(step.id)) error("duplicate_step", `Il passo "${step.id}" compare due volte.`, step.id);
    ids.add(step.id);
  }
  const targetExists = (target: string) => target === END || ids.has(target);

  if (definition.trigger.connection) {
    const connection = context.connections.find((item) => item.id === definition.trigger.connection);
    if (!connection) error("trigger_connection", "Il collegamento del trigger non esiste.");
    else if (connection.status !== "active")
      error("trigger_connection", "Il collegamento del trigger non è attivo.");
  }

  const branchTargets = new Map<string, string>();
  let usesAi = false;

  definition.steps.forEach((step, index) => {
    const block = getBlock(step.block);
    if (!block) {
      error("unknown_block", `Il blocco "${step.block}" non esiste nel catalogo.`, step.id);
      return;
    }
    if (block.usesAi) usesAi = true;

    const params = block.params.safeParse(step.params);
    if (!params.success) {
      for (const issue of params.error.issues) {
        error("params", `Parametro ${issue.path.join(".") || "(radice)"}: ${issue.message}`, step.id);
      }
    }

    for (const outlet of OUTLETS) {
      const target = step[outlet];
      if (!target) continue;
      if (outlet !== "next" && !block.outlets.includes(outlet)) {
        error("outlet", `Il blocco "${step.block}" non ha l'uscita "${outlet}".`, step.id);
      }
      if (!targetExists(target)) error("target", `"${outlet}" punta a "${target}", che non esiste.`, step.id);
      if (target === step.id && step.block !== "ai.reply") {
        error("self_loop", `"${outlet}" rimanda allo stesso passo.`, step.id);
      }
      if (outlet !== "next" && target !== END) branchTargets.set(target, `${step.id}.${outlet}`);
    }

    if (step.block === "logic.switch" && params.success) {
      const data = params.data as { cases: { goto: string }[]; default?: string };
      for (const target of [...data.cases.map((item) => item.goto), data.default]) {
        if (target && !targetExists(target)) {
          error("target", `La diramazione punta a "${target}", che non esiste.`, step.id);
        }
      }
    }

    if (block.requires) {
      const wanted = typeof step.params.connection === "string" ? step.params.connection : undefined;
      const candidates = context.connections.filter((item) => item.category === block.requires);
      const chosen = wanted
        ? candidates.find((item) => item.id === wanted)
        : candidates.find((item) => item.status === "active");
      if (!chosen) {
        error("connection", `Serve un collegamento attivo di tipo "${block.requires}".`, step.id);
      } else if (chosen.status !== "active") {
        error("connection", `Il collegamento scelto non è attivo (stato: ${chosen.status}).`, step.id);
      }
    }

    if (step.block === "whatsapp.send_template" && typeof step.params.template === "string") {
      const template = context.templates.find(
        (item) => item.name === step.params.template && item.channel === "whatsapp",
      );
      if (!template) error("template", `Il modello "${step.params.template}" non esiste.`, step.id);
      else if (template.approvalStatus !== "approved") {
        error("template", `Il modello "${step.params.template}" non è ancora approvato.`, step.id);
      }
    }

    if (
      (step.block === "deal.create" || step.block === "deal.update_stage") &&
      typeof step.params.stage === "string"
    ) {
      if (!step.params.stage.includes("{{") && !context.stages.includes(step.params.stage)) {
        error("stage", `La fase "${step.params.stage}" non esiste.`, step.id);
      }
    }

    for (const reference of listReferences(step.params)) {
      const [root, stepId] = reference.split(".");
      if (!root || !TEMPLATE_ROOTS.has(root)) {
        error("reference", `Riferimento sconosciuto: {{${reference}}}.`, step.id);
      } else if (root === "steps" && stepId && !ids.has(stepId)) {
        error("reference", `{{${reference}}} cita un passo che non esiste.`, step.id);
      }
    }

    // A step that simply falls through into another branch's target is almost always a mistake.
    const following = definition.steps[index + 1];
    if (
      following &&
      !step.next &&
      block.outlets.some((outlet) => CONTINUING_OUTLETS.includes(outlet) && !step[outlet])
    ) {
      const owner = branchTargets.get(following.id);
      if (owner && !owner.startsWith(`${step.id}.`)) {
        warning(
          "fallthrough",
          `Dopo "${step.id}" il flusso prosegue in "${following.id}", che è il ramo ${owner}. Se non è voluto, aggiungi "next": "end".`,
          step.id,
        );
      }
    }
  });

  for (const step of unreachable(definition)) {
    warning("unreachable", `Il passo "${step.id}" non viene mai raggiunto.`, step.id);
  }

  if (context.limits) {
    if (context.activeFlows !== undefined && context.activeFlows >= context.limits.active_flows) {
      error("quota_flows", `Il piano consente ${context.limits.active_flows} flussi attivi.`);
    }
    if (usesAi && context.limits.ai_credits_per_month <= 0) {
      error("quota_ai", "Il piano non include crediti IA: rimuovi i blocchi IA o cambia piano.");
    } else if (usesAi && context.aiCreditsLeft !== undefined && context.aiCreditsLeft <= 0) {
      warning("quota_ai", "I crediti IA del mese sono esauriti: i blocchi IA falliranno.");
    }
  }

  return { ok: !issues.some((issue) => issue.level === "error"), definition, issues };
}

function unreachable(definition: FlowDefinition): Step[] {
  const byId = new Map(definition.steps.map((step) => [step.id, step]));
  const seen = new Set<string>();
  const queue = [definition.steps[0]!.id];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id) || id === END) continue;
    seen.add(id);
    const step = byId.get(id);
    if (!step) continue;
    const index = definition.steps.indexOf(step);
    const block = getBlock(step.block);
    const targets: (string | undefined)[] = OUTLETS.map((outlet) => step[outlet]);
    // Implicit fall-through applies when a continuing outlet has no explicit target.
    const outlets = block?.outlets ?? ["next"];
    if (!step.next && outlets.some((outlet) => CONTINUING_OUTLETS.includes(outlet) && !step[outlet])) {
      targets.push(definition.steps[index + 1]?.id);
    }
    if (step.block === "logic.switch") {
      const params = step.params as { cases?: { goto?: string }[]; default?: string };
      for (const item of params.cases ?? []) targets.push(item.goto);
      targets.push(params.default);
    }
    for (const target of targets) if (target) queue.push(target);
  }
  return definition.steps.filter((step) => !seen.has(step.id));
}
