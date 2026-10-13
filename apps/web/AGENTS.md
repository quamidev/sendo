<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## How the site uses the registry inbox

The landing and `/demo` render the real `inbox` component **from the registry source**, not
from a copy: `tsconfig.json` (used by Turbopack and `tsc`) and `vitest.config.ts` alias
`@/components/sendo/*` → `registry/items/inbox/components/sendo/*` and
`@/hooks/use-sendo-realtime` → the item's hook. Everything else the item imports resolves in this
app, as it would after `npx shadcn add`: the shadcn primitives in `components/ui/` (copied from
`registry/stubs`), `@/lib/utils`, and the app-owned `lib/sendo-realtime.ts` (returns the demo's
in-page realtime stand-in instead of a Supabase client). `app/globals.css` adds the item to
Tailwind with `@source`. A change to the inbox item shows up here on the next build; if an item
starts importing a new primitive, add it to `components/ui/`.

The inbox runs inside an iframe (`/demo/inbox`, route group `(frame)`) so its responsive layout
follows the frame's width. Its data: fixtures seeded into a memory adapter and read with the real
`sendo.inbox` API at render time (`lib/demo/`), plus the visitor's conversation, which the host
page sends with `postMessage` after every `/api/demo` turn (`components/demo/`).
