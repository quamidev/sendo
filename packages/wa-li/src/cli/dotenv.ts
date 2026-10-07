import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Files the CLI loads from the working directory, highest priority first. */
export const DOTENV_FILES = [".env.development.local", ".env.local", ".env"] as const;

const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)?$/;

function unescapeDouble(value: string): string {
  return value.replace(/\\([nrt"\\])/g, (_, ch: string) => {
    switch (ch) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return ch;
    }
  });
}

/**
 * Parses dotenv text: `KEY=value`, `export KEY=value`, `#` comments (full-line
 * and after unquoted values), single quotes (literal), double quotes (`\n`
 * escapes, may span lines) and backticks. Later duplicates win.
 */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = LINE_RE.exec(lines[i] ?? "");
    if (match === null) continue;
    const key = match[1] as string;
    let raw = (match[2] ?? "").trim();
    const quote = raw[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      let body = raw.slice(1);
      let end = findClosing(body, quote);
      while (end === -1 && i + 1 < lines.length) {
        i++;
        body += `\n${lines[i] ?? ""}`;
        end = findClosing(body, quote);
      }
      raw = end === -1 ? body : body.slice(0, end);
      out[key] = quote === '"' ? unescapeDouble(raw) : raw;
      continue;
    }
    const comment = raw.search(/\s#/);
    out[key] = (comment === -1 ? raw : raw.slice(0, comment)).trim();
  }
  return out;
}

function findClosing(body: string, quote: string): number {
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && quote === '"') {
      i++;
      continue;
    }
    if (body[i] === quote) return i;
  }
  return -1;
}

/**
 * Loads `.env.development.local`, `.env.local` and `.env` from `cwd` into `env`
 * without overriding existing values (so the process env and higher priority
 * files win). Returns the files that were found.
 */
export function loadDotenvFiles(
  cwd: string,
  env: Record<string, string | undefined>,
  readFile: (path: string) => string | null = readIfExists,
): string[] {
  const loaded: string[] = [];
  for (const file of DOTENV_FILES) {
    const text = readFile(join(cwd, file));
    if (text === null) continue;
    loaded.push(file);
    for (const [key, value] of Object.entries(parseDotenv(text))) {
      if (env[key] === undefined) env[key] = value;
    }
  }
  return loaded;
}

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
