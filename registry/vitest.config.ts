import path from "node:path";
import { defineConfig } from "vitest/config";

const here = import.meta.dirname;

// Same aliases as tsconfig.json: the items import app paths (`@/...`).
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/components\/ui\/(.*)$/, replacement: path.join(here, "stubs/components/ui/$1") },
      { find: /^@\/lib\/utils$/, replacement: path.join(here, "stubs/lib/utils.ts") },
      {
        find: /^@\/components\/sendo\/(.*)$/,
        replacement: path.join(here, "items/sendo-inbox/components/sendo/$1"),
      },
      { find: /^@\/hooks\/(.*)$/, replacement: path.join(here, "items/sendo-inbox/hooks/$1") },
      {
        find: /^@\/lib\/sendo-realtime$/,
        replacement: path.join(here, "items/sendo-inbox/lib/sendo-realtime.ts"),
      },
    ],
  },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**"],
    environment: "node",
    setupFiles: ["./test/setup.ts"],
  },
});
