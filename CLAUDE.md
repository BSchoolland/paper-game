Use `bun run typecheck` for type-checking. Never run `tsc` without `--noEmit` — bun resolves `.ts` directly, so emitted `.js` files shadow the source and cause bugs.
