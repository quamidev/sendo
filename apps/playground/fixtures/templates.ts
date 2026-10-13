import type { TemplateUpsertInput } from "@quami/sendo";
import templates from "./templates.json";

/** Approved templates (two UTILITY, one MARKETING), seeded in fixtures mode and by `scripts/seed-supabase.mjs`. */
export const FIXTURE_TEMPLATES: TemplateUpsertInput[] = templates;
