# Registry stubs

Stand-ins for what an app provides once it installs a registry item, so `tsc` and the component
tests in `items/` run inside this workspace:

- `components/ui/*`: shadcn/ui (new-york) primitives the `inbox` and `numbers` items
  list in `registryDependencies`, copied verbatim from `apps/playground/components/ui` (installed there with
  the shadcn CLI).
- `lib/utils.ts`: the shadcn `cn()` helper.

`tsconfig.json` and `vitest.config.ts` map `@/components/ui/*` and `@/lib/utils` here. These files are
not part of any registry item. After updating the playground's primitives, copy them again.
