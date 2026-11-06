# shadcn stock — provenance

Copy-own stock, vendored the same way as the AppKit stock: the editor's
catalog carries the real sources so the agent installs from here, not from
the network.

- **Components** (`ui/*.tsx`): byte-exact from shadcn-ui/ui at commit
  `42f3bb63b46a69e52a24bd005cdc9ec15ba7a7b9` (2026-11-06), path
  `apps/v4/registry/new-york-v4/ui/`, with ONE change: dialog.tsx imports
  Button from `./button` instead of the upstream registry-internal path
  `@/registry/new-york-v4/ui/button`. MIT licensed (shadcn-ui/ui).
- **Theme** (`theme.css`): the standard Tailwind v4 shadcn base theme
  (neutral oklch palette, light + `.dark`) as published in shadcn's
  Tailwind v4 theming documentation. The upstream repo carries no single
  installable copy of this file for the v4 style.
- **Runtime dependencies** a project needs to use these components:
  `radix-ui`, `lucide-react`, `cn`, `class-variance-authority`, plus
  Tailwind CSS v4 with `@tailwindcss/vite`. Components import `cn` from
  the `cn` package directly (upstream v4 convention). Pin `cn` at
  current versions (^0.5.2): the 0.1.x line under that name is an
  unrelated jokes CLI that drags in the Node `request` package and
  breaks browser builds.
- **Catalog entries** are generated from these sources by
  `scripts/extract-shadcn.ts` (props/variants parsed from the TSX;
  one-line descriptions are registry curation in that script).
