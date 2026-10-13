import path from "node:path";
import { defineConfig } from "vitest/config";

const registryInbox = path.join(import.meta.dirname, "../../registry/items/inbox");

// Same aliases as tsconfig.json: the site renders the registry's inbox from source.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\/components\/sendo\/(.*)$/,
        replacement: path.join(registryInbox, "components/sendo/$1"),
      },
      {
        find: /^@\/hooks\/use-sendo-realtime$/,
        replacement: path.join(registryInbox, "hooks/use-sendo-realtime.ts"),
      },
      { find: /^@\/(.*)$/, replacement: path.join(import.meta.dirname, "$1") },
    ],
  },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**"],
    environment: "node",
  },
});
