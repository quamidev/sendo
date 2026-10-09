import { defineConfig, globalIgnores } from "eslint/config";
import root from "../eslint.config.mjs";

// stubs/ holds verbatim shadcn primitives used only to type-check and test the items.
export default defineConfig([...root, globalIgnores(["stubs/**"])]);
