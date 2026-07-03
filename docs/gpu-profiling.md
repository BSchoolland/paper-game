# GPU profiling

## Findings from the 2026-07 investigation

Measured on a 165Hz, 2×-DPI panel driven by an iGPU (Radeon 780M). Summary:

- The game's own WebGL work is trivial: ~0.35–0.5ms GPU and 1–6 draw calls per
  frame. Draw-call/batching optimization is pointless here.
- The dominant cost is the browser compositing pipeline: every painted frame
  redraws the full window (4096×2202 device px) through Chrome's compositor and
  again through the desktop compositor. **Any** visual damage costs the same —
  a 3px DOM marker moving measured identical to a full game frame (~85% GFX at
  max clock when repeated at 165Hz). This floor is not reachable from JS.
- `FrameDriver`'s render-on-demand design works: canvas-idle GPU is near zero.
  Its `MIN_PAINT_MS` cap keeps sustained animation to every 2nd vsync on
  120Hz+ panels.
- Known remaining offenders (deliberately left for now): `timing-bar.ts` and
  `defend-prompt.ts` run their own uncapped rAF loops during combat — each tick
  mutates DOM (full recomposite) and calls `clientState.notify()`, which
  triggers a full `gameRenderer.render()` scene rebuild via BoardHost's
  subscription. `hex-camera.ts` key-pan is also a raw rAF loop (and its
  `PAN_SPEED` is per-tick, i.e. refresh-rate-dependent). The clean fix is
  routing all three through `FrameDriver.requestFrames`.
- Second-order: ~850KB of vertex buffer re-uploaded per painted frame
  (Graphics retessellation), and occasional 15–25ms CPU frames inside
  `app.render()`. Jank/battery relevant, not GPU-load relevant.
- On typical player hardware (1080p60, 1× DPI) all of this is ~9× cheaper —
  the dev machine is the pathological case. Quick dev trick: drop the panel
  to 60Hz while playtesting.

Three layers, from coarse to fine. Start at the top and only descend once the
layer above has pointed at a culprit.

## 1. Which process / engine is busy — `amdgpu_top`

```sh
amdgpu_top            # TUI; per-engine busy (GFX/Compute/DMA) + per-process GPU%
amdgpu_top --smi      # nvidia-smi-style summary with the process list
amdgpu_top -J -u 2 > gpu.jsonl   # stream JSON while playing, dig through it after
```

This machine has two GPUs — the iGPU (Phoenix / Radeon 780M, currently driving
the display and the game) and the dGPU (Navi 33). Make sure you're looking at
the right device (`-i <n>` selects one).

What it answers: is the spike even Chrome's GPU process? Is it graphics (GFX)
or something else (video encode, compositor)? If the in-game HUD (layer 3) says
"idle, no frames painted" while GFX is pegged, the cost is outside the Pixi
canvas — CSS animations, DOM compositing, video — not the game renderer.

## 2. Which frames — Chrome tooling

- `chrome://gpu` — confirms the acceleration stack.
- DevTools → Performance: record while reproducing the spike; the GPU track
  shows per-frame GPU time correlated with JS/paint activity.
- DevTools → Rendering panel → "Frame Rendering Stats" for a quick live overlay.

## 3. Which draw calls — in-game profiler + frame capture

### Built-in HUD (`?gpuprof`)

Dev builds only. Load the game with `?gpuprof` (or `?gpuprof=5` to set the
spike threshold in ms). The overlay shows, over a rolling 1s window: frames
painted, CPU render ms, **real GPU ms** (WebGL timer queries, measured on the
GPU), draw calls, vertices, texture/buffer uploads, and shader compiles —
plus the worst frame of the last 5s. Any frame over the threshold is dumped to
the console with its full counters, so spikes are attributable to what was
happening on screen at that moment. `window.__gpuprof.samples()` returns the
raw per-frame ring buffer.

Implementation: `web/src/board/render/gpu-profiler.ts`, installed from
`BoardHost.svelte` behind `import.meta.env.DEV`.

### Frame capture

- **Spector.js** (Chrome extension): capture one frame → every GL call, draw
  call, render target, texture and shader state, with per-call timings. The
  right tool once the HUD says "this moment is expensive" and you need to see
  *what* was drawn.
- **PixiJS Devtools** (Chrome extension): live scene graph, per-container
  render stats. `BoardHost` exposes `window.__PIXI_APP__` in dev for it.
