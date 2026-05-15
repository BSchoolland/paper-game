#!/usr/bin/env bun
/**
 * 3v3 squad head-to-head: each side fields tank/fighter/ranged, all running one preset.
 *
 *   bun hero-arena/src/t2/test-presets-3v3.ts <redPreset> <bluePreset> [seeds...]
 */
import { resolveAction } from "../../../shared/src/index.js";
import type { EntityId, PlayerAction, TeamId, GameState } from "../../../shared/src/index.js";
import { buildArena2 } from "./arena2.js";
import { TANK_TEMPLATE, FIGHTER_TEMPLATE, RANGED_TEMPLATE } from "./loadouts.js";
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
  console.error(`usage: bun ... <red> <blue> [seeds...]   presets: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(2);
}

const mk = (p: IntelligencePreset) => makeSovereign(FIGHTER_WEIGHTS, PRESETS[p]);

async function runMatch(seed: number, swap: boolean) {
  const rp = swap ? bluePreset : redPreset;
  const bp = swap ? redPreset : bluePreset;
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
  const controllers: Record<TeamId, Map<EntityId, HeroController>> = {
    red: new Map([
      ["R-tank" as EntityId, mk(rp)],
      ["R-fighter" as EntityId, mk(rp)],
      ["R-ranged" as EntityId, mk(rp)],
    ]),
    blue: new Map([
      ["B-tank" as EntityId, mk(bp)],
      ["B-fighter" as EntityId, mk(bp)],
      ["B-ranged" as EntityId, mk(bp)],
    ]),
  };
  const heroIds: Record<TeamId, EntityId[]> = {
    red: ["R-tank", "R-fighter", "R-ranged"] as EntityId[],
    blue: ["B-tank", "B-fighter", "B-ranged"] as EntityId[],
  };

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
    const presetName = team === "red" ? rp : bp;
    for (const heroId of heroIds[team]) {
      const hero = state.entities.get(heroId);
      if (!hero || hero.dead) continue;
      const ctx = { state, heroId, deadlineMs: Date.now() + budget(presetName), turnIndex: turnIndex[team] };
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

const tally: Record<string, { w: number; l: number; d: number; hpMarginSum: number }> = {
  [redPreset]: { w: 0, l: 0, d: 0, hpMarginSum: 0 },
  [bluePreset]: { w: 0, l: 0, d: 0, hpMarginSum: 0 },
};

console.log(`# 3v3 ${redPreset} vs ${bluePreset}, seeds ${seeds.join(",")}, both sides`);
for (const seed of seeds) {
  for (const swap of [false, true]) {
    const rN = swap ? bluePreset : redPreset;
    const bN = swap ? redPreset : bluePreset;
    process.stderr.write(`  seed ${seed} ${rN}(R) vs ${bN}(B) ...`);
    const t0 = Date.now();
    const res = await runMatch(seed, swap);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    process.stderr.write(` ${res.outcome} (${res.turns} turns, ${dt}s)\n`);
    const winner = res.outcome === "red" ? rN : res.outcome === "blue" ? bN : null;
    const loser = res.outcome === "red" ? bN : res.outcome === "blue" ? rN : null;
    if (winner && loser) { tally[winner]!.w++; tally[loser]!.l++; }
    else { tally[rN]!.d++; tally[bN]!.d++; }
    tally[rN]!.hpMarginSum += res.hpR - res.hpB;
    tally[bN]!.hpMarginSum += res.hpB - res.hpR;
  }
}

const matches = seeds.length * 2;
console.log(`\nResult (over ${matches} matches):`);
for (const name of [redPreset, bluePreset]) {
  const t = tally[name]!;
  console.log(`  ${name.padEnd(8)} ${t.w}W-${t.l}L-${t.d}D   avg HP margin: ${(100 * t.hpMarginSum / matches).toFixed(1)}%`);
}
