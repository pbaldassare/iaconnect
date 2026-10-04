import { createClaudeAiService, traceScrapeRecipe } from "@ia-connect/ai";
import { getConnector, listConnectors } from "@ia-connect/connectors";
import type { AiService } from "@ia-connect/core";
import pg from "pg";
import { createPgSql } from "./db/sql.ts";
import { DEFAULT_CONFIG, type Deps, parseOutboundOverride } from "./deps.ts";
import { StepError } from "./errors.ts";
import { createJsonLogger } from "./log.ts";
import { openPlaywrightBrowser } from "./scrape/playwright.ts";
import { createVaultSecretStore } from "./secrets.ts";
import { startWorker } from "./worker.ts";

/** Without an API key every AI block fails with a clear message instead of crashing the worker. */
function unavailableAi(): AiService {
  const fail = async (): Promise<never> => {
    throw new StepError("Il servizio IA non è configurato su questo ambiente.", "ai_unavailable");
  };
  return { extract: fail, classify: fail, reply: fail, summarize: fail };
}

async function main() {
  const env = process.env;
  const logger = createJsonLogger();
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: Number(env.DATABASE_POOL_SIZE) || 10,
    ssl:
      env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: env.DATABASE_SSL_VERIFY === "true" },
  });
  pool.on("error", (error) => logger.error("database pool error", { error: error.message }));
  const sql = createPgSql(pool);

  const apiKey = env.ANTHROPIC_API_KEY;
  const outboundOverride = parseOutboundOverride(env);
  const deps: Deps = {
    sql,
    secrets: createVaultSecretStore(sql),
    connectors: { get: getConnector, list: listConnectors },
    ai: apiKey
      ? createClaudeAiService({ apiKey, smartModel: env.AI_SMART_MODEL, fastModel: env.AI_FAST_MODEL })
      : unavailableAi(),
    now: () => new Date(),
    logger,
    fetch: globalThis.fetch,
    config: {
      ...DEFAULT_CONFIG,
      maxAttempts: Number(env.WORKER_MAX_ATTEMPTS) || DEFAULT_CONFIG.maxAttempts,
      outboundOverride,
      env,
    },
    openBrowser: () => openPlaywrightBrowser(),
    tracer: apiKey
      ? (input) => traceScrapeRecipe({ apiKey, model: env.AI_SMART_MODEL, ...input })
      : undefined,
  };

  const concurrency = Number(env.WORKER_CONCURRENCY) || 4;
  const worker = startWorker(deps, { concurrency });
  logger.info("worker started", {
    concurrency,
    ai: Boolean(apiKey),
    outboundOverride: Boolean(outboundOverride),
    connectors: listConnectors().length,
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info("worker stopping", { signal });
    // Items in progress finish; anything cut short comes back when its lease expires.
    const timer = setTimeout(() => process.exit(1), 60_000);
    await worker.stop();
    await pool.end();
    clearTimeout(timer);
    logger.info("worker stopped");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  createJsonLogger().error("worker crashed at start", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
