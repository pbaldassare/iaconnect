import { FLOW_TEMPLATES } from "@ia-connect/core";
import { describe, expect, it } from "vitest";
import { blockTitle } from "../src/lib/flows/describe";
import { stepOutcome } from "../src/lib/flows/outcome";
import { stepTitles } from "../src/lib/flows/runs";
import { formatPhone } from "../src/lib/format";

/** Small display helpers added while looking at the customer pages with data (the demo). */
describe("formatPhone", () => {
  it("groups Italian numbers and leaves the rest alone", () => {
    expect(formatPhone("+393330000002")).toBe("+39 333 000 0002");
    expect(formatPhone("+39333000002")).toBe("+39 333 000 002");
    expect(formatPhone("+4915112345678")).toBe("+4915112345678");
    expect(formatPhone("0612345")).toBe("0612345");
    expect(formatPhone(null)).toBe("—");
  });
});

describe("stepTitles", () => {
  it("names the steps of a stored definition by position and block", () => {
    const titles = stepTitles(FLOW_TEMPLATES[0]!.definition, blockTitle);
    expect(titles.get("extract")).toBe(`1. ${blockTitle("ai.extract")}`);
    expect(titles.get("wait_reply")).toBe(`5. ${blockTitle("wait.for_reply")}`);
    expect(titles.get("missing")).toBeUndefined();
  });
  it("gives an empty map for anything that is not a definition", () => {
    expect(stepTitles(null, blockTitle).size).toBe(0);
    expect(stepTitles({ steps: "x" }, blockTitle).size).toBe(0);
    expect(stepTitles({ steps: [null, { id: 1 }] }, blockTitle).size).toBe(0);
  });
});

describe("stepOutcome with stage names", () => {
  const step = {
    block: "deal.update_stage",
    status: "succeeded",
    outlet: "next",
    output: { stage: "quote_sent", dealId: "x" },
  };
  it("shows the name of the stage when the page passes it, the key otherwise", () => {
    const named = stepOutcome(step, { stages: { quote_sent: "Proposta inviata" } });
    expect(named.details).toContainEqual({ label: "Fase", value: "Proposta inviata" });
    expect(stepOutcome(step).details).toContainEqual({ label: "Fase", value: "quote_sent" });
    expect(stepOutcome(step, { stages: {} }).details).toContainEqual({ label: "Fase", value: "quote_sent" });
  });
});
