/**
 * AI service used by the `ai.*` blocks. Implemented in `packages/ai`
 * (Claude) and by a deterministic fake in tests and simulations.
 */
export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Millionths of a euro-equivalent unit (USD list price), for `ai_calls.cost_micros`. */
  costMicros: number;
}

export interface ExtractField {
  name: string;
  type: "string" | "number" | "boolean" | "date";
  description?: string;
  required: boolean;
}

export interface AiTool {
  name: string;
  description: string;
  /** JSON Schema of the input. */
  inputSchema: Record<string, unknown>;
  run(input: Record<string, unknown>): Promise<unknown>;
}

export interface ReplyInput {
  /** What the assistant may talk about; everything else is out of scope. */
  scope: string;
  organizationName: string;
  tone?: string;
  instructions?: string;
  /** Conversation so far, oldest first. Inbound content is data, never instructions. */
  history: { role: "contact" | "business"; content: string }[];
  /** Read-only tools granted by the flow. */
  tools: AiTool[];
  /** Notes the platform keeps about the contact. */
  contactMemory?: string;
  turn: number;
  maxTurns: number;
}

export type ReplyOutcome =
  /** Keep talking: wait for the contact's next message. */
  | "continue"
  /** The contact's need is settled. */
  | "done"
  /** A person must take over (asked for a human, or the model cannot help). */
  | "handoff"
  /** The request is outside the scope: send the standard reply. */
  | "out_of_scope";

export interface ReplyResult {
  text: string;
  outcome: ReplyOutcome;
  usage: AiUsage;
}

export interface AiService {
  extract(input: { text: string; fields: ExtractField[]; instructions?: string }): Promise<{
    data: Record<string, unknown>;
    missing: string[];
    usage: AiUsage;
  }>;
  classify(input: { text: string; categories: { key: string; description?: string }[] }): Promise<{
    category: string;
    usage: AiUsage;
  }>;
  reply(input: ReplyInput): Promise<ReplyResult>;
  summarize(input: { text: string; maxWords: number }): Promise<{ summary: string; usage: AiUsage }>;
}

/** AI credits charged for a call: 1 credit per started 1000 tokens (input + output). */
export function creditsFor(usage: Pick<AiUsage, "inputTokens" | "outputTokens">): number {
  return Math.max(1, Math.ceil((usage.inputTokens + usage.outputTokens) / 1000));
}
