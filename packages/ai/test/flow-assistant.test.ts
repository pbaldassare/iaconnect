import type { ValidationContext } from "@ia-connect/core";
import { describe, expect, it } from "vitest";
import { proposeFlow } from "../src/index";
import { scriptedClient, toolUse } from "./helpers";

const WHATSAPP = "7b1f5c0e-3a52-4c5e-9d57-0d6b8f1a2c33";
const validation: ValidationContext = {
  connections: [{ id: WHATSAPP, category: "whatsapp", status: "active" }],
  templates: [{ name: "benvenuto", channel: "whatsapp", approvalStatus: "approved" }],
  stages: ["new", "won"],
};
const base = {
  apiKey: "test",
  model: "claude-opus-5-5",
  description: "Quando arriva un contatto da Facebook mandagli un WhatsApp di benvenuto",
  sector: "insurance",
  connections: [
    { id: WHATSAPP, category: "whatsapp" as const, name: "Numero ufficio", status: "active" as const },
  ],
  templates: [
    { name: "benvenuto", channel: "whatsapp", body: "Buongiorno {{1}}", approvalStatus: "approved" },
  ],
  stages: ["new", "won"],
  validation,
};

const flow = (template: string) => ({
  trigger: { event: "social.lead.received" },
  steps: [
    {
      id: "contact",
      block: "contact.upsert",
      params: { name: "{{event.payload.name}}", phone: "{{event.payload.phone}}" },
    },
    {
      id: "welcome",
      block: "whatsapp.send_template",
      params: { template, variables: { "1": "{{contact.full_name}}" } },
    },
  ],
});

describe("proposeFlow", () => {
  it("feeds validation errors back and returns the corrected definition", async () => {
    const { client, requests } = scriptedClient([
      toolUse(
        "propose_flow",
        { definition: flow("saluto"), questions: [], note: "Prima versione" },
        "call_1",
      ),
      toolUse(
        "propose_flow",
        { definition: flow("benvenuto"), questions: [], note: "Invia il benvenuto." },
        "call_2",
      ),
    ]);
    const result = await proposeFlow({ ...base, client });

    expect(result.definition?.steps.map((step) => step.id)).toEqual(["contact", "welcome"]);
    expect(result.definition?.trigger.filters).toEqual([]);
    expect(result.note).toBe("Invia il benvenuto.");
    expect(result.issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(result.usage).toMatchObject({ model: "claude-opus-5-5", inputTokens: 200, outputTokens: 20 });

    expect(requests).toHaveLength(2);
    const feedback = requests[1]!.messages.at(-1)!.content as {
      type: string;
      tool_use_id: string;
      is_error: boolean;
      content: string;
    }[];
    expect(feedback[0]).toMatchObject({ type: "tool_result", tool_use_id: "call_1", is_error: true });
    expect(feedback[0]!.content).toContain('Il modello \\"saluto\\" non esiste.');
  });

  it("gives the model the catalog, the events and the organization's context, with the static part cached", async () => {
    const { client, requests } = scriptedClient([
      toolUse("propose_flow", { definition: flow("benvenuto"), questions: [], note: "ok" }),
    ]);
    await proposeFlow({ ...base, client, history: [{ role: "assistant", content: "Su quale canale?" }] });

    const request = requests[0]!;
    const system = request.system as { text: string; cache_control?: unknown }[];
    expect(system).toHaveLength(2);
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(system[0]!.text).toContain("whatsapp.send_template");
    expect(system[0]!.text).toContain("social.lead.received");
    expect(system[0]!.text).toContain("onHandoff");
    // The rule that keeps one contact from reading another contact's records.
    expect(system[0]!.text).toContain("matchContact");
    expect(system[0]!.text).toContain("public: true");
    expect(system[0]!.text).not.toContain(WHATSAPP);
    expect(system[1]!.cache_control).toBeUndefined();
    expect(system[1]!.text).toContain(WHATSAPP);
    expect(system[1]!.text).toContain("benvenuto");
    expect(system[1]!.text).toContain("insurance");
    // Forced tool choice is rejected by the current models: the tool is steered from the prompt.
    expect(request.tool_choice).toBeUndefined();
    expect(request.messages[0]!.role).toBe("user");
    expect(String(request.messages.at(-1)!.content)).toContain("Quando arriva un contatto da Facebook");

    // Same static prefix for another organization: the cache entry is shared.
    const other = scriptedClient([toolUse("propose_flow", { questions: ["?"], note: "" })]);
    await proposeFlow({ ...base, client: other.client, sector: "ecommerce", connections: [], templates: [] });
    expect((other.requests[0]!.system as { text: string }[])[0]!.text).toBe(system[0]!.text);
  });

  it("returns the questions when the model asks", async () => {
    const { client, requests } = scriptedClient([
      toolUse("propose_flow", {
        questions: ["Manca un modello WhatsApp approvato per il sollecito: vuoi crearlo?"],
        note: "Serve un modello di messaggio.",
      }),
    ]);
    const result = await proposeFlow({ ...base, client });
    expect(result.definition).toBeUndefined();
    expect(result.questions).toEqual(["Manca un modello WhatsApp approvato per il sollecito: vuoi crearlo?"]);
    expect(result.note).toBe("Serve un modello di messaggio.");
    expect(requests).toHaveLength(1);
  });

  it("never returns an invalid definition", async () => {
    const invented = {
      trigger: { event: "social.lead.received" },
      steps: [{ id: "run", block: "code.execute", params: { js: "fetch('https://evil.test')" } }],
    };
    const { client, requests } = scriptedClient([
      toolUse("propose_flow", { definition: invented, questions: [], note: "a" }, "c1"),
      toolUse("propose_flow", { definition: flow("saluto"), questions: [], note: "b" }, "c2"),
      toolUse("propose_flow", { definition: { trigger: {}, steps: [] }, questions: [], note: "c" }, "c3"),
    ]);
    const result = await proposeFlow({ ...base, client });

    expect(requests).toHaveLength(3);
    expect(result.definition).toBeUndefined();
    expect(result.issues.some((issue) => issue.level === "error")).toBe(true);
    expect(result.note).toContain("Non sono riuscito");
    expect(result.usage.inputTokens).toBe(300);
    expect(JSON.stringify(requests[1]!.messages)).toContain("code.execute");
    expect(JSON.stringify(requests[1]!.messages)).toContain("non esiste nel catalogo");
  });

  it("reminds the model to use the tool, then falls back to its text", async () => {
    const { client, requests } = scriptedClient([
      { content: [{ type: "text", text: "Certo, ecco il flusso." }] },
      toolUse("propose_flow", { definition: flow("benvenuto"), questions: [], note: "ok" }),
    ]);
    const result = await proposeFlow({ ...base, client });
    expect(result.definition).toBeDefined();
    expect(requests[1]!.messages.at(-1)).toEqual({
      role: "user",
      content: "Rispondi chiamando lo strumento propose_flow.",
    });

    const stubborn = scriptedClient(
      Array.from({ length: 3 }, () => ({ content: [{ type: "text", text: "Mi serve sapere il canale." }] })),
    );
    const text = await proposeFlow({ ...base, client: stubborn.client });
    expect(text.definition).toBeUndefined();
    expect(text.note).toBe("Mi serve sapere il canale.");
  });
});
