import { describe, expect, it } from "vitest";
import { buildOrgAiInstructions, parseBusinessProfile, parseAiTraining } from "../src/settings/org-ai-context.ts";

describe("org-ai-context", () => {
  it("parses empty profile", () => {
    expect(parseBusinessProfile(null).locations).toEqual([]);
  });

  it("builds instructions from profile and training", () => {
    const text = buildOrgAiInstructions({
      manual: "Non dare prezzi.",
      businessProfile: {
        summary: "Agenzia assicurativa a Desenzano.",
        openingHours: [{ label: "Lun–Ven", hours: "9:00–13:00, 15:00–19:00" }],
        locations: [
          { name: "Sede centrale", address: "Via Roma 12, Desenzano del Garda", phone: "+39 030 123456" },
        ],
      },
      aiTraining: {
        entries: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            question: "Dove siete?",
            answer: "Siamo in Via Roma 12 a Desenzano.",
            active: true,
          },
        ],
      },
    });
    expect(text).toContain("Non dare prezzi");
    expect(text).toContain("Via Roma 12");
    expect(text).toContain("Dove siete");
  });

  it("skips inactive training", () => {
    const text = buildOrgAiInstructions({
      aiTraining: parseAiTraining({
        entries: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            question: "Test",
            answer: "Nascosta",
            active: false,
          },
        ],
      }),
    });
    expect(text).toBeUndefined();
  });
});