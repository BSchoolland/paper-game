#!/usr/bin/env bun
/**
 * Pit two Sovereign presets against each other on a 1v1 Fighter duel and report wins.
 *
 *   bun hero-arena/src/t2/test-presets.ts <redPreset> <bluePreset> [seeds...]
 *   bun hero-arena/src/t2/test-presets.ts engine genius 1 7 42
 */
import { resolveAction } from "../../../shared/src/index.js";
import type { EntityId, PlayerAction, TeamId, GameState } from "../../../shared/src/index.js";
import { buildArena2 } from "./arena2.js";
import { FIGHTER_TEMPLATE } from "./loadouts.js";
import type { ArenaConfig } from "./types.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../agents/agent-02/sovereign.js";
import type { IntelligencePreset } from "../../agents/agent-02/sovereign.js";
import type { HeroController } from "../types.js";

const MAX_HERO_ACTIONS = 16;
const MAX_TURNS = 120;

const redPreset = process.argv[2] as IntelligencePreset;
const bluePreset = process.argv[3] as IntelligencePreset;
const seeds = process.argv.slice(4).map(Number);
if (seeds.length === 0) seeds.push(1, 7, 42);

if (!(redPreset in PRESETS) || !(bluePreset in PRESETS)) {
  console.error(`usage: bun ... <red> <blue> [seeds...]`);
  console.error(`  presets: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(2);
}

interface Tally { w: number; l: number; d: number; hpMarginSum: number; turnsSum: number; }

async function runMatch(seed: number, swap: boolean): Promise<{ outcome: "red" | "blue" | "draw"; turns: number; hpR: number; hpB: number }> {
  const config: ArenaConfig = {
    seed,
    red:  { heroes: [{ id: "R-fighter", role: "fighter", template: FIGHTER_TEMPLATE }], scriptedAllies: [] },
    blue: { heroes: [{ id: "B-fighter", role: "fighter", template: FIGHTER_TEMPLATE }], scriptedAllies: [] },
  };

  const arena = await buildArena2(config);
  let state = arena.state;

  const redBrain: HeroController = makeSovereign(FIGHTER_WEIGHTS, PRESETS[swap ? bluePreset : redPreset]);
  const blueBrain: HeroController = makeSovereign(FIGHTER_WEIGHTS, PRESETS[swap ? redPreset : bluePreset]);
  const controllers: Record<TeamId, Map<EntityId, HeroController>> = {
    red: new Map([["R-fighter" as EntityId, redBrain]]),
    blue: new Map([["B-fighter" as EntityId, blueBrain]]),
  };
  const heroIds: Record<TeamId, EntityId[]> = { red: ["R-fighter" as EntityId], blue: ["B-fighter" as EntityId] };

  const presetBudget = (k: IntelligencePreset) => PRESETS[k].softBudgetMs ?? 2000;
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
    const presetName = team === "red" ? (swap ? bluePreset : redPreset) : (swap ? redPreset : bluePreset);
    const budget = presetBudget(presetName as IntelligencePreset) + 500;
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

  const hpFrac = (s: GameState, team: TeamId) => {
    let hp = 0, max = 0;
    for (const e of s.entities.values()) if (e.teamId === team) { max += e.maxHp; hp += e.dead ? 0 : e.hp + e.barrier; }
    return max > 0 ? hp / max : 0;
  };
  const hpR = hpFrac(state, "red"), hpB = hpFrac(state, "blue");
  const outcome: "red" | "blue" | "draw" = state.winner ?? (Math.abs(hpR - hpB) < 1e-6 ? "draw" : (hpR > hpB ? "red" : "blue"));
  return { outcome, turns: state.turnNumber, hpR, hpB };
}

const tally: Record<string, Tally> = {
  [redPreset]: { w: 0, l: 0, d: 0, hpMarginSum: 0, turnsSum: 0 },
  [bluePreset]: { w: 0, l: 0, d: 0, hpMarginSum: 0, turnsSum: 0 },
};

console.log(`# ${redPreset} vs ${bluePreset}, seeds ${seeds.join(",")}, both sides`);

for (const seed of seeds) {
  for (const swap of [false, true]) {
    const redName = swap ? bluePreset : redPreset;
    const blueName = swap ? redPreset : bluePreset;
    process.stderr.write(`  seed ${seed} ${redName}(R) vs ${blueName}(B) ...`);
    const t0 = Date.now();
    const res = await runMatch(seed, swap);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    process.stderr.write(` ${res.outcome} (${res.turns} turns, ${dt}s)\n`);

    const winner = res.outcome === "red" ? redName : res.outcome === "blue" ? blueName : null;
    const loser = res.outcome === "red" ? blueName : res.outcome === "blue" ? redName : null;
    if (winner && loser) { tally[winner]!.w++; tally[loser]!.l++; }
    else { tally[redName]!.d++; tally[blueName]!.d++; }
    tally[redName]!.hpMarginSum += res.hpR - res.hpB;
    tally[blueName]!.hpMarginSum += res.hpB - res.hpR;
    tally[redName]!.turnsSum += res.turns;
    tally[blueName]!.turnsSum += res.turns;
  }
}

const matches = seeds.length * 2;
console.log(`\nResult (over ${matches} matches):`);
for (const name of [redPreset, bluePreset]) {
  const t = tally[name]!;
  console.log(`  ${name.padEnd(8)} ${t.w}W-${t.l}L-${t.d}D   avg HP margin: ${(100 * t.hpMarginSum / matches).toFixed(1)}%`);
}
