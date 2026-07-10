/** Browser harness: runs the shared determinism scenario + fuel check in a real
 * Chromium page and exposes the result on window.__spikeResult. */
import { loadQuickJS, ModSandbox, ModFuelExhausted } from "./sandbox";
import { runScenario, PYRE_MOD_ID, PYRE_MOD_SOURCE } from "./scenario";

declare global {
  interface Window {
    __spikeResult: Promise<unknown>;
  }
}

window.__spikeResult = (async () => {
  const a = await runScenario(100);
  const b = await runScenario(100, 51); // hotload variant, must hash-match after marker strip
  const strip = (t: string) =>
    t.split("\n").filter((l) => !l.startsWith("-- isolate rebuilt")).join("\n");

  const qjs = await loadQuickJS();
  const sandbox = new ModSandbox(qjs, "d708-mod-evil-loop", `mod.on("turnStart", () => { for(;;); });`, {
    fuelPerDispatch: 256,
  });
  let fuelCaught = "none";
  const t0 = performance.now();
  try {
    sandbox.dispatch("turnStart", { turn: 1, team: "heroes", view: {} }, {});
  } catch (e) {
    fuelCaught = e instanceof ModFuelExhausted ? "ModFuelExhausted" : String(e);
  }
  const fuelMs = performance.now() - t0;
  const escape = sandbox.probe("Math.random()");
  sandbox.dispose();

  // quick perf sample in-browser: 1000 dispatches, JSON marshaling
  const perfSandbox = new ModSandbox(qjs, PYRE_MOD_ID, PYRE_MOD_SOURCE);
  let modState: Record<string, string | number> = { clock: 8, heat: 0, weather: "clear" };
  const heroes = Array.from({ length: 8 }, (_, i) => ({ id: `hero-${i}`, hp: 30 + i }));
  const p0 = performance.now();
  for (let i = 1; i <= 1000; i++) {
    modState = perfSandbox.dispatch("turnStart", { turn: i, team: "heroes", view: { heroes } }, modState).modState;
  }
  const perCallUs = ((performance.now() - p0) / 1000) * 1000;
  perfSandbox.dispose();

  return {
    engine: "chromium",
    scenarioHash: a.hash,
    repeatedIdentical: a.hash === (await runScenario(100)).hash,
    hotloadIdentical: strip(a.transcript) === strip(b.transcript),
    fuel: { caught: fuelCaught, ms: +fuelMs.toFixed(2) },
    escapeMathRandom: escape,
    perfPerCallMicroseconds: +perCallUs.toFixed(1),
  };
})();
