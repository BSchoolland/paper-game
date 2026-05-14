#!/usr/bin/env bun
/**
 * Run ONE Skirmish (3v3) match between two agents, capture frames, write a replay JSON.
 *
 *   bun hero-arena/src/t2/replay-skirmish.ts <redAgent> <blueAgent> <seed> [outName=replay-skirmish]
 *   bun hero-arena/src/t2/replay-skirmish.ts agent-02 agent-04 42 replay-02-vs-04
 *
 *   Open:  http://localhost:5173/?mode=replay&log=/<outName>.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveAction, serializeGameState } from "../../../shared/src/index.js";
import type { EntityId, GameEvent, PlayerAction, TeamId, GameState } from "../../../shared/src/index.js";
import type { ReplayFrame } from "../match.js";
import type { ArenaConfig } from "./types.js";
import type { HeroController } from "../types.js";
import { buildArena2 } from "./arena2.js";
import { TANK_TEMPLATE, FIGHTER_TEMPLATE, RANGED_TEMPLATE } from "./loadouts.js";
import { AGENTS2 } from "./registry2.js";

const TURN_BUDGET_MS = Number(globalThis.process?.env?.HERO_TURN_BUDGET_MS ?? 2000);
const FORFEIT_FACTOR = 3;
const MAX_HERO_ACTIONS = 16;
const MAX_TURNS = 120;

const redAgentName = process.argv[2];
const blueAgentName = process.argv[3];
const seed = Number(process.argv[4] ?? 42);
const outName = process.argv[5] ?? "replay-skirmish";

if (!redAgentName || !blueAgentName || !AGENTS2[redAgentName] || !AGENTS2[blueAgentName]) {
  console.error(`usage: bun hero-arena/src/t2/replay-skirmish.ts <red> <blue> <seed> [outName]`);
  console.error(`  agents: ${Object.keys(AGENTS2).join(", ")}`);
  process.exit(2);
}

const redAgent = AGENTS2[redAgentName]!;
const blueAgent = AGENTS2[blueAgentName]!;

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

const controllers: Record<TeamId, Map<EntityId, HeroController>> = {
  red: new Map(),
  blue: new Map(),
};
controllers.red.set("R-tank" as EntityId, redAgent.squad.tank);
controllers.red.set("R-fighter" as EntityId, redAgent.squad.fighter);
controllers.red.set("R-ranged" as EntityId, redAgent.squad.ranged);
controllers.blue.set("B-tank" as EntityId, blueAgent.squad.tank);
controllers.blue.set("B-fighter" as EntityId, blueAgent.squad.fighter);
controllers.blue.set("B-ranged" as EntityId, blueAgent.squad.ranged);

const heroIds: Record<TeamId, EntityId[]> = {
  red: ["R-tank", "R-fighter", "R-ranged"] as EntityId[],
  blue: ["B-tank", "B-fighter", "B-ranged"] as EntityId[],
};

console.log(`# ${redAgentName} (red) vs ${blueAgentName} (blue) — seed ${seed}`);

const arena = await buildArena2(config);
let state = arena.state;
const frames: ReplayFrame[] = [{
  serializedState: serializeGameState(state), events: [], turnNumber: state.turnNumber, team: state.activeTeam,
}];

const record = (events: readonly GameEvent[]) => {
  frames.push({ serializedState: serializeGameState(state), events: [...events], turnNumber: state.turnNumber, team: state.activeTeam });
};
const step = (action: PlayerAction): boolean => {
  const res = resolveAction(state, action);
  if (res.state === state) return false;
  state = res.state;
  record(res.events);
  return true;
};

const turnIndex: Record<TeamId, number> = { red: 0, blue: 0 };

for (let t = 0; t < MAX_TURNS && !state.winner; t++) {
  const team = state.activeTeam;
  turnIndex[team]++;

  for (const heroId of heroIds[team]) {
    const hero = state.entities.get(heroId);
    if (!hero || hero.dead) continue;
    const controller = controllers[team].get(heroId);
    if (!controller) continue;

    const ctx = { state, heroId, deadlineMs: Date.now() + TURN_BUDGET_MS, turnIndex: turnIndex[team] };
    const t0 = Date.now();
    let actions: PlayerAction[] = [];
    try { actions = controller(ctx) ?? []; }
    catch (e) { console.error(`!! ${heroId} threw: ${(e as Error).message}`); }
    const dt = Date.now() - t0;
    if (dt > TURN_BUDGET_MS * FORFEIT_FACTOR) actions = [];

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
console.log(`\nResult: ${outcome === "red" ? `${redAgentName} (red) WINS` : outcome === "blue" ? `${blueAgentName} (blue) WINS` : "DRAW"}  ` +
            `(${state.turnNumber} turns, HP%: red ${(hpR*100).toFixed(0)} / blue ${(hpB*100).toFixed(0)})`);

const outPath = join(import.meta.dir, "..", "..", "..", "client", "public", `${outName}.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ seed, dimensions: [0], frames }));
console.log(`\nWrote ${frames.length}-frame replay → ${outPath}`);
console.log(`Watch:  http://localhost:5173/?mode=replay&log=/${outName}.json`);
