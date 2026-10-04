import Anthropic from "@anthropic-ai/sdk";
import type { AiUsage } from "@ia-connect/core";
import { type TokenCounts, addUsage, supportsEffort, supportsServerFallback, usageOf } from "./models.ts";

/** Request sent to Claude. `betas` and `fallbacks` route the call to the beta Messages endpoint. */
export type ClaudeRequest = Anthropic.MessageCreateParamsNonStreaming & {
  betas?: string[];
  fallbacks?: "default";
};

export interface ClaudeTextBlock {
  type: "text";
  text: string;
}
export interface ClaudeToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
/** Thinking and other blocks are passed back untouched. */
export interface ClaudeOtherBlock {
  type: string;
  [key: string]: unknown;
}

/** The part of a Messages API response this package reads. */
export interface ClaudeResponse {
  /** Model that produced the answer; differs from the request after a server-side fallback. */
  model?: string;
  content: (ClaudeTextBlock | ClaudeToolUseBlock | ClaudeOtherBlock)[];
  stop_reason: string | null;
  usage: TokenCounts;
}

/** The slice of the Anthropic client used here; tests pass a scripted fake. */
export interface AnthropicLike {
  messages: { create(request: ClaudeRequest): Promise<ClaudeResponse> };
}

/** Real client. The key is only handed to the SDK: never logged, never put in errors. */
export function createAnthropicClient(apiKey: string): AnthropicLike {
  const sdk = new Anthropic({ apiKey });
  return {
    messages: {
      async create(request) {
        const { betas, fallbacks, ...params } = request;
        if (betas?.length) {
          const response = await sdk.beta.messages.create({
            ...(params as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming),
            betas,
            fallbacks,
          });
          return response as unknown as ClaudeResponse;
        }
        return (await sdk.messages.create(params)) as unknown as ClaudeResponse;
      },
    },
  };
}

/** An AI operation that failed after spending tokens: the caller still logs `usage` in `ai_calls`. */
export class AiOperationError extends Error {
  readonly usage: AiUsage;
  constructor(message: string, usage: AiUsage) {
    super(message);
    this.name = "AiOperationError";
    this.usage = usage;
  }
}

export type Effort = "low" | "medium" | "high";

/**
 * One call. Adds what depends on the model (effort, refusal fallback) and
 * returns the response with its usage, priced on the model that answered.
 */
export async function callClaude(
  client: AnthropicLike,
  request: ClaudeRequest,
  options: { effort?: Effort } = {},
): Promise<{ response: ClaudeResponse; usage: AiUsage }> {
  const shaped: ClaudeRequest = { ...request };
  if (options.effort && supportsEffort(request.model)) {
    shaped.output_config = { ...shaped.output_config, effort: options.effort };
  }
  if (supportsServerFallback(request.model)) {
    shaped.betas = ["server-side-fallback-2026-07-01"];
    shaped.fallbacks = "default";
  }
  const response = await client.messages.create(shaped);
  return { response, usage: usageOf(response.model ?? request.model, response.usage) };
}

/** Accumulates the usage of the calls serving one operation. */
export class UsageMeter {
  private total: AiUsage;
  constructor(model: string) {
    this.total = { model, inputTokens: 0, outputTokens: 0, costMicros: 0 };
  }
  add(usage: AiUsage): void {
    this.total = addUsage(this.total, usage);
  }
  get usage(): AiUsage {
    return { ...this.total };
  }
}

export function textOf(response: ClaudeResponse): string {
  return response.content
    .filter((block): block is ClaudeTextBlock => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
}

export function toolUsesOf(response: ClaudeResponse): ClaudeToolUseBlock[] {
  return response.content.filter((block): block is ClaudeToolUseBlock => block.type === "tool_use");
}

/** The assistant turn exactly as received, to append to the conversation. */
export function assistantTurn(response: ClaudeResponse): Anthropic.MessageParam {
  return { role: "assistant", content: response.content as unknown as Anthropic.ContentBlockParam[] };
}

/** Parses the JSON object of a structured answer; tolerates text around it. */
export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const attempt = (source: string) => {
    try {
      const value: unknown = JSON.parse(source);
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  };
  const direct = attempt(text);
  if (direct) return direct;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? attempt(text.slice(start, end + 1)) : undefined;
}

export function jsonFormat(schema: Record<string, unknown>): Anthropic.OutputConfig {
  return { format: { type: "json_schema", schema } };
}

/** Caps a tool result; the marker tells the model the text was cut. */
export function clip(text: string, max: number): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}\n[…testo troncato: ${text.length - max} caratteri omessi]`;
}
