/**
 * Test 4: perf at turn-based scale.
 *  - 1000 handler dispatches with a realistic payload (8-entity view + modState)
 *    via JSON-string marshaling (the sandbox.ts strategy).
 *  - The same via per-property handle marshaling (newObject/newNumber/... FFI
 *    calls for every field) to see if marshaling strategy dictates API design.
 *  - Gas-metering overhead: same compute loop with and without the interrupt
 *    handler installed.
 *  - Sandbox construction cost (runtime + context + lockdown + prelude + mod
 *    eval): the price of a fresh isolate per dimension-load or per encounter.
 */
import { loadQuickJS, ModSandbox } from "./sandbox";
import { PYRE_MOD_ID, PYRE_MOD_SOURCE } from "./scenario";
import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten-core";

const qjs = await loadQuickJS();
const N = 1000;
const heroes = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `hero-${i}`, hp: 30 + i, x: i * 2, y: 7 - i }));

function bench(label: string, fn: () => void): number {
  fn(); // warm
  const t0 = performance.now();
  fn();
  const ms = performance.now() - t0;
  console.log(`${label}: ${ms.toFixed(1)} ms total, ${((ms / N) * 1000).toFixed(1)} us/call`);
  return ms;
}

// ------------------------------------------------ A. JSON marshaling (the sandbox strategy)
for (const size of [8, 50]) {
  const sb = new ModSandbox(qjs, PYRE_MOD_ID, PYRE_MOD_SOURCE);
  const view = { heroes: heroes(size) };
  let modState: Record<string, string | number> = { clock: 8, heat: 0, weather: "clear" };
  bench(`A. JSON marshaling, ${size}-entity view`, () => {
    for (let i = 1; i <= N; i++) {
      modState = sb.dispatch("turnStart", { turn: i, team: "heroes", view }, modState).modState;
    }
  });
  sb.dispose();
}

// ------------------------------------------------ B. handle marshaling (per-property FFI)
function toHandle(ctx: QuickJSContext, value: unknown): QuickJSHandle {
  if (value === null || value === undefined) return ctx.null;
  switch (typeof value) {
    case "number":
      return ctx.newNumber(value);
    case "string":
      return ctx.newString(value);
    case "boolean":
      return value ? ctx.true : ctx.false;
    case "object": {
      if (Array.isArray(value)) {
        const arr = ctx.newArray();
        value.forEach((v, i) => {
          const h = toHandle(ctx, v);
          ctx.setProp(arr, i, h);
          h.dispose();
        });
        return arr;
      }
      const obj = ctx.newObject();
      for (const [k, v] of Object.entries(value)) {
        const h = toHandle(ctx, v);
        ctx.setProp(obj, k, h);
        h.dispose();
      }
      return obj;
    }
    default:
      throw new Error(`unsupported ${typeof value}`);
  }
}

{
  // Same mod, but a dispatch shim that takes real objects and returns an object
  // handle the host reads back with ctx.dump.
  const runtime = qjs.newRuntime();
  const ctx = runtime.newContext();
  ctx.evalCode(`"use strict";
const __handlers = Object.create(null);
globalThis.mod = { on: (e, f) => (__handlers[e] || (__handlers[e] = [])).push(f) };
globalThis.__dispatchObj = (event, payload, modState) => {
  const ops = [];
  const api = {
    get: (k) => modState[k],
    set: (k, v) => { modState[k] = v; },
    query: (s) => payload.view[s],
    damage: (unitId, amount, label) => ops.push({ type: "damage", unitId, amount, label }),
    emit: (kind, data) => ops.push({ type: "emit", kind, data }),
  };
  for (const h of (__handlers[event] || [])) h(payload, api);
  return { modState, ops };
};`).value.dispose();
  ctx.evalCode(PYRE_MOD_SOURCE).value.dispose();
  const fn = ctx.getProp(ctx.global, "__dispatchObj");
  const view = { heroes: heroes(8) };
  let modState: Record<string, string | number> = { clock: 8, heat: 0, weather: "clear" };
  bench("B. handle marshaling, 8-entity view", () => {
    for (let i = 1; i <= N; i++) {
      const ev = ctx.newString("turnStart");
      const payload = toHandle(ctx, { turn: i, team: "heroes", view });
      const ms = toHandle(ctx, modState);
      const result = ctx.callFunction(fn, ctx.undefined, ev, payload, ms);
      ev.dispose();
      payload.dispose();
      ms.dispose();
      if (result.error) throw new Error("guest error");
      const out = ctx.dump(result.value) as { modState: Record<string, string | number> };
      result.value.dispose();
      modState = out.modState;
    }
  });
  fn.dispose();
  ctx.dispose();
  runtime.dispose();
}

// ------------------------------------------------ C. gas-metering overhead
{
  const run = (withGas: boolean) => {
    const runtime = qjs.newRuntime();
    let fuel = 1_000_000;
    if (withGas) runtime.setInterruptHandler(() => --fuel <= 0);
    const ctx = runtime.newContext();
    ctx.evalCode(`globalThis.spin = (n) => { let x = 0; for (let i = 0; i < n; i++) x += i % 7; return x; };`).value.dispose();
    const fn = ctx.getProp(ctx.global, "spin");
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      fuel = 1_000_000;
      const n = ctx.newNumber(50_000);
      const r = ctx.callFunction(fn, ctx.undefined, n);
      n.dispose();
      if (r.error) throw new Error("err");
      r.value.dispose();
    }
    const ms = performance.now() - t0;
    fn.dispose();
    ctx.dispose();
    runtime.dispose();
    return ms;
  };
  run(true); // warm the wasm
  const withGas = run(true);
  const without = run(false);
  console.log(
    `C. gas overhead: 200x spin(50k) with handler ${withGas.toFixed(1)} ms, without ${without.toFixed(1)} ms, overhead ${(((withGas - without) / without) * 100).toFixed(1)}%`,
  );
}

// ------------------------------------------------ D. sandbox construction cost
{
  const t0 = performance.now();
  const K = 50;
  for (let i = 0; i < K; i++) {
    new ModSandbox(qjs, PYRE_MOD_ID, PYRE_MOD_SOURCE).dispose();
  }
  const ms = (performance.now() - t0) / K;
  console.log(`D. sandbox build+dispose (runtime+context+lockdown+prelude+mod eval): ${ms.toFixed(2)} ms each`);
}

// ------------------------------------------------ E. wasm module load (one-time per process/page)
{
  const t0 = performance.now();
  await loadQuickJS(); // cached; report the cold number from a fresh process below
  console.log(`E. loadQuickJS (cached in-process): ${(performance.now() - t0).toFixed(2)} ms`);
}
