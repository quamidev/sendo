import { describe, expect, it } from "vitest";
import { requireUser } from "./inbox-config";

describe("inbox-config template", () => {
  it("fails closed until requireUser() is implemented", async () => {
    await expect(requireUser()).rejects.toThrow(/implement requireUser\(\)/);
  });
});
