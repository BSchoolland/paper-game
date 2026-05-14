#!/usr/bin/env bun
/**
 * Measure per-turn time for a single hero (red) facing a swarm: 1 hero + N minions (blue).
 *
 *   bun hero-arena/src/t2/measure-swarm.ts <preset> [minionCount=10] [seed]
 */
import { resolveAction } from "../../../shared/src/index.js";
import { strategyForEntity } from "../../../shared/src/ai/strategy.js";
import type { EntityId, PlayerAction, TeamId } from "../../../shared/src/index.js";
import { buildArena2 } from "./arena2.js";
import { FIGHTER_TEMPLATE } from "./loadouts.js";
import type { ArenaConfig } from "./types.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../agents/agent-02/sovereign.js";
import type { IntelligencePreset } from "../../agents/agent-02/sovereign.js";
import type { HeroController } from "../types.js";

const MAX_HERO_ACTIONS = 16;
const MAX_TURNS = 120;

const preset = process.argv[2] as IntelligencePreset;
const minionCount = Number(process.argv[3] ?? 10);
const seed = Number(process.argv[4] ?? 42);

if (!(preset in PRESETS)) {
  console.error(`usage: bun ... <preset> [minionCount=10] [seed]`);
  console.error(`  presets: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(2);
}

const redSamples: number[] = [];
const blueSamples: number[] = [];
function wrap(samples: number[], ctl: HeroController): HeroController {
  return (ctx) => {
    const t0 = Date.now();
    const actions = ctl(ctx);
    samples.push(Date.now() - t0);
    return actions;
  };
}

// Spread 10 minions across goblins + slimes for variety
const minions = Array.from({ length: minionCount }, (_, i) => ({
  key: (["goblin-spear", "goblin-archer", "goblin-shield", "slime"] as const)[i % 4]!,
  count: 1,
  dim: 0 as const,
}));

const config: ArenaConfig = {
  seed,
  red:  { heroes: [{ id: "R-hero", role: "fighter", template: FIGHTER_TEMPLATE }], scriptedAllies: [] },
  blue: { heroes: [{ id: "B-hero", role: "fighter", template: FIGHTER_TEMPLATE }], scriptedAllies: minions },
};

const arena = await buildArena2(config);
let state = arena.state;
const controllers: Record<TeamId, Map<EntityId, HeroController>> = {
  red: new Map([["R-hero" as EntityId, wrap(redSamples, makeSovereign(FIGHTER_WEIGHTS, PRESETS[preset]))]]),
  blue: new Map([["B-hero" as EntityId, wrap(blueSamples, makeSovereign(FIGHTER_WEIGHTS, PRESETS[preset]))]]),
};
const heroIds: Record<TeamId, EntityId[]> = {
  red: ["R-hero" as EntityId],
  blue: ["B-hero" as EntityId],
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
  // Scripted minions (blue only)
  if (!state.winner) {
    const allies = [...state.entities.values()]
      .filter(e => e.teamId === team && !e.dead && !heroIds[team].includes(e.id));
    for (const u of allies) {
      if (state.entities.get(u.id)?.dead) continue;
      for (const action of strategyForEntity(u).planActions(u, state)) {
        step(action);
        if (state.winner) break;
      }
      if (state.winner) break;
    }
  }
  if (!state.winner) step({ type: "endTurn" });
}

function stats(arr: number[]) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = arr.reduce((s, x) => s + x, 0);
  return {
    n: arr.length, avg: sum / arr.length,
    median: sorted[Math.floor(sorted.length / 2)]!,
    p90: sorted[Math.floor(sorted.length * 0.9)]!,
    max: sorted[sorted.length - 1]!,
  };
}

console.log(`# ${preset}: red(1 hero) vs blue(1 hero + ${minionCount} minions), seed ${seed}, ${state.turnNumber} game-turns`);
console.log(`# softBudget cap: ${PRESETS[preset].softBudgetMs}ms`);
const r = stats(redSamples);
const b = stats(blueSamples);
if (r) console.log(`  red  (faces ${minionCount + 1} enemies)  n=${r.n}  avg=${r.avg.toFixed(0)}ms  median=${r.median}ms  p90=${r.p90}ms  max=${r.max}ms`);
if (b) console.log(`  blue (faces 1 enemy)                 n=${b.n}  avg=${b.avg.toFixed(0)}ms  median=${b.median}ms  p90=${b.p90}ms  max=${b.max}ms`);
