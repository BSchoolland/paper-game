#!/usr/bin/env bun
/**
 * Record a 3v3 squad replay where each side uses a named Sovereign preset.
 *
 *   bun hero-arena/src/t2/replay-presets-3v3.ts <redPreset> <bluePreset> <seed> [outName]
 *   bun hero-arena/src/t2/replay-presets-3v3.ts smart seer 42 replay-smart-vs-seer
 *
 *   Open:  http://localhost:5173/?mode=replay&log=/<outName>.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveAction, serializeGameState } from "../../../shared/src/index.js";
import type { EntityId, GameEvent, PlayerAction, TeamId, GameState } from "../../../shared/src/index.js";
import { LEGACY_PUBLIC_DIR } from "../../../shared/src/paths.js";
import type { HeroController } from "../types.js";
import type { ReplayFrame } from "../match.js";
import type { ArenaConfig } from "./types.js";
import { buildArena2 } from "./arena2.js";
import { TANK_TEMPLATE, FIGHTER_TEMPLATE, RANGED_TEMPLATE } from "./loadouts.js";
import { makeSovereign, FIGHTER_WEIGHTS, PRESETS } from "../../agents/agent-02/sovereign.js";
import type { IntelligencePreset } from "../../agents/agent-02/sovereign.js";

const TURN_BUDGET_MS = 10000;
const MAX_HERO_ACTIONS = 16;
const MAX_TURNS = 120;

const redPreset = process.argv[2] as IntelligencePreset;
const bluePreset = process.argv[3] as IntelligencePreset;
const seed = Number(process.argv[4] ?? 42);
const outName = process.argv[5] ?? `replay-${redPreset}-vs-${bluePreset}`;

if (!(redPreset in PRESETS) || !(bluePreset in PRESETS)) {
  console.error(`usage: bun ... <redPreset> <bluePreset> <seed> [outName]`);
  console.error(`  presets: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(2);
}

const config: ArenaConfig = {
  seed,
  red:  { heroes: [
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

const mk = (p: IntelligencePreset): HeroController => makeSovereign(FIGHTER_WEIGHTS, PRESETS[p]);
const controllers: Record<TeamId, Map<EntityId, HeroController>> = {
  red: new Map([
    ["R-tank" as EntityId, mk(redPreset)],
    ["R-fighter" as EntityId, mk(redPreset)],
    ["R-ranged" as EntityId, mk(redPreset)],
  ]),
  blue: new Map([
    ["B-tank" as EntityId, mk(bluePreset)],
    ["B-fighter" as EntityId, mk(bluePreset)],
    ["B-ranged" as EntityId, mk(bluePreset)],
  ]),
};
const heroIds: Record<TeamId, EntityId[]> = {
  red: ["R-tank", "R-fighter", "R-ranged"] as EntityId[],
  blue: ["B-tank", "B-fighter", "B-ranged"] as EntityId[],
};

console.log(`# ${redPreset} (red) vs ${bluePreset} (blue) — seed ${seed}`);

const arena = await buildArena2(config);
let state = arena.state;
const frames: ReplayFrame[] = [{
  serializedState: serializeGameState(state), events: [], turnNumber: state.turnNumber, team: state.activeTeam,
}];

const record = (events: readonly GameEvent[]) => {
  frames.push({ serializedState: serializeGameState(state), events: [...events], turnNumber: state.turnNumber, team: state.activeTeam });
};
const step = (action: PlayerAction): boolean => {
  const r = resolveAction(state, action);
  if (r.state === state) return false;
  state = r.state;
  record(r.events);
  return true;
};

const turnIndex: Record<TeamId, number> = { red: 0, blue: 0 };

for (let t = 0; t < MAX_TURNS && !state.winner; t++) {
  const team = state.activeTeam;
  turnIndex[team]++;
  for (const heroId of heroIds[team]) {
    const hero = state.entities.get(heroId);
    if (!hero || hero.dead) continue;
    const ctx = { state, heroId, deadlineMs: Date.now() + TURN_BUDGET_MS, turnIndex: turnIndex[team] };
    let actions: PlayerAction[] = [];
    try { actions = controllers[team].get(heroId)!(ctx) ?? []; }
    catch (e) { console.error(`!! ${heroId} threw: ${(e as Error).message}`); }

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

function hpFraction(s: GameState, team: TeamId): number {
  let hp = 0, max = 0;
  for (const e of s.entities.values()) if (e.teamId === team) { max += e.maxHp; hp += e.dead ? 0 : e.hp + e.barrier; }
  return max > 0 ? hp / max : 0;
}

const hpR = hpFraction(state, "red"), hpB = hpFraction(state, "blue");
const outcome = state.winner ?? (Math.abs(hpR - hpB) < 1e-6 ? "draw" : (hpR > hpB ? "red" : "blue"));
console.log(`\nResult: ${outcome === "red" ? `${redPreset} (red) WINS` : outcome === "blue" ? `${bluePreset} (blue) WINS` : "DRAW"}  ` +
            `(${state.turnNumber} turns, HP%: red ${(hpR*100).toFixed(0)} / blue ${(hpB*100).toFixed(0)})`);

const outPath = join(LEGACY_PUBLIC_DIR, `${outName}.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ seed, dimensions: [0], frames }));
console.log(`\nWrote ${frames.length}-frame replay → ${outPath}`);
console.log(`Watch:  http://localhost:5173/?mode=replay&log=/${outName}.json`);
