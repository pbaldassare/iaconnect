import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEED_PATH, renderSeed } from "../../../scripts/gen-seed";
import { CONNECTOR_CATEGORIES, FLOW_TEMPLATES, validateFlow } from "../src/index";

describe("flow templates", () => {
  it.each(FLOW_TEMPLATES.map((template) => [template.key, template] as const))(
    "%s is valid",
    (_, template) => {
      const result = validateFlow(template.definition, {
        connections: CONNECTOR_CATEGORIES.map((category, index) => ({
          id: `00000000-0000-4000-8000-00000000000${index}`,
          category,
          status: "active" as const,
        })),
        templates: template.requirements.messageTemplates.map((item) => ({
          name: item.name,
          channel: item.channel,
          approvalStatus: "approved",
        })),
        // A fresh pipeline plus the stages the template asks the installer to create.
        stages: [
          "new",
          "quote_sent",
          "negotiation",
          "won",
          "lost",
          ...(template.requirements.stages ?? []).map((stage) => stage.key),
        ],
      });
      expect(result.issues).toEqual([]);
    },
  );

  it("the renewal templates start from the management-system events and fill the deal fields they declare", () => {
    for (const [key, event] of [
      ["insurance_policy_renewal", "policy.expiring"],
      ["insurance_quote_expiring", "quote.expiring"],
    ] as const) {
      const template = FLOW_TEMPLATES.find((item) => item.key === key)!;
      expect(template.definition.trigger.event).toBe(event);
      expect(template.requirements.stages).toEqual([
        { key: "renewal_due", name: "In scadenza", kind: "open" },
      ]);
      const deal = template.definition.steps.find((step) => step.block === "deal.create")!;
      expect(deal.params.stage).toBe("renewal_due");
      const written = Object.keys(deal.params.fields as Record<string, unknown>).sort();
      expect(written).toEqual(template.requirements.dealFields!.map((field) => field.key).sort());
      expect(template.requirements.dealFields!.find((field) => field.key === "scadenza")!.type).toBe("date");
      // Every message template carries the automatic-message disclosure.
      for (const message of template.requirements.messageTemplates) {
        expect(message.body).toContain("Questo è un messaggio automatico.");
      }
    }
  });

  it("matches the SQL seed (run `npm run gen:seed` after editing templates)", () => {
    expect(readFileSync(SEED_PATH, "utf8")).toBe(renderSeed());
  });

  it("the hardening migration carries the current order follow-up template (the seed file was already applied)", () => {
    const sql = readFileSync(new URL("20261004001000_security_hardening.sql", SEED_PATH), "utf8");
    const template = FLOW_TEMPLATES.find((item) => item.key === "ecommerce_order_followup")!;
    expect(sql).toContain(
      `set definition = '${JSON.stringify(template.definition).replace(/'/g, "''")}'::jsonb\nwhere key = 'ecommerce_order_followup';`,
    );
    const reply = template.definition.steps.find((step) => step.block === "ai.reply")!;
    expect(reply.params.readResources).toEqual([
      expect.objectContaining({ resource: "orders", matchContact: { field: "phone", by: "phone" } }),
    ]);
  });
});
