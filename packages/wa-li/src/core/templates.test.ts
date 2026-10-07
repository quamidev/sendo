import { describe, expect, it } from "vitest";
import { countTemplateVariables } from "./services/templates";

describe("template helpers", () => {
  it("counts distinct body placeholders, positional or named", () => {
    expect(countTemplateVariables([{ type: "BODY", text: "{{1}} {{2}} {{1}}" }])).toBe(2);
    expect(countTemplateVariables([{ type: "body", text: "{{name}} {{ city }}" }])).toBe(2);
    expect(countTemplateVariables([{ type: "HEADER", text: "{{1}}" }])).toBe(0);
    expect(countTemplateVariables([])).toBe(0);
  });
});
