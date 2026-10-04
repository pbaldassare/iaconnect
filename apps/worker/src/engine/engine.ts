import {
  ConnectorError,
  END,
  type FlowDefinition,
  FlowDefinitionSchema,
  type Step,
  getBlock,
  renderTemplate,
  resolveTarget,
} from "@ia-connect/core";
import { ZodError } from "zod";
import { type RunRow, type StepRow, getOrganization, notify } from "../db/repo.ts";
import { type Sql, iso, json } from "../db/sql.ts";
import { type Deps, backoffMs } from "../deps.ts";
import { RetryLater, StepError, errorMessage } from "../errors.ts";
import { scheduleJob } from "../queue.ts";
import { EXECUTORS } from "./blocks/index.ts";
import { buildTemplateContext } from "./context.ts";
import { type RunState, type Signal, type StepContext, type StepResult, stepKey } from "./types.ts";

/**
 * The flow engine. Deterministic and restart-safe:
 * - one `flow_run_steps` row per execution, keyed by `idempotency_key`; a finished row is reused;
 * - a step's result and the run's next position are committed in one transaction;
 * - blocks that leave the platform are never repeated when their outcome is unknown;
 * - waits are `scheduled_jobs`, wake-ups are signals stored in the run context.
 */

export function initialState(
  event: { id: string | null; type: string; payload: Record<string, unknown>; connectionId?: string | null },
  definition: FlowDefinition,
): RunState {
  return { event, steps: {}, _visits: { [definition.steps[0]!.id]: 1 }, _count: 0 };
}

export async function loadDefinition(
  sql: Sql,
  run: RunRow,
): Promise<{ definition: FlowDefinition; flowName: string }> {
  const rows = await sql.query<{ definition: unknown; name: string }>(
    `select v.definition, f.name from ia_connect.flow_versions v join ia_connect.flows f on f.id = v.flow_id
     where v.id = $1 and v.organization_id = $2`,
    [run.flow_version_id, run.organization_id],
  );
  if (!rows[0]) throw new Error(`flow version ${run.flow_version_id} not found`);
  return { definition: FlowDefinitionSchema.parse(rows[0].definition), flowName: rows[0].name };
}

/**
 * Wakes a waiting run up. Returns false when the run is not waiting (any more) for this
 * signal: a late timeout after a reply, a duplicate delivery, a decision taken twice.
 */
export async function signalRun(
  sql: Sql,
  organizationId: string,
  runId: string,
  signal: Signal,
): Promise<boolean> {
  return sql.transaction(async (tx) => {
    const rows = await tx.query<RunRow>(
      "select * from ia_connect.flow_runs where id = $1 and organization_id = $2 and status = 'waiting' for update",
      [runId, organizationId],
    );
    const run = rows[0];
    if (!run?.current_step_id) return false;
    const state = run.context as unknown as RunState;
    const expected: Record<Signal["kind"], string[]> = {
      timer: ["timer"],
      retry: ["timer"],
      reply: ["reply"],
      approval: ["approval"],
      timeout: ["reply", "approval"],
    };
    if (!expected[signal.kind].includes(run.waiting_for ?? "")) return false;
    if ("key" in signal && signal.key !== stepKey(state, run.current_step_id)) return false;
    state._signal = signal;
    if (signal.kind === "reply") state.reply = { text: signal.text, messageId: signal.messageId };
    await tx.query(
      `update ia_connect.flow_runs set status = 'running', waiting_for = null, wait_until = null, context = $2::jsonb
       where id = $1`,
      [run.id, json(state)],
    );
    // The job delivering this signal is `running`, so only the other pending wake-ups are cancelled.
    await tx.query(
      `update ia_connect.scheduled_jobs set status = 'cancelled'
       where flow_run_id = $1 and status = 'pending' and kind in ('resume_run', 'wait_timeout')`,
      [run.id],
    );
    return true;
  });
}

/** Executes a run until it completes, fails or waits. Safe to call again after a crash. */
export async function executeRun(deps: Deps, runId: string): Promise<RunRow | undefined> {
  const now = deps.now();
  const lockUntil = () => iso(new Date(deps.now().getTime() + deps.config.lockMs));
  const claimed = await deps.sql.query<RunRow>(
    `update ia_connect.flow_runs set locked_until = $2::timestamptz
     where id = $1 and (locked_until is null or locked_until < $3::timestamptz) returning *`,
    [runId, lockUntil(), iso(now)],
  );
  let run = claimed[0];
  if (!run) {
    const exists = await deps.sql.query("select 1 from ia_connect.flow_runs where id = $1", [runId]);
    if (exists.length) throw new RetryLater(`run ${runId} is locked by another worker`);
    return undefined;
  }
  try {
    if (run.status !== "running") return run;
    const org = await getOrganization(deps.sql, run.organization_id);
    if (!org || org.status !== "active") {
      const rows = await deps.sql.query<RunRow>(
        `update ia_connect.flow_runs set status = 'cancelled', error = 'Azienda sospesa.', finished_at = $2::timestamptz
         where id = $1 returning *`,
        [run.id, iso(now)],
      );
      return rows[0];
    }
    const { definition, flowName } = await loadDefinition(deps.sql, run);
    while (run.status === "running") {
      run = await executeStep(deps, run, definition, { id: org.id, name: org.name }, flowName);
      await deps.sql.query("update ia_connect.flow_runs set locked_until = $2::timestamptz where id = $1", [
        run.id,
        lockUntil(),
      ]);
    }
    return run;
  } finally {
    await deps.sql
      .query("update ia_connect.flow_runs set locked_until = null where id = $1", [runId])
      .catch(() => undefined);
  }
}

interface Execution {
  ctx: StepContext;
  result: StepResult;
  startedAt: number;
}

async function executeStep(
  deps: Deps,
  run: RunRow,
  definition: FlowDefinition,
  org: { id: string; name: string },
  flowName: string,
): Promise<RunRow> {
  const state = run.context as unknown as RunState;
  state.steps ??= {};
  state._visits ??= {};
  state._count ??= 0;
  const simulation = run.mode === "simulation";
  const stepId = run.current_step_id;
  if (!stepId || stepId === END) return completeRun(deps.sql, run, state, deps.now());

  const step = definition.steps.find((item) => item.id === stepId);
  const block = step ? getBlock(step.block) : undefined;
  const executor = step ? EXECUTORS[step.block] : undefined;
  const key = stepKey(state, stepId);
  const fail = (message: string, aiCostMicros = 0) =>
    deps.sql.transaction((tx) =>
      failRun(
        tx,
        deps,
        run,
        state,
        { stepId, key, block: step?.block ?? "?", flowName },
        message,
        aiCostMicros,
      ),
    );
  if (!step || !block || !executor) {
    return fail(`Il passo "${stepId}" non esiste o usa un blocco non disponibile.`);
  }
  if (state._count >= deps.config.maxStepsPerRun) {
    return fail(`Il flusso ha superato ${deps.config.maxStepsPerRun} passi: probabile ciclo senza uscita.`);
  }

  const existing = (
    await deps.sql.query<StepRow>(
      "select * from ia_connect.flow_run_steps where flow_run_id = $1 and idempotency_key = $2",
      [run.id, key],
    )
  )[0];
  // Already done (crash between a step and the next): reuse the stored outcome, never re-execute.
  if (existing && (existing.status === "succeeded" || existing.status === "simulated")) {
    const stored: StepResult = {
      type: "next",
      outlet: (existing.outlet as never) ?? "next",
      output: (existing.output ?? {}) as Record<string, unknown>,
    };
    const goto = typeof stored.output._goto === "string" ? stored.output._goto : undefined;
    return deps.sql.transaction((tx) => advance(tx, deps, run, state, definition, step, { ...stored, goto }));
  }

  let params: unknown;
  try {
    const templates = await buildTemplateContext(deps.sql, run, state, org);
    params = block.params.parse(renderTemplate(step.params, templates));
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    return fail(describeError(error, false).message);
  }

  const external = !simulation && (block.effect === "external" || executor.external?.(params) === true);
  if (existing?.status === "running" && external) {
    return fail(
      "Il passo era in corso quando il servizio si è interrotto e il suo esito non è certo. " +
        "Per non rischiare un doppio invio il flusso è stato fermato: verificare e, se serve, ripetere a mano.",
    );
  }
  if (existing?.status === "waiting" && !state._signal) {
    // Marked running without a signal: nothing to do but wait again.
    const rows = await deps.sql.query<RunRow>(
      "update ia_connect.flow_runs set status = 'waiting' where id = $1 returning *",
      [run.id],
    );
    return rows[0]!;
  }

  // Local blocks run inside one transaction with their bookkeeping. Blocks that call a
  // connector or the AI must not hold a transaction open while they wait for the network.
  const local = simulation ? !block.usesAi : !external && !block.usesAi && !block.requires;
  const meter = { aiCostMicros: 0 };
  const signal = state._signal;
  const execute = async (sql: Sql): Promise<Execution> => {
    const startedAt = Date.now();
    const rows = await sql.query<{ id: string }>(
      `insert into ia_connect.flow_run_steps (organization_id, flow_run_id, step_id, idempotency_key, block, input, status)
       values ($1, $2, $3, $4, $5, $6::jsonb, 'running')
       on conflict (flow_run_id, idempotency_key) do update set status = 'running', input = excluded.input, error = null
       returning id`,
      [run.organization_id, run.id, step.id, key, step.block, json(params)],
    );
    const ctx: StepContext = {
      deps,
      sql,
      run,
      org,
      definition,
      step,
      block,
      key,
      stepRowId: rows[0]!.id,
      simulation,
      signal,
      state,
      now: deps.now(),
      meter,
    };
    const result =
      simulation && executor.simulate
        ? await executor.simulate(ctx, params)
        : await executor.run(ctx, params);
    if (simulation && result.type === "wait") throw new Error("a simulated step cannot wait");
    return { ctx, result, startedAt };
  };

  try {
    if (local) {
      return await deps.sql.transaction(async (tx) => finalize(tx, deps, definition, await execute(tx)));
    }
    const execution = await execute(deps.sql);
    return await deps.sql.transaction((tx) => finalize(tx, deps, definition, execution));
  } catch (error) {
    if (error instanceof RetryLater) throw error;
    const described = describeError(error, external);
    deps.logger.warn("step failed", {
      runId: run.id,
      stepId,
      block: step.block,
      retryable: described.retryable,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    const attempt = run.attempts + 1;
    if (described.retryable && !simulation && attempt < deps.config.maxStepAttempts) {
      return deps.sql.transaction(async (tx) => {
        const until = new Date(deps.now().getTime() + backoffMs(deps.config, attempt));
        await writeFailedStep(
          tx,
          run,
          { stepId, key, block: step.block },
          described.message,
          meter.aiCostMicros,
        );
        await scheduleJob(tx, {
          organizationId: run.organization_id,
          kind: "resume_run",
          payload: { run_id: run.id, key, signal: "retry" },
          runAt: until,
          flowRunId: run.id,
          dedupeKey: `retry:${run.id}:${key}:${attempt}`,
        });
        const rows = await tx.query<RunRow>(
          `update ia_connect.flow_runs set status = 'waiting', waiting_for = 'timer', wait_until = $2::timestamptz,
             attempts = $3, error = $4 where id = $1 returning *`,
          [run.id, iso(until), attempt, described.message],
        );
        return rows[0]!;
      });
    }
    return fail(described.message, meter.aiCostMicros);
  }
}

/** Italian message for the customer and whether another attempt makes sense. */
function describeError(error: unknown, external: boolean): { message: string; retryable: boolean } {
  if (error instanceof StepError) return { message: error.message, retryable: false };
  if (error instanceof ConnectorError) return { message: error.message, retryable: error.retryable };
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "valore"}: ${issue.message}`);
    return { message: `Parametri non validi (${issues.join("; ")}).`, retryable: false };
  }
  // Anything else is a fault of ours or of the infrastructure. A block that leaves the
  // platform is not repeated (the call may have gone through); a local one is.
  if (external) {
    return {
      message: `Errore imprevisto durante un'azione esterna, il cui esito non è certo: ${errorMessage(error)}`,
      retryable: false,
    };
  }
  return { message: `Errore imprevisto: ${errorMessage(error)}`, retryable: true };
}

async function finalize(
  tx: Sql,
  deps: Deps,
  definition: FlowDefinition,
  execution: Execution,
): Promise<RunRow> {
  const { ctx, result } = execution;
  const duration = Date.now() - execution.startedAt;
  const done = ctx.simulation ? "simulated" : "succeeded";
  if (result.type === "next") {
    // `_goto` keeps a switch's jump with the stored outcome, so a reused row follows it too.
    const output = result.goto ? { ...result.output, _goto: result.goto } : result.output;
    await tx.query(
      `update ia_connect.flow_run_steps set status = $2, output = $3::jsonb, outlet = $4, duration_ms = $5,
         ai_cost_micros = $6, error = null where id = $1`,
      [ctx.stepRowId, done, json(output), result.outlet, duration, ctx.meter.aiCostMicros],
    );
    return advance(tx, deps, ctx.run, ctx.state, definition, ctx.step, result);
  }

  const state = ctx.state;
  let key = ctx.key;
  if (result.repeat) {
    await tx.query(
      `update ia_connect.flow_run_steps set status = $2, output = $3::jsonb, duration_ms = $4, ai_cost_micros = $5,
         error = null where id = $1`,
      [ctx.stepRowId, done, json(result.output ?? {}), duration, ctx.meter.aiCostMicros],
    );
    state.steps[ctx.step.id] = { output: result.output ?? {} };
    state._visits[ctx.step.id] = (state._visits[ctx.step.id] ?? 1) + 1;
    state._count += 1;
    key = stepKey(state, ctx.step.id);
  } else {
    await tx.query(
      `update ia_connect.flow_run_steps set status = 'waiting', output = $2::jsonb, duration_ms = $3,
         ai_cost_micros = $4 where id = $1`,
      [ctx.stepRowId, json(result.output ?? {}), duration, ctx.meter.aiCostMicros],
    );
  }
  state._signal = undefined;
  await scheduleJob(tx, {
    organizationId: ctx.run.organization_id,
    kind: result.job,
    payload: { run_id: ctx.run.id, key, ...(result.job === "resume_run" ? { signal: "timer" } : {}) },
    runAt: result.until,
    flowRunId: ctx.run.id,
    dedupeKey: `wait:${ctx.run.id}:${key}`,
  });
  const rows = await tx.query<RunRow>(
    `update ia_connect.flow_runs set status = 'waiting', waiting_for = $2, wait_until = $3::timestamptz,
       context = $4::jsonb, attempts = 0, error = null, contact_id = $5, conversation_id = $6, deal_id = $7
     where id = $1 returning *`,
    [
      ctx.run.id,
      result.waitingFor,
      iso(result.until),
      json(state),
      ctx.run.contact_id,
      ctx.run.conversation_id,
      ctx.run.deal_id,
    ],
  );
  return rows[0]!;
}

/** Stores the step's output in the context and moves the run to the next step, or ends it. */
async function advance(
  tx: Sql,
  deps: Deps,
  run: RunRow,
  state: RunState,
  definition: FlowDefinition,
  step: Step,
  result: Extract<StepResult, { type: "next" }>,
): Promise<RunRow> {
  const { _goto, ...output } = result.output as Record<string, unknown> & { _goto?: unknown };
  state.steps[step.id] = { output };
  state._signal = undefined;
  state._count += 1;
  let target = result.goto ?? resolveTarget(definition, step, result.outlet);
  if (target !== END && !definition.steps.some((item) => item.id === target)) target = END;
  if (target === END) return completeRun(tx, run, state, deps.now());
  state._visits[target] = (state._visits[target] ?? 0) + 1;
  const rows = await tx.query<RunRow>(
    `update ia_connect.flow_runs set current_step_id = $2, context = $3::jsonb, attempts = 0, error = null,
       status = 'running', waiting_for = null, wait_until = null,
       contact_id = $4, conversation_id = $5, deal_id = $6
     where id = $1 returning *`,
    [run.id, target, json(state), run.contact_id, run.conversation_id, run.deal_id],
  );
  return rows[0]!;
}

async function completeRun(sql: Sql, run: RunRow, state: RunState, at: Date): Promise<RunRow> {
  const rows = await sql.query<RunRow>(
    `update ia_connect.flow_runs set status = 'completed', finished_at = $2::timestamptz, context = $3::jsonb,
       waiting_for = null, wait_until = null, attempts = 0, error = null,
       contact_id = $4, conversation_id = $5, deal_id = $6
     where id = $1 returning *`,
    [run.id, iso(at), json(state), run.contact_id, run.conversation_id, run.deal_id],
  );
  return rows[0]!;
}

async function writeFailedStep(
  tx: Sql,
  run: RunRow,
  step: { stepId: string; key: string; block: string },
  message: string,
  aiCostMicros: number,
) {
  await tx.query(
    `insert into ia_connect.flow_run_steps (organization_id, flow_run_id, step_id, idempotency_key, block, status, error, ai_cost_micros)
     values ($1, $2, $3, $4, $5, 'failed', $6, $7)
     on conflict (flow_run_id, idempotency_key) do update
       set status = 'failed', error = excluded.error, ai_cost_micros = excluded.ai_cost_micros`,
    [run.organization_id, run.id, step.stepId, step.key, step.block, message, aiCostMicros],
  );
}

async function failRun(
  tx: Sql,
  deps: Deps,
  run: RunRow,
  state: RunState,
  step: { stepId: string; key: string; block: string; flowName: string },
  message: string,
  aiCostMicros: number,
): Promise<RunRow> {
  await writeFailedStep(tx, run, step, message, aiCostMicros);
  state._signal = undefined;
  const rows = await tx.query<RunRow>(
    `update ia_connect.flow_runs set status = 'failed', error = $2, finished_at = $3::timestamptz, context = $4::jsonb,
       waiting_for = null, wait_until = null where id = $1 returning *`,
    [run.id, message, iso(deps.now()), json(state)],
  );
  // A simulation is watched by the person who asked for it: no notification.
  if (run.mode === "live") {
    await notify(tx, run.organization_id, {
      kind: "error",
      title: "Flusso non completato",
      body: `Il flusso "${step.flowName}" si è fermato al passo "${step.stepId}": ${message}`,
    });
  }
  return rows[0]!;
}
