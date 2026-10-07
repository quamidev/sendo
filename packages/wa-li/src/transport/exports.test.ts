import { describe, expect, it } from "vitest";
import * as waLi from "../index";

describe("@quami/wa-li main entry (client and transport)", () => {
  it.each([
    "createGraphClient",
    "GRAPH_API_VERSION",
    "buildTextPayload",
    "buildMediaPayload",
    "buildButtonsPayload",
    "buildListPayload",
    "buildTemplatePayload",
    "buildReactionPayload",
    "metaDirect",
    "quamiCloud",
    "createRedactingLogger",
  ])("exports %s", (name) => {
    expect(waLi).toHaveProperty(name);
  });
});
