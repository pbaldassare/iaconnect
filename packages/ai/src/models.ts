import type { AiUsage } from "@ia-connect/core";

/** Capable tier: flow assistant, scrape tracing, `ai.reply`. Override with `AI_MODEL_SMART`. */
export const DEFAULT_SMART_MODEL = "claude-opus-5-5";
/** Cheap, fast tier: `ai.extract`, `ai.classify`, `ai.summarize`, reports. Override with `AI_MODEL_FAST`. */
export const DEFAULT_FAST_MODEL = "claude-haiku-4-5";

export type ModelTier = "smart" | "fast";

function env(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
    name
  ];
  return value?.trim() || undefined;
}

/** Explicit name, then the environment variable of the tier, then the default. */
export function resolveModel(tier: ModelTier, explicit?: string): string {
  if (explicit) return explicit;
  return tier === "smart"
    ? (env("AI_MODEL_SMART") ?? DEFAULT_SMART_MODEL)
    : (env("AI_MODEL_FAST") ?? DEFAULT_FAST_MODEL);
}

export interface ModelPrice {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** USD per million tokens read from the prompt cache. Default: 0.1 × input. */
  cacheRead?: number;
}

/** Cache writes with the default 5-minute TTL cost 1.25 × the input price. */
const CACHE_WRITE_MULTIPLIER = 1.25;
const DEFAULT_CACHE_READ_MULTIPLIER = 0.1;

/**
 * Anthropic first-party list prices (USD per million tokens), from the
 * `claude-api` skill reference cached on 2026-09-25. Update together with the
 * default models; an unknown model costs 0 and keeps its token counts.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Exact id, or the longest known id the name starts with (dated snapshots such as `claude-haiku-4-5-20251001`). */
export function priceFor(model: string): ModelPrice | undefined {
  const exact = MODEL_PRICES[model];
  if (exact) return exact;
  const match = Object.keys(MODEL_PRICES)
    .filter((id) => model.startsWith(`${id}-`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? MODEL_PRICES[match] : undefined;
}

export interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * Cost in millionths of a USD. A price in USD per million tokens is exactly
 * the price of one token in micro-USD, so no scaling is needed.
 */
export function costMicros(model: string, tokens: TokenCounts): number {
  const price = priceFor(model);
  if (!price) return 0;
  const cacheWrite = tokens.cache_creation_input_tokens ?? 0;
  const cacheRead = tokens.cache_read_input_tokens ?? 0;
  const micros =
    tokens.input_tokens * price.input +
    cacheWrite * price.input * CACHE_WRITE_MULTIPLIER +
    cacheRead * (price.cacheRead ?? price.input * DEFAULT_CACHE_READ_MULTIPLIER) +
    tokens.output_tokens * price.output;
  return Math.round(micros);
}

/** Usage of one API call. `inputTokens` includes cached tokens (written and read). */
export function usageOf(model: string, tokens: TokenCounts): AiUsage {
  return {
    model,
    inputTokens:
      tokens.input_tokens + (tokens.cache_creation_input_tokens ?? 0) + (tokens.cache_read_input_tokens ?? 0),
    outputTokens: tokens.output_tokens,
    costMicros: costMicros(model, tokens),
  };
}

export function zeroUsage(model: string): AiUsage {
  return { model, inputTokens: 0, outputTokens: 0, costMicros: 0 };
}

/** Sums the calls of one operation; the model is the one of the latest call. */
export function addUsage(total: AiUsage, call: AiUsage): AiUsage {
  return {
    model: call.model,
    inputTokens: total.inputTokens + call.inputTokens,
    outputTokens: total.outputTokens + call.outputTokens,
    costMicros: total.costMicros + call.costMicros,
  };
}

/** Models whose safety classifiers may decline a request and that accept server-side fallbacks. */
const FALLBACK_MODELS = ["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"];

export function supportsServerFallback(model: string): boolean {
  if (env("AI_SERVER_FALLBACK") === "0") return false;
  return FALLBACK_MODELS.includes(model);
}

/** `output_config.effort` is rejected by Haiku 4.5. */
export function supportsEffort(model: string): boolean {
  return !model.includes("haiku");
}
