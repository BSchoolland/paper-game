# mod-sandbox spike

Feasibility spike: Factorio-style code mods as sandboxed JS running in QuickJS
compiled to wasm (`quickjs-emscripten`, singlefile variant so bun / node /
browser execute identical wasm bytes). Self-contained — own package.json, does
not touch the workspaces.

Files:

- `sandbox.ts` — the candidate shared sandbox module (lockdown, capability
  prelude, fuel via interrupt handler, memory limit, loud `ModError` /
  `ModFuelExhausted`, pure `dispatch(event, payload, modState) -> {ops, modState}`).
- `scenario.ts` — shared 100-turn determinism scenario (float/libm/string/sort
  stress mod), SHA-256 transcript hash, optional mid-run isolate rebuild
  (the hotload primitive).
- `run-spike.ts` — tests: capability API, escape attempts, repeated-run
  determinism, fuel interruption (dispatch + load), hotload state law,
  cheating-mod divergence.
- `perf.ts` — 1000-dispatch marshaling benchmarks (JSON vs handles), gas
  overhead, sandbox construction cost.
- `fuel-determinism.ts` — binary-searches the exact loop count a fixed fuel
  budget allows, to prove fuel exhaustion is instruction-exact per engine.
- `browser-entry.ts` / `browser-run.ts`, `fuel-browser-entry.ts` /
  `fuel-browser-run.ts` — the same code driven in headless Chromium via
  playwright-core (uses system `/usr/bin/google-chrome`).

Run:

```sh
bun install
bun run-spike.ts                # bun host
./node_modules/.bin/esbuild run-spike.ts --bundle --format=esm --platform=node \
  --outfile=dist/run-spike.node.mjs && node dist/run-spike.node.mjs   # node host
./node_modules/.bin/esbuild browser-entry.ts --bundle --format=iife \
  --platform=browser --outfile=dist/browser-bundle.js && bun browser-run.ts  # chromium host
bun perf.ts
bun fuel-determinism.ts
./node_modules/.bin/esbuild fuel-browser-entry.ts --bundle --format=iife \
  --platform=browser --outfile=dist/fuel-bundle.js && bun fuel-browser-run.ts
```

Expected: the scenario hash `bd50cabb0bd34f000934c2455520744a2aad98050a1d654c640962bad281f393`
from all three hosts, and fuel threshold `79985` (fuel=16) from all three.
