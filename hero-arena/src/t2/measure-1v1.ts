#!/usr/bin/env bun
import { resolveAction } from "../../../shared/src/index.js";
import type { EntityId, PlayerAction, TeamId } from "../../../shared/src/index.js";
import { buildArena2 } from "./arena2.js";
import { FIGHTER_TEMPLATE } from "./loadouts.js";
import type { ArenaConfig } from "./types.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../agents/agent-02/sovereign.js";
import type { IntelligencePreset } from "../../agents/agent-02/sovereign.js";
import type { HeroController } from "../types.js";

const MAX_HERO_ACTIONS = 16;
const MAX_TURNS = 80;

const preset = (process.argv[2] ?? "crafty") as IntelligencePreset;
const seed = Number(process.argv[3] ?? 42);

const samples: number[] = [];
const wrap = (ctl: HeroController): HeroController => (ctx) => {
  const t0 = Date.now(); const a = ctl(ctx); samples.push(Date.now() - t0); return a;
};

const config: ArenaConfig = {
  seed,
  red:  { heroes: [{ id: "R-fighter", role: "fighter", template: FIGHTER_TEMPLATE }], scriptedAllies: [] },
  blue: { heroes: [{ id: "B-fighter", role: "fighter", template: FIGHTER_TEMPLATE }], scriptedAllies: [] },
};
const arena = await buildArena2(config);
let state = arena.state;
const red = wrap(makeSovereign(FIGHTER_WEIGHTS, PRESETS[preset]));
const blue = wrap(makeSovereign(FIGHTER_WEIGHTS, PRESETS[preset]));
const controllers: Record<TeamId, Map<EntityId, HeroController>> = {
  red: new Map([["R-fighter" as EntityId, red]]),
  blue: new Map([["B-fighter" as EntityId, blue]]),
};

const step = (a: PlayerAction): boolean => { const r = resolveAction(state, a); if (r.state === state) return false; state = r.state; return true; };

let turn = 0;
while (turn < MAX_TURNS && !state.winner) {
  const team = state.activeTeam;
  for (const [hid, ctl] of controllers[team]) {
    const h = state.entities.get(hid); if (!h || h.dead) continue;
    const actions = ctl({ state, heroId: hid, deadlineMs: Date.now() + 10000, turnIndex: turn });
    let i = 0; for (const a of actions ?? []) { if (i >= MAX_HERO_ACTIONS) break; if (a.type !== "ability" || a.entityId !== hid) continue; if (step(a)) i++; if (state.winner) break; }
    if (state.winner) break;
  }
  if (!state.winner) step({ type: "endTurn" });
  turn++;
}

samples.sort((a, b) => a - b);
const sum = samples.reduce((s, x) => s + x, 0);
const p = (q: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))];
console.log(`preset=${preset} seed=${seed} turns=${turn} winner=${state.winner ?? "—"} samples=${samples.length}`);
console.log(`per-turn ms  mean=${(sum / samples.length).toFixed(1)}  p50=${p(0.5)}  p90=${p(0.9)}  p99=${p(0.99)}  max=${samples[samples.length - 1]}`);
