#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { runCli, type CliPromptSession } from "./main";

function createPrompt(): CliPromptSession {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    prompt: async (question) => (await rl.question(`${question}: `)).trim(),
    close: () => {
      rl.close();
    },
  };
}

process.exitCode = await runCli(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  createPrompt: process.stdin.isTTY ? createPrompt : undefined,
  stdio: { stdin: process.stdin, stdout: process.stdout },
});
