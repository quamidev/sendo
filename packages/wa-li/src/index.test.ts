import { describe, expect, it } from "vitest";
import * as waLi from "./index";

describe("@quami/wa-li main entry", () => {
  it("loads as an ES module namespace", () => {
    expect(typeof waLi).toBe("object");
  });
});
