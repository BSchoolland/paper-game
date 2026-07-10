/**
 * The shared determinism scenario: one mod, 100 turnStart dispatches over a toy
 * combat state, ops applied host-side. The full transcript (every op, every
 * modState snapshot, every toy-state mutation) is serialized and SHA-256
 * hashed. This exact scenario runs under bun, node, and chromium.
 *
 * The mod deliberately exercises float math (libm inside the wasm), string
 * building, array sort, and JSON round-trips — the places engines diverge.
 */
import { loadQuickJS, ModSandbox, type ModOp } from "./sandbox";

export const PYRE_MOD_ID = "d708-mod-pyre-clock";

export const PYRE_MOD_SOURCE = `"use strict";
mod.on("turnStart", (ev, api) => {
  // Doom clock: tick on hero turns only.
  if (ev.team !== "heroes") return;
  const clock = api.get("clock");
  const heat = api.get("heat");
  // Float + libm stress: must be byte-identical everywhere.
  const nextHeat = heat + Math.sin(ev.turn * 0.7) * Math.sqrt(ev.turn + 0.1) + 0.1 + 0.2;
  api.set("heat", nextHeat);
  // Weather from a pure hash of the turn (no RNG allowed anyway).
  const weather = ["clear", "clear", "ashstorm"][ev.turn % 3];
  api.set("weather", weather);
  if (weather === "ashstorm") api.emit("banner", { text: "Ashstorm! Movement costs doubled" });
  if (clock > 1) {
    api.set("clock", clock - 1);
    api.emit("counter", { label: "Pyre clock", value: clock - 1 });
  } else {
    api.set("clock", 8);
    // Strike the two lowest-hp living heroes, ids sorted for determinism.
    const heroes = api.query("heroes")
      .filter((h) => h.hp > 0)
      .sort((a, b) => (a.hp - b.hp) || (a.id < b.id ? -1 : 1))
      .slice(0, 2);
    for (const h of heroes) {
      api.damage(h.id, Math.max(1, Math.round(nextHeat) % 7 + 2), "pyre-clock");
    }
    api.emit("banner", { text: "The Pyre tolls (heat " + nextHeat.toFixed(6) + ")" });
  }
});`;

export interface ToyHero {
  id: string;
  hp: number;
}
export interface ToyState {
  heroes: ToyHero[];
  log: string[];
}

export const INITIAL_MOD_STATE: Record<string, string | number> = {
  clock: 8,
  heat: 0,
  weather: "clear",
};

export function initialToyState(): ToyState {
  return {
    heroes: [
      { id: "hero-a", hp: 30 },
      { id: "hero-b", hp: 24 },
      { id: "hero-c", hp: 41 },
    ],
    log: [],
  };
}

export function applyOps(state: ToyState, ops: readonly ModOp[]): void {
  for (const op of ops) {
    if (op.type === "damage") {
      const hero = state.heroes.find((h) => h.id === op.unitId);
      if (!hero) throw new Error(`damage op targets unknown unit ${String(op.unitId)}`);
      hero.hp = Math.max(0, hero.hp - (op.amount as number));
      if (hero.hp === 0) hero.hp = 25; // toy respawn so the scenario keeps moving
      state.log.push(`damage ${String(op.unitId)} ${String(op.amount)} (${String(op.label)})`);
    } else if (op.type === "emit") {
      state.log.push(`emit ${String(op.kind)} ${JSON.stringify(op.data)}`);
    } else {
      throw new Error(`unknown op type ${op.type}`);
    }
  }
}

export interface ScenarioResult {
  transcript: string;
  hash: string;
  turns: number;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Runs the scenario. If `rebuildAtTurn` is given, the sandbox is disposed and
 * rebuilt from source at that turn boundary, resuming with only (modState,
 * toyState) — the hotload primitive.
 */
export async function runScenario(turns = 100, rebuildAtTurn?: number): Promise<ScenarioResult> {
  const qjs = await loadQuickJS();
  let sandbox = new ModSandbox(qjs, PYRE_MOD_ID, PYRE_MOD_SOURCE);
  let modState = { ...INITIAL_MOD_STATE };
  const toy = initialToyState();
  const lines: string[] = [];
  try {
    for (let turn = 1; turn <= turns; turn++) {
      if (rebuildAtTurn === turn) {
        sandbox.dispose();
        sandbox = new ModSandbox(qjs, PYRE_MOD_ID, PYRE_MOD_SOURCE);
        lines.push(`-- isolate rebuilt at turn ${turn} --`);
      }
      for (const team of ["heroes", "enemies"] as const) {
        const payload = { turn, team, view: { heroes: toy.heroes } };
        const result = sandbox.dispatch("turnStart", payload, modState);
        modState = result.modState;
        applyOps(toy, result.ops);
        lines.push(`t${turn}/${team} modState=${JSON.stringify(modState)} heroes=${JSON.stringify(toy.heroes)}`);
      }
    }
  } finally {
    sandbox.dispose();
  }
  const transcript = lines.join("\n") + "\n" + toy.log.join("\n");
  return { transcript, hash: await sha256Hex(transcript), turns };
}
