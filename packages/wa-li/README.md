# @quami/wa-li

WhatsApp Cloud API library for Quami apps. See the [repository README](../../README.md) for an overview.

## Entry points

| Import                           | Purpose                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `@quami/wa-li`                   | `createWhatsApp`, domain types, errors, utilities, transports |
| `@quami/wa-li/adapters/memory`   | In-memory adapter (tests, playground fixtures)                |
| `@quami/wa-li/adapters/supabase` | Supabase adapter (needs `@supabase/supabase-js`)              |
| `@quami/wa-li/adapters/contract` | Shared adapter contract suite (needs `vitest`)                |
| `@quami/wa-li/next`              | Next.js route helpers (needs `next`)                          |
| `npx @quami/wa-li`               | CLI: `doctor`, `accounts add`                                 |

Peer dependencies: `zod` ^4 and `ai` ^6. `@supabase/supabase-js`, `next` and `vitest` are optional peers used only by their subpaths.
