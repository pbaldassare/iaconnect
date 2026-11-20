import { parseDirectPhone } from "@/lib/inbox/direct-send";
import { describe, expect, it } from "vitest";

describe("parseDirectPhone", () => {
  it("accepts an international mobile number", () => {
    expect(parseDirectPhone("+39 333 1234567")).toBe("+393331234567");
  });

  it("rejects garbage input", () => {
    expect(parseDirectPhone("non è un numero")).toBeNull();
  });
});
