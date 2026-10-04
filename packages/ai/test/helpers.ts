import type { AnthropicLike, ClaudeRequest, ClaudeResponse } from "../src/index";

type Scripted = Partial<ClaudeResponse> & Pick<ClaudeResponse, "content">;

/** Scripted client: answers in order and keeps a copy of every request it received. */
export function scriptedClient(responses: Scripted[]) {
  const requests: ClaudeRequest[] = [];
  const queue = [...responses];
  const client: AnthropicLike = {
    messages: {
      async create(request) {
        requests.push(structuredClone(request));
        const next = queue.shift();
        if (!next) throw new Error("Scripted client: no response left");
        return { stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 10 }, ...next };
      },
    },
  };
  return { client, requests };
}

export const json = (value: unknown): Scripted => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

export const toolUse = (name: string, input: unknown, id = `call_${name}`): Scripted => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
});

/** Everything the request carries outside the conversation: system prompt and tool definitions. */
export function instructionsOf(request: ClaudeRequest): string {
  return JSON.stringify([request.system, request.tools]);
}
