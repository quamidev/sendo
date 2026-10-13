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
        find: /^@\/components\/sendo\/widgets\/(.*)$/,
        replacement: path.join(here, "items/sendo-widgets/components/sendo/widgets/$1"),
      },
      {
        find: /^@\/components\/sendo\/workflows\/(.*)$/,
        replacement: path.join(here, "items/sendo-workflows/components/sendo/workflows/$1"),
      },
      {
        find: /^@\/components\/sendo\/metrics\/(.*)$/,
        replacement: path.join(here, "items/sendo-metrics/components/sendo/metrics/$1"),
      },
      {
        find: /^@\/components\/sendo\/broadcasts\/(.*)$/,
        replacement: path.join(here, "items/sendo-broadcasts/components/sendo/broadcasts/$1"),
      },
      { find: /^@\/lib\/sendo$/, replacement: path.join(here, "items/sendo-webhook/lib/sendo.ts") },
      {
        find: /^@\/components\/sendo\/numbers\/(.*)$/,
        replacement: path.join(here, "items/sendo-numbers/components/sendo/numbers/$1"),
      },
      {
        find: /^@\/lib\/sendo-embedded-signup$/,
        replacement: path.join(here, "items/sendo-numbers/lib/sendo-embedded-signup.ts"),
      },
      {
        find: /^@\/lib\/sendo-token-store$/,
        replacement: path.join(here, "items/sendo-numbers/lib/sendo-token-store.ts"),
      },
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
