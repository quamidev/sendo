# @quami/sendo

WhatsApp Cloud API library for Quami apps. See the [repository README](../../README.md) for an overview.

## Entry points

| Import                           | Purpose                                                    |
| -------------------------------- | ---------------------------------------------------------- |
| `@quami/sendo`                   | `createSendo`, domain types, errors, utilities, transports |
| `@quami/sendo/adapters/memory`   | In-memory adapter (tests, playground fixtures)             |
| `@quami/sendo/adapters/supabase` | Supabase adapter (needs `@supabase/supabase-js`)           |
| `@quami/sendo/adapters/contract` | Shared adapter contract suite (needs `vitest`)             |
| `@quami/sendo/next`              | Next.js route helpers (needs `next`)                       |
| `npx @quami/sendo`               | CLI: `doctor`, `accounts`, `rules sync`, `mcp` (agents)    |

Peer dependencies: `zod` ^4 and `ai` ^6. `@supabase/supabase-js`, `next` and `vitest` are optional peers used only by their subpaths.
