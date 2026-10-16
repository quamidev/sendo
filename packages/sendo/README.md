# @quami/sendo

WhatsApp Cloud API library for Quami apps.

- Docs: [sendo.quami.dev](https://sendo.quami.dev) ([Quickstart](https://sendo.quami.dev/docs/quickstart))
- Source and issues: [github.com/quamidev/sendo](https://github.com/quamidev/sendo)

```bash
pnpm add @quami/sendo ai zod
npx shadcn add @sendo/webhook @sendo/schema
```

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
