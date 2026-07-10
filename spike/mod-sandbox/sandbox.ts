/**
 * Mod sandbox spike: QuickJS (wasm) hosting Factorio-style code mods.
 *
 * One module, three hosts: bun (server/sim), node (cross-engine check), browser
 * (client prediction). Uses the singlefile wasm variant (base64-inlined) so all
 * hosts execute the IDENTICAL wasm bytes — determinism comes from the wasm
 * interpreter, not the host JS engine.
 *
 * State law (Factorio `global`-table discipline): a handler receives the event
 * payload + current modState, and returns ops + new modState. The isolate is
 * allowed to be torn down between any two dispatches; nothing the mod stores in
 * guest globals is promised to survive. Hotload = dispose + rebuild + hand back
 * the same modState.
 */
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-singlefile-browser-release-sync";

export interface ModOp {
  readonly type: string;
  readonly [k: string]: unknown;
}

export interface DispatchResult {
  readonly modState: Record<string, string | number>;
  readonly ops: readonly ModOp[];
}

/** Loud, catchable: a broken mod fails the encounter, never falls back. */
export class ModError extends Error {
  constructor(
    readonly modId: string,
    readonly phase: "load" | "dispatch",
    message: string,
  ) {
    super(`[mod ${modId}/${phase}] ${message}`);
    this.name = "ModError";
  }
}

export class ModFuelExhausted extends ModError {
  constructor(modId: string, phase: "load" | "dispatch") {
    super(modId, phase, "fuel budget exhausted (interrupted)");
    this.name = "ModFuelExhausted";
  }
}

/**
 * Runs before any mod code. Removes every source of ambient nondeterminism /
 * authority QuickJS ships with. Bare QuickJS has no fetch/timers/process/fs —
 * the only leaks are the clock (Date) and Math.random.
 */
const LOCKDOWN = `"use strict";
(() => {
  const forbid = (name) => () => { throw new Error(name + " is forbidden in mod code"); };
  Math.random = forbid("Math.random");
  Object.freeze(Math);
  globalThis.Date = function Date() { throw new Error("Date is forbidden in mod code"); };
  globalThis.Date.now = forbid("Date.now");
  Object.freeze(globalThis.Date);
})();`;

/**
 * The guest-side dispatch shim. Mods call mod.on(event, handler); the host
 * calls __dispatch with JSON strings and gets a JSON string back. The
 * capability API is deliberately tiny and returns-only: query reads the view
 * the host chose to expose, everything else records an op.
 */
const PRELUDE = `"use strict";
const __handlers = Object.create(null);
globalThis.mod = Object.freeze({
  on(event, fn) {
    if (typeof fn !== "function") throw new TypeError("mod.on: handler must be a function");
    (__handlers[event] || (__handlers[event] = [])).push(fn);
  },
});
globalThis.__dispatch = (event, payloadJson, modStateJson) => {
  const payload = JSON.parse(payloadJson);
  const modState = JSON.parse(modStateJson);
  const ops = [];
  const api = Object.freeze({
    get: (key) => modState[key],
    set: (key, value) => {
      if (typeof value !== "string" && typeof value !== "number") {
        throw new TypeError("modState values must be string or number, got " + typeof value);
      }
      modState[key] = value;
    },
    query: (selector) => {
      const view = payload.view || {};
      if (!(selector in view)) throw new Error("query: unknown selector '" + selector + "'");
      return view[selector];
    },
    damage: (unitId, amount, label) => {
      if (!Number.isInteger(amount) || amount <= 0) throw new TypeError("damage: amount must be a positive integer");
      ops.push({ type: "damage", unitId, amount, label });
    },
    emit: (kind, data) => { ops.push({ type: "emit", kind, data }); },
  });
  for (const h of (__handlers[event] || [])) h(payload, api);
  return JSON.stringify({ modState, ops });
};`;

let modulePromise: Promise<QuickJSWASMModule> | undefined;
export function loadQuickJS(): Promise<QuickJSWASMModule> {
  return (modulePromise ??= newQuickJSWASMModuleFromVariant(
    Promise.resolve(variant),
  ));
}

export interface SandboxOptions {
  /** Interrupt-handler ticks allowed per evaluation. QuickJS polls the handler
   * roughly every few thousand interpreted ops, so this is coarse fuel. */
  fuelPerDispatch?: number;
  memoryLimitBytes?: number;
}

export class ModSandbox {
  private runtime: QuickJSRuntime;
  private context: QuickJSContext;
  private fuel = 0;
  private fuelBudget: number;
  private disposed = false;

  constructor(
    qjs: QuickJSWASMModule,
    readonly modId: string,
    modSource: string,
    opts: SandboxOptions = {},
  ) {
    this.fuelBudget = opts.fuelPerDispatch ?? 1024;
    this.runtime = qjs.newRuntime();
    this.runtime.setMemoryLimit(opts.memoryLimitBytes ?? 32 * 1024 * 1024);
    this.runtime.setMaxStackSize(1024 * 1024);
    this.runtime.setInterruptHandler(() => --this.fuel <= 0);
    this.context = this.runtime.newContext();
    this.evalOrThrow(LOCKDOWN, "lockdown", "load");
    this.evalOrThrow(PRELUDE, "prelude", "load");
    this.evalOrThrow(modSource, `${modId}.js`, "load");
  }

  private evalOrThrow(code: string, filename: string, phase: "load" | "dispatch"): void {
    this.fuel = this.fuelBudget;
    const result = this.context.evalCode(code, filename);
    if (result.error) {
      const detail = this.context.dump(result.error);
      result.error.dispose();
      this.throwGuestError(detail, phase);
    }
    result.value.dispose();
  }

  private throwGuestError(detail: unknown, phase: "load" | "dispatch"): never {
    const msg =
      typeof detail === "object" && detail !== null && "message" in detail
        ? `${(detail as { name?: string }).name ?? "Error"}: ${(detail as { message: string }).message}`
        : JSON.stringify(detail);
    if (/interrupted/i.test(msg)) throw new ModFuelExhausted(this.modId, phase);
    throw new ModError(this.modId, phase, msg);
  }

  /**
   * Pure event dispatch: (event, payload, modState) -> { ops, modState }.
   * The guest may not retain anything between calls; all persistence flows
   * through the returned modState (enforced socially + by hotload tests, not
   * mechanically — see spike notes).
   */
  dispatch(
    event: string,
    payload: unknown,
    modState: Record<string, string | number>,
  ): DispatchResult {
    if (this.disposed) throw new ModError(this.modId, "dispatch", "sandbox disposed");
    this.fuel = this.fuelBudget;
    const ctx = this.context;
    const fn = ctx.getProp(ctx.global, "__dispatch");
    const args = [
      ctx.newString(event),
      ctx.newString(JSON.stringify(payload)),
      ctx.newString(JSON.stringify(modState)),
    ];
    const result = ctx.callFunction(fn, ctx.undefined, ...args);
    fn.dispose();
    for (const a of args) a.dispose();
    if (result.error) {
      const detail = ctx.dump(result.error);
      result.error.dispose();
      this.throwGuestError(detail, "dispatch");
    }
    const json = ctx.getString(result.value);
    result.value.dispose();
    return JSON.parse(json) as DispatchResult;
  }

  /** Raw eval for escape-attempt probes. Returns dump of the completion value. */
  probe(code: string): { ok: boolean; value?: unknown; error?: string } {
    this.fuel = this.fuelBudget;
    const result = this.context.evalCode(code, "probe.js");
    if (result.error) {
      const detail = this.context.dump(result.error);
      result.error.dispose();
      const msg =
        typeof detail === "object" && detail !== null && "message" in detail
          ? String((detail as { message: unknown }).message)
          : JSON.stringify(detail);
      return { ok: false, error: msg };
    }
    const value = this.context.dump(result.value);
    result.value.dispose();
    return { ok: true, value };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.context.dispose();
    this.runtime.dispose();
  }
}
