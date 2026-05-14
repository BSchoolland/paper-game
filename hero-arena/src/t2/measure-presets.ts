#!/usr/bin/env bun
/**
 * Wrap each preset's controller and record actual wall-clock time per turn over a real match.
 * Reports avg / median / max ms-per-turn instead of just aggregate match time.
 *
 *   bun hero-arena/src/t2/measure-presets.ts <preset1> <preset2> [seed]
 */
import { resolveAction } from "../../../shared/src/index.js";
import type { EntityId, PlayerAction, TeamId } from "../../../shared/src/index.js";
import { buildArena2 } from "./arena2.js";
import { FIGHTER_TEMPLATE } from "./loadouts.js";
import type { ArenaConfig } from "./types.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../agents/agent-02/sovereign.js";
import type { IntelligencePreset } from "../../agents/agent-02/sovereign.js";
import type { HeroController } from "../types.js";

const MAX_HERO_ACTIONS = 16;
const MAX_TURNS = 120;

const preset1 = process.argv[2] as IntelligencePreset;
const preset2 = process.argv[3] as IntelligencePreset;
const seed = Number(process.argv[4] ?? 42);

if (!(preset1 in PRESETS) || !(preset2 in PRESETS)) {
  console.error(`usage: bun ... <preset1> <preset2> [seed]`);
  console.error(`  presets: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(2);
}

function wrap(name: string, ctl: HeroController, samples: number[]): HeroController {
  return (ctx) => {
    const t0 = Date.now();
    const actions = ctl(ctx);
    samples.push(Date.now() - t0);
    return actions;
  };
}

const samples: Record<string, number[]> = { [preset1]: [], [preset2]: [] };
const config: ArenaConfig = {
  seed,
  red:  { heroes: [{ id: "R-fighter", role: "fighter", template: FIGHTER_TEMPLATE }], scriptedAllies: [] },
  blue: { heroes: [{ id: "B-fighter", role: "fighter", template: FIGHTER_TEMPLATE }], scriptedAllies: [] },
};

const arena = await buildArena2(config);
let state = arena.state;
const redBrain = wrap(preset1, makeSovereign(FIGHTER_WEIGHTS, PRESETS[preset1]), samples[preset1]!);
const blueBrain = wrap(preset2, makeSovereign(FIGHTER_WEIGHTS, PRESETS[preset2]), samples[preset2]!);
const controllers: Record<TeamId, Map<EntityId, HeroController>> = {
  red: new Map([["R-fighter" as EntityId, redBrain]]),
  blue: new Map([["B-fighter" as EntityId, blueBrain]]),
};
const heroIds: Record<TeamId, EntityId[]> = { red: ["R-fighter" as EntityId], blue: ["B-fighter" as EntityId] };

const budget = (k: IntelligencePreset) => (PRESETS[k].softBudgetMs ?? 2000) + 500;
const turnIndex: Record<TeamId, number> = { red: 0, blue: 0 };

const step = (action: PlayerAction): boolean => {
  const r = resolveAction(state, action);
  if (r.state === state) return false;
  state = r.state;
  return true;
};

for (let t = 0; t < MAX_TURNS && !state.winner; t++) {
  const team = state.activeTeam;
  turnIndex[team]++;
  const presetName = team === "red" ? preset1 : preset2;
  for (const heroId of heroIds[team]) {
    const hero = state.entities.get(heroId);
    if (!hero || hero.dead) continue;
    const ctx = { state, heroId, deadlineMs: Date.now() + budget(presetName as IntelligencePreset), turnIndex: turnIndex[team] };
    let actions: PlayerAction[] = [];
    try { actions = controllers[team].get(heroId)!(ctx) ?? []; }
    catch (e) { console.error(`!! threw: ${(e as Error).message}`); }
    let applied = 0;
    for (const a of actions) {
      if (applied >= MAX_HERO_ACTIONS) break;
      if (a.type !== "ability" || a.entityId !== heroId) continue;
      if (step(a)) applied++;
      if (state.winner) break;
    }
    if (state.winner) break;
  }
  if (!state.winner) step({ type: "endTurn" });
}

function stats(arr: number[]) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = arr.reduce((s, x) => s + x, 0);
  return {
    n: arr.length,
    avg: sum / arr.length,
    median: sorted[Math.floor(sorted.length / 2)]!,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    p90: sorted[Math.floor(sorted.length * 0.9)]!,
  };
}

console.log(`# ${preset1} (red) vs ${preset2} (blue), seed ${seed}, ${state.turnNumber} game-turns`);
console.log(`# softBudget caps: ${preset1}=${PRESETS[preset1].softBudgetMs}ms  ${preset2}=${PRESETS[preset2].softBudgetMs}ms\n`);
for (const name of [preset1, preset2]) {
  const s = stats(samples[name]!);
  if (!s) continue;
  console.log(`  ${name.padEnd(8)}  n=${s.n}  avg=${s.avg.toFixed(0)}ms  median=${s.median}ms  p90=${s.p90}ms  max=${s.max}ms`);
}
