import type { DiagramView } from "@/lib/flows/view";

/** What the assistant actions exchange with the chat component. Plain data only. */
export interface AssistantRequest {
  /** Existing flow being modified; null when creating a new one. */
  flowId: string | null;
  /** What the customer just wrote. */
  description: string;
  /** Earlier turns of this chat, oldest first. */
  history: { role: "user" | "assistant"; content: string }[];
  /** JSON of the latest proposal in this chat, to refine it; omitted on the first turn. */
  currentJson?: string;
}

export interface AssistantProposal {
  /** Present when the assistant produced a flow that passes validation. */
  definitionJson: string | null;
  diagram: DiagramView | null;
  questions: string[];
  note: string;
  /** Issues left without a valid definition (shown as text). */
  leftoverIssues: string[];
  /** AI credits used by this request. */
  credits: number;
}

export type AssistantReply = { ok: true; proposal: AssistantProposal } | { ok: false; message: string };

export interface SaveProposalRequest {
  flowId: string | null;
  /** Name of the new flow (ignored when `flowId` is set). */
  name: string;
  definitionJson: string;
  note: string;
}

export type SaveProposalReply =
  | { ok: true; flowId: string; versionId: string }
  | { ok: false; message: string };
