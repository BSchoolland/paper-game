/**
 * Spike driver: capability API + escapes (1), determinism across repeated runs
 * (2a), fuel (3), hotload/state law (5). Perf is perf.ts; cross-engine and
 * browser determinism are compare-engines.sh + browser-run.ts.
 *
 * Run under bun AND node: `bun run-spike.ts` / `node --experimental-strip-types run-spike.ts`
 * (node 22: use the compiled variant via tsx-free JSON output — see compare-engines.sh).
 */
import { loadQuickJS, ModSandbox, ModError, ModFuelExhausted } from "./sandbox";
import { runScenario, PYRE_MOD_ID, PYRE_MOD_SOURCE } from "./scenario";

const out: Record<string, unknown> = {};

function section(name: string, data: unknown) {
  out[name] = data;
  console.error(`\n=== ${name} ===\n${JSON.stringify(data, null, 2)}`);
}

const qjs = await loadQuickJS();

// ---------------------------------------------------------------- 1. capability API + no ambient authority
{
  const sandbox = new ModSandbox(qjs, PYRE_MOD_ID, PYRE_MOD_SOURCE);
  const result = sandbox.dispatch(
    "turnStart",
    { turn: 3, team: "heroes", view: { heroes: [{ id: "hero-a", hp: 10 }] } },
    { clock: 1, heat: 5, weather: "clear" },
  );
  section("1a. handler ran via capability API", result);

  const escapes: Record<string, unknown> = {};
  const probes: Record<string, string> = {
    "Math.random()": "Math.random()",
    "Date.now()": "Date.now()",
    "new Date()": "new Date()",
    "typeof fetch": "typeof fetch",
    "typeof process": "typeof process",
    "typeof require": "typeof require",
    "typeof setTimeout": "typeof setTimeout",
    "typeof XMLHttpRequest": "typeof XMLHttpRequest",
    "typeof WebAssembly": "typeof WebAssembly",
    "Function ctor escape": `Function("return typeof process")()`,
    "constructor chain escape": `({}).constructor.constructor("return typeof globalThis.process")()`,
    "eval reaches same locked global": `eval("typeof fetch")`,
    "Math.random unfreezable": `(Object.defineProperty(Math, "random", { value: () => 4 }), Math.random())`,
  };
  for (const [name, code] of Object.entries(probes)) escapes[name] = sandbox.probe(code);
  sandbox.dispose();
  section("1b. escape attempts", escapes);
}

// ---------------------------------------------------------------- 2a. determinism across repeated runs (same engine)
{
  const a = await runScenario(100);
  const b = await runScenario(100);
  section("2a. repeated-run determinism", {
    engine: typeof (globalThis as { Bun?: unknown }).Bun !== "undefined" ? "bun" : "node",
    hashRun1: a.hash,
    hashRun2: b.hash,
    identical: a.hash === b.hash,
    transcriptBytes: a.transcript.length,
  });
}

// ---------------------------------------------------------------- 3. fuel: infinite loop interrupted, loud + catchable
{
  const loopMod = `"use strict";
mod.on("turnStart", () => { let x = 0; while (true) x++; });`;
  const sandbox = new ModSandbox(qjs, "d708-mod-evil-loop", loopMod, { fuelPerDispatch: 256 });
  let caught: unknown;
  const t0 = performance.now();
  try {
    sandbox.dispatch("turnStart", { turn: 1, team: "heroes", view: {} }, {});
  } catch (e) {
    caught = e;
  }
  const ms = performance.now() - t0;
  // Sandbox must remain usable after an interrupt (encounter fails, process fine).
  const stillAlive = sandbox.probe("1 + 1");
  sandbox.dispose();

  // Load-time infinite loop must also be interrupted (broken mod -> dimension refuses to start).
  let loadCaught: unknown;
  try {
    new ModSandbox(qjs, "d708-mod-evil-toploop", `while (true) {}`, { fuelPerDispatch: 256 });
  } catch (e) {
    loadCaught = e;
  }
  section("3. fuel interruption", {
    dispatchInterrupt: {
      caughtType: (caught as Error)?.name,
      isModFuelExhausted: caught instanceof ModFuelExhausted,
      isModError: caught instanceof ModError,
      message: (caught as Error)?.message,
      millisecondsToInterrupt: +ms.toFixed(2),
      sandboxUsableAfter: stillAlive,
    },
    loadInterrupt: {
      caughtType: (loadCaught as Error)?.name,
      message: (loadCaught as Error)?.message,
    },
  });
}

// ---------------------------------------------------------------- 5. state law: teardown + rebuild resumes identically
{
  const uninterrupted = await runScenario(100);
  const hotloaded = await runScenario(100, 51); // dispose + rebuild isolate at turn 51
  const strip = (t: string) =>
    t.split("\n").filter((l) => !l.startsWith("-- isolate rebuilt")).join("\n");
  const same = strip(uninterrupted.transcript) === strip(hotloaded.transcript);

  // Counter-demo: a CHEATING mod that keeps state in a guest global diverges
  // after hotload — this is exactly what the state law forbids and why.
  const cheater = `"use strict";
let hidden = 0; // illegal: guest-global persistence
mod.on("turnStart", (ev, api) => { hidden++; api.set("count", hidden); });`;
  const runCheater = (rebuild: boolean) => {
    let sb = new ModSandbox(qjs, "d708-mod-cheater", cheater);
    let ms: Record<string, string | number> = { count: 0 };
    for (let turn = 1; turn <= 10; turn++) {
      if (rebuild && turn === 6) {
        sb.dispose();
        sb = new ModSandbox(qjs, "d708-mod-cheater", cheater);
      }
      ms = sb.dispatch("turnStart", { turn, team: "heroes", view: {} }, ms).modState;
    }
    sb.dispose();
    return ms.count;
  };
  section("5. hotload / state law", {
    lawAbidingMod: {
      uninterruptedHash: uninterrupted.hash,
      rebuiltMidRunIdentical: same,
    },
    cheatingMod: {
      countWithoutRebuild: runCheater(false),
      countWithRebuild: runCheater(true),
      divergenceDetectable: runCheater(false) !== runCheater(true),
    },
  });
}

// Machine-readable summary on stdout (stderr carried the pretty sections).
console.log(JSON.stringify(out));
