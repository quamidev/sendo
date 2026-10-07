import { describe, expect, it } from "vitest";
import { loadDotenvFiles, parseDotenv } from "./dotenv";

describe("parseDotenv", () => {
  it("parses plain, exported, quoted and commented values", () => {
    const text = [
      "# comment",
      "",
      "PLAIN=value",
      "export EXPORTED=yes",
      "SPACED = padded value  ",
      "INLINE=abc # trailing comment",
      "HASH=abc#def",
      "SINGLE='literal $x \\n # not comment'",
      'DOUBLE="line1\\nline2 # kept"',
      'MULTI="first',
      'second"',
      "BACKTICK=`tick`",
      "EMPTY=",
      "not a valid line",
      "DUP=1",
      "DUP=2",
    ].join("\r\n");
    expect(parseDotenv(text)).toEqual({
      PLAIN: "value",
      EXPORTED: "yes",
      SPACED: "padded value",
      INLINE: "abc",
      HASH: "abc#def",
      SINGLE: "literal $x \\n # not comment",
      DOUBLE: "line1\nline2 # kept",
      MULTI: "first\nsecond",
      BACKTICK: "tick",
      EMPTY: "",
      DUP: "2",
    });
  });

  it("handles escaped quotes inside double quotes", () => {
    expect(parseDotenv('A="say \\"hi\\""')).toEqual({ A: 'say "hi"' });
  });
});

describe("loadDotenvFiles", () => {
  const files: Record<string, string> = {
    "/app/.env": "A=env\nB=env\nC=env\nD=env",
    "/app/.env.local": "B=local\nC=local",
    "/app/.env.development.local": "C=devlocal",
  };
  const read = (path: string) => files[path] ?? null;

  it("loads in priority order without overriding existing values", () => {
    const env: Record<string, string | undefined> = { D: "process" };
    const loaded = loadDotenvFiles("/app", env, read);
    expect(loaded).toEqual([".env.development.local", ".env.local", ".env"]);
    expect(env).toEqual({ A: "env", B: "local", C: "devlocal", D: "process" });
  });

  it("ignores missing files", () => {
    const env: Record<string, string | undefined> = {};
    expect(loadDotenvFiles("/nowhere", env, read)).toEqual([]);
    expect(env).toEqual({});
  });
});
