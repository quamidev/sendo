import { describe, expect, it } from "vitest";
import { InvalidPhoneError } from "../errors";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each(["+502.5555.1234", "0050255551234"])("normalizes %s to E.164", (input) => {
    expect(normalizePhone(input)).toBe("+50255551234");
  });

  it("prefixes national numbers with the default country", () => {
    expect(normalizePhone("5555-1234", { defaultCountry: "GT" })).toBe("+50255551234");
    expect(normalizePhone("5555 1234", { defaultCountry: "+502" })).toBe("+50255551234");
    expect(normalizePhone("55 1234 5678", { defaultCountry: "mx" })).toBe("+525512345678");
  });

  it("keeps numbers that already carry the default country's code", () => {
    expect(normalizePhone("50255551234", { defaultCountry: "GT" })).toBe("+50255551234");
    expect(normalizePhone("+1 415 555 0100", { defaultCountry: "GT" })).toBe("+14155550100");
  });

  it.each([
    "",
    "   ",
    "abc",
    "+502 5555-12a4",
    "12345",
    "+0 5555 1234",
    "+1234567890123456",
    "5555+1234",
  ])("throws InvalidPhoneError for %j", (input) => {
    expect(() => normalizePhone(input)).toThrow(InvalidPhoneError);
  });
});
