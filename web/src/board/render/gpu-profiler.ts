import type { Application } from "pixi.js";

/**
 * Opt-in frame profiler (dev builds only): add `?gpuprof` — or `?gpuprof=<spike-ms>` — to the URL.
 *
 * Every paint funnels through `app.render()`, so wrapping it plus the raw WebGL context captures,
 * per painted frame: CPU render time, real GPU time (EXT_disjoint_timer_query_webgl2 — measured on
 * the GPU, not wall clock), draw calls, vertex counts, texture/buffer uploads, and shader
 * compiles/links. A HUD overlay shows rolling 1s stats and the worst frame of the last 5s; any
 * frame whose GPU time crosses the spike threshold is logged to the console with its full
 * counters. `window.__gpuprof.samples()` returns the raw ring buffer.
 */

export interface FrameSample {
  /** performance.now() when the frame's render began. */
  t: number;
  cpuMs: number;
  /** null until the async timer query resolves; stays null if the extension is unavailable. */
  gpuMs: number | null;
  draws: number;
  verts: number;
  texUploads: number;
  bufferKB: number;
  shaderCompiles: number;
  programLinks: number;
}

// ~14 min of continuous 60fps painting (idle frames add no samples); a few MB at worst.
const RING_SIZE = 50_000;
const DEFAULT_SPIKE_MS = 8;

export function installGpuProfiler(app: Application): void {
  const param = new URLSearchParams(location.search).get("gpuprof");
  if (param === null) return;
  const spikeMs = parseFloat(param) || DEFAULT_SPIKE_MS;

  const gl = (app.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
  if (!gl) {
    console.warn("[gpuprof] renderer has no WebGL context (WebGPU?) — profiler not installed");
    return;
  }
  const timerExt = gl.getExtension("EXT_disjoint_timer_query_webgl2") as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  if (!timerExt) {
    console.warn(
      "[gpuprof] EXT_disjoint_timer_query_webgl2 unavailable — GPU ms will read n/a" +
        " (draw/CPU stats still work)",
    );
  }

  // --- Per-frame counters, bumped by the wrapped gl calls below. ---
  const c = {
    draws: 0,
    verts: 0,
    texUploads: 0,
    bufferBytes: 0,
    shaderCompiles: 0,
    programLinks: 0,
  };

  const wrap = <K extends keyof WebGL2RenderingContext>(
    name: K,
    onCall: (...args: any[]) => void,
  ): void => {
    const orig = (gl[name] as (...args: any[]) => any).bind(gl);
    (gl as any)[name] = (...args: any[]) => {
      onCall(...args);
      return orig(...args);
    };
  };

  wrap("drawElements", (_m, count: number) => ((c.draws += 1), (c.verts += count)));
  wrap("drawArrays", (_m, _f, count: number) => ((c.draws += 1), (c.verts += count)));
  wrap("drawElementsInstanced", (_m, count: number, _t, _o, n: number) => {
    c.draws += 1;
    c.verts += count * n;
  });
  wrap("drawArraysInstanced", (_m, _f, count: number, n: number) => {
    c.draws += 1;
    c.verts += count * n;
  });
  wrap("texImage2D", () => (c.texUploads += 1));
  wrap("texSubImage2D", () => (c.texUploads += 1));
  wrap("texStorage2D", () => (c.texUploads += 1));
  wrap("compressedTexImage2D", () => (c.texUploads += 1));
  wrap("bufferData", (_t, data: number | ArrayBufferView | ArrayBuffer | null) => {
    c.bufferBytes += typeof data === "number" ? data : (data?.byteLength ?? 0);
  });
  wrap("bufferSubData", (_t, _o, data: ArrayBufferView | ArrayBuffer) => {
    c.bufferBytes += data.byteLength;
  });
  wrap("compileShader", () => (c.shaderCompiles += 1));
  wrap("linkProgram", () => (c.programLinks += 1));

  // --- GPU timer queries: one per painted frame, resolved a few frames later. ---
  const pending: { query: WebGLQuery; sample: FrameSample }[] = [];
  const samples: FrameSample[] = [];

  function pollQueries(): void {
    if (!timerExt) return;
    if (gl!.getParameter(timerExt.GPU_DISJOINT_EXT)) {
      // Disjoint event (power state change etc.) invalidates in-flight timings.
      for (const p of pending) gl!.deleteQuery(p.query);
      pending.length = 0;
      return;
    }
    let head: { query: WebGLQuery; sample: FrameSample } | undefined;
    while ((head = pending[0]) !== undefined) {
      const { query, sample } = head;
      if (!gl!.getQueryParameter(query, gl!.QUERY_RESULT_AVAILABLE)) break;
      sample.gpuMs = (gl!.getQueryParameter(query, gl!.QUERY_RESULT) as number) / 1e6;
      gl!.deleteQuery(query);
      pending.shift();
      if (sample.gpuMs > spikeMs) console.debug("[gpuprof] spike", sample);
    }
  }

  const origRender = app.render.bind(app);
  (app as { render: () => void }).render = () => {
    c.draws = c.verts = c.texUploads = c.bufferBytes = c.shaderCompiles = c.programLinks = 0;
    const query = timerExt ? gl.createQuery() : null;
    if (query) gl.beginQuery(timerExt!.TIME_ELAPSED_EXT, query);
    const t0 = performance.now();
    origRender();
    const cpuMs = performance.now() - t0;
    if (query) gl.endQuery(timerExt!.TIME_ELAPSED_EXT);

    const sample: FrameSample = {
      t: t0,
      cpuMs,
      gpuMs: null,
      draws: c.draws,
      verts: c.verts,
      texUploads: c.texUploads,
      bufferKB: c.bufferBytes / 1024,
      shaderCompiles: c.shaderCompiles,
      programLinks: c.programLinks,
    };
    if (query) pending.push({ query, sample });
    samples.push(sample);
    if (samples.length > RING_SIZE) samples.shift();
    pollQueries();
  };

  // --- HUD overlay, refreshed on its own cheap interval (the render loop sleeps when idle). ---
  document.getElementById("gpuprof")?.remove();
  const hud = document.createElement("div");
  hud.id = "gpuprof";
  hud.style.cssText =
    "position:fixed;top:8px;left:8px;z-index:99999;pointer-events:none;" +
    "font:11px/1.5 monospace;color:#9f9;background:rgba(0,0,0,.75);" +
    "padding:6px 9px;border-radius:4px;white-space:pre";
  document.body.appendChild(hud);

  const fmt = (n: number, d = 1): string => n.toFixed(d);
  const stats = (xs: number[]): { avg: number; max: number } => ({
    avg: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0,
    max: xs.length ? Math.max(...xs) : 0,
  });

  const interval = setInterval(() => {
    pollQueries();
    const now = performance.now();
    const win1 = samples.filter((s) => now - s.t < 1000);
    const win5 = samples.filter((s) => now - s.t < 5000);
    if (win1.length === 0) {
      hud.textContent = `gpuprof — idle, no frames painted (${samples.length} recorded)`;
      return;
    }
    const cpu = stats(win1.map((s) => s.cpuMs));
    const gpuKnown = win1.map((s) => s.gpuMs).filter((g): g is number => g !== null);
    const gpu = stats(gpuKnown);
    const draws = stats(win1.map((s) => s.draws));
    const verts = stats(win1.map((s) => s.verts));
    const tex = win1.reduce((a, s) => a + s.texUploads, 0);
    const kb = win1.reduce((a, s) => a + s.bufferKB, 0);
    const sh = win1.reduce((a, s) => a + s.shaderCompiles + s.programLinks, 0);
    const worst = win5.reduce((a, s) => ((s.gpuMs ?? s.cpuMs) > (a.gpuMs ?? a.cpuMs) ? s : a));
    const gpuLine = timerExt
      ? `gpu ms  avg ${fmt(gpu.avg)}  max ${fmt(gpu.max)}  (${pending.length} pending)`
      : "gpu ms  n/a — timer ext unavailable";
    hud.textContent =
      `gpuprof  spike>${spikeMs}ms → console\n` +
      `frames  ${win1.length}/s\n` +
      `cpu ms  avg ${fmt(cpu.avg)}  max ${fmt(cpu.max)}\n` +
      `${gpuLine}\n` +
      `draws   avg ${fmt(draws.avg, 0)}  max ${draws.max}\n` +
      `verts   avg ${fmt(verts.avg / 1000)}k  max ${fmt(verts.max / 1000)}k\n` +
      `uploads tex ${tex}/s  buf ${fmt(kb, 0)}KB/s  shader ${sh}/s\n` +
      `worst5s gpu ${worst.gpuMs === null ? "?" : fmt(worst.gpuMs)}  ` +
      `cpu ${fmt(worst.cpuMs)}  draws ${worst.draws}`;
  }, 500);

  const origDestroy = app.destroy.bind(app);
  (app as { destroy: typeof app.destroy }).destroy = (...args) => {
    clearInterval(interval);
    hud.remove();
    origDestroy(...args);
  };

  (window as unknown as { __gpuprof: unknown }).__gpuprof = {
    samples: () => [...samples],
    reset: () => (samples.length = 0),
  };
  console.info(`[gpuprof] installed — spike threshold ${spikeMs}ms, window.__gpuprof for raw data`);
}
