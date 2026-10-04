import { describe, expect, it } from "vitest";
import {
  FlowDefinitionSchema,
  ScrapeRecipeSchema,
  type ValidationContext,
  describeCatalog,
  listBlocks,
  normalizePhone,
  parseDuration,
  renderTemplate,
  resolveTarget,
  validateFlow,
  validateRows,
} from "../src/index";

const context: ValidationContext = {
  connections: [{ id: "11111111-1111-4111-8111-111111111111", category: "whatsapp", status: "active" }],
  templates: [{ name: "preventivo", channel: "whatsapp", approvalStatus: "approved" }],
  stages: ["quote_sent", "negotiation"],
};

const quoteFlow = {
  trigger: { event: "quote.requested", filters: [] },
  steps: [
    {
      id: "s1",
      block: "contact.upsert",
      params: { name: "{{event.payload.name}}", phone: "{{event.payload.phone}}" },
    },
    {
      id: "s2",
      block: "whatsapp.send_template",
      params: { template: "preventivo", variables: { "1": "{{contact.full_name}}" } },
    },
    {
      id: "s3",
      block: "deal.create",
      params: { title: "Preventivo {{contact.full_name}}", stage: "quote_sent" },
    },
    { id: "s4", block: "wait.for_reply", params: { timeout: "48h" }, onReply: "s5", onTimeout: "s6" },
    { id: "s5", block: "ai.reply", params: { scope: "Preventivi RC auto", maxTurns: 6 }, next: "end" },
    { id: "s6", block: "whatsapp.send_template", params: { template: "preventivo" } },
  ],
};

describe("duration", () => {
  it("parses units", () => {
    expect(parseDuration("48h")).toBe(48 * 3_600_000);
    expect(parseDuration("2d")).toBe(2 * 86_400_000);
    expect(() => parseDuration("soon")).toThrow();
  });
});

describe("template", () => {
  it("keeps the type of a whole-string expression and interpolates the rest", () => {
    const ctx = { event: { payload: { total: 42, name: "Giulia" } } };
    expect(renderTemplate({ a: "{{event.payload.total}}", b: "Ciao {{event.payload.name}}" }, ctx)).toEqual({
      a: 42,
      b: "Ciao Giulia",
    });
  });
  it("does not walk the prototype chain", () => {
    expect(renderTemplate("{{event.constructor.name}}", { event: {} })).toBeUndefined();
  });
});

describe("normalizePhone", () => {
  it("adds the Italian prefix to national numbers", () => {
    expect(normalizePhone("333 123 4567")).toBe("+393331234567");
    expect(normalizePhone("+39 333 1234567")).toBe("+393331234567");
    expect(normalizePhone("0039 333 1234567")).toBe("+393331234567");
  });
});

describe("flow validation", () => {
  it("accepts the pilot flow", () => {
    const result = validateFlow(quoteFlow, context);
    expect(result.issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects blocks outside the catalog", () => {
    const flow = { ...quoteFlow, steps: [{ id: "s1", block: "code.run", params: { js: "1" } }] };
    const result = validateFlow(flow, context);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("unknown_block");
  });

  it("requires an active connection and an approved template", () => {
    const result = validateFlow(quoteFlow, { ...context, connections: [], templates: [] });
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("connection");
    expect(codes).toContain("template");
  });

  it("flags jumps to missing steps and unknown references", () => {
    const flow = {
      trigger: { event: "manual.test" },
      steps: [
        { id: "s1", block: "wait.delay", params: { duration: "1h" }, next: "nope" },
        { id: "s2", block: "deal.create", params: { title: "{{secrets.key}}" } },
      ],
    };
    const codes = validateFlow(flow, context).issues.map((issue) => issue.code);
    expect(codes).toContain("target");
    expect(codes).toContain("reference");
  });

  it("warns when a branch falls through into another branch", () => {
    const flow = structuredClone(quoteFlow);
    delete (flow.steps[4] as { next?: string }).next;
    const result = validateFlow(flow, context);
    expect(result.issues.some((issue) => issue.code === "fallthrough")).toBe(true);
  });

  it("enforces plan limits", () => {
    const limits = {
      active_flows: 1,
      messages_per_month: 100,
      scrape_runs_per_month: 0,
      ai_credits_per_month: 0,
    };
    const codes = validateFlow(quoteFlow, { ...context, limits, activeFlows: 1 }).issues.map(
      (issue) => issue.code,
    );
    expect(codes).toContain("quota_flows");
    expect(codes).toContain("quota_ai");
  });
});

describe("resolveTarget", () => {
  it("follows explicit targets, then array order, then ends", () => {
    const definition = FlowDefinitionSchema.parse(quoteFlow);
    expect(resolveTarget(definition, definition.steps[3]!, "onTimeout")).toBe("s6");
    expect(resolveTarget(definition, definition.steps[0]!, "next")).toBe("s2");
    expect(resolveTarget(definition, definition.steps[4]!, "next")).toBe("end");
    expect(resolveTarget(definition, definition.steps[5]!, "next")).toBe("end");
  });
});

describe("catalog", () => {
  it("describes every block with a JSON schema", () => {
    const described = describeCatalog();
    expect(described.length).toBe(listBlocks().length);
    for (const block of described) expect(block.params).toHaveProperty("type", "object");
  });
  it("marks exactly the ai.* blocks as AI", () => {
    for (const block of listBlocks()) expect(block.usesAi).toBe(block.key.startsWith("ai."));
  });
});

describe("scrape recipe", () => {
  it("validates rows against the output schema", () => {
    const recipe = ScrapeRecipeSchema.parse({
      steps: [{ action: "goto", url: "https://example.com" }],
      output: {
        keyField: "url",
        fields: [
          { name: "url", type: "url", required: true },
          { name: "price", type: "number" },
        ],
      },
    });
    const { valid, errors } = validateRows(recipe, [
      { url: "https://example.com/a", price: 100 },
      { url: "", price: 1 },
      { url: "https://example.com/b", price: "x" },
    ]);
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(2);
  });
});
