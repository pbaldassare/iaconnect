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
        stages: ["new", "quote_sent", "negotiation", "won", "lost"],
      });
      expect(result.issues).toEqual([]);
    },
  );

  it("matches the SQL seed (run `npm run gen:seed` after editing templates)", () => {
    expect(readFileSync(SEED_PATH, "utf8")).toBe(renderSeed());
  });
});
