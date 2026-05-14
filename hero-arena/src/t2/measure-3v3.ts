#!/usr/bin/env bun
/**
 * Measure per-turn wall-clock time for a Sovereign preset in a 3v3 squad context.
 * Compares with the 1v1 numbers to see if the beam actually fills up with more enemies.
 *
 *   bun hero-arena/src/t2/measure-3v3.ts <preset> [seed]
 */
import { resolveAction } from "../../../shared/src/index.js";
import type { EntityId, PlayerAction, TeamId } from "../../../shared/src/index.js";
import { buildArena2 } from "./arena2.js";
import { TANK_TEMPLATE, FIGHTER_TEMPLATE, RANGED_TEMPLATE } from "./loadouts.js";
import type { ArenaConfig } from "./types.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../agents/agent-02/sovereign.js";
import type { IntelligencePreset } from "../../agents/agent-02/sovereign.js";
import type { HeroController } from "../types.js";

const MAX_HERO_ACTIONS = 16;
const MAX_TURNS = 120;

const preset = process.argv[2] as IntelligencePreset;
const seed = Number(process.argv[3] ?? 42);

if (!(preset in PRESETS)) {
  console.error(`usage: bun ... <preset> [seed]   presets: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(2);
}

const samples: number[] = [];
function wrap(ctl: HeroController): HeroController {
  return (ctx) => {
    const t0 = Date.now();
    const actions = ctl(ctx);
    samples.push(Date.now() - t0);
    return actions;
  };
}

const config: ArenaConfig = {
  seed,
  red: { heroes: [
    { id: "R-tank",    role: "tank",    template: TANK_TEMPLATE },
    { id: "R-fighter", role: "fighter", template: FIGHTER_TEMPLATE },
    { id: "R-ranged",  role: "ranged",  template: RANGED_TEMPLATE },
  ], scriptedAllies: [] },
  blue: { heroes: [
    { id: "B-tank",    role: "tank",    template: TANK_TEMPLATE },
    { id: "B-fighter", role: "fighter", template: FIGHTER_TEMPLATE },
    { id: "B-ranged",  role: "ranged",  template: RANGED_TEMPLATE },
  ], scriptedAllies: [] },
};

const arena = await buildArena2(config);
let state = arena.state;

const mk = () => wrap(makeSovereign(FIGHTER_WEIGHTS, PRESETS[preset]));
const controllers: Record<TeamId, Map<EntityId, HeroController>> = {
  red: new Map([
    ["R-tank" as EntityId, mk()],
    ["R-fighter" as EntityId, mk()],
    ["R-ranged" as EntityId, mk()],
  ]),
  blue: new Map([
    ["B-tank" as EntityId, mk()],
    ["B-fighter" as EntityId, mk()],
    ["B-ranged" as EntityId, mk()],
  ]),
};
const heroIds: Record<TeamId, EntityId[]> = {
  red: ["R-tank", "R-fighter", "R-ranged"] as EntityId[],
  blue: ["B-tank", "B-fighter", "B-ranged"] as EntityId[],
};

const budget = (PRESETS[preset].softBudgetMs ?? 2000) + 500;
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
  for (const heroId of heroIds[team]) {
    const hero = state.entities.get(heroId);
    if (!hero || hero.dead) continue;
    const ctx = { state, heroId, deadlineMs: Date.now() + budget, turnIndex: turnIndex[team] };
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

const s = stats(samples)!;
console.log(`# 3v3 ${preset}, seed ${seed}, ${state.turnNumber} game-turns, ${s.n} hero-turns measured`);
console.log(`# softBudget cap: ${PRESETS[preset].softBudgetMs}ms`);
console.log(`  avg=${s.avg.toFixed(0)}ms  median=${s.median}ms  p90=${s.p90}ms  max=${s.max}ms  min=${s.min}ms`);
