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
        find: /^@\/components\/whatsapp\/(.*)$/,
        replacement: path.join(here, "items/wa-li-inbox/components/whatsapp/$1"),
      },
      { find: /^@\/hooks\/(.*)$/, replacement: path.join(here, "items/wa-li-inbox/hooks/$1") },
      {
        find: /^@\/lib\/whatsapp-realtime$/,
        replacement: path.join(here, "items/wa-li-inbox/lib/whatsapp-realtime.ts"),
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
