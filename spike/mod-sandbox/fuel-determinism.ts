/**
 * Is fuel exhaustion deterministic? QuickJS polls the interrupt handler on an
 * internal instruction countdown, so with the same wasm the poll points should
 * be instruction-exact, not time-based. Proof: binary-search the largest loop
 * count N that survives a fixed fuel budget. If the threshold is identical
 * across bun / node / chromium, a mod near its budget behaves identically
 * everywhere (no server/client desync at the fuel boundary).
 */
import { loadQuickJS, ModSandbox, ModFuelExhausted } from "./sandbox";

export async function fuelThreshold(fuel: number): Promise<number> {
  const qjs = await loadQuickJS();
  const src = `"use strict";
mod.on("spin", (ev, api) => { let x = 0; for (let i = 0; i < ev.n; i++) x += i; api.set("x", x); });`;
  const survives = (n: number): boolean => {
    const sb = new ModSandbox(qjs, "fuel-probe", src, { fuelPerDispatch: fuel });
    try {
      sb.dispatch("spin", { n, view: {} }, {});
      return true;
    } catch (e) {
      if (e instanceof ModFuelExhausted) return false;
      throw e;
    } finally {
      sb.dispose();
    }
  };
  let lo = 0;
  let hi = 1;
  while (survives(hi)) {
    lo = hi;
    hi *= 2;
    if (hi > 1e9) throw new Error("budget never exhausted");
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (survives(mid)) lo = mid;
    else hi = mid;
  }
  return lo; // largest n that completes within the budget
}

if (typeof window === "undefined") {
  const engine = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined" ? "bun" : "node";
  void fuelThreshold(16).then((t) => {
    console.log(JSON.stringify({ engine, fuel: 16, maxLoopIterations: t }));
  });
}
