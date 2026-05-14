#!/usr/bin/env bun
/**
 * Run ONE Boss-raid match (1 boss + 5 scripted minions vs 3 raid heroes), capture frames,
 * write a replay JSON for the in-browser viewer.
 *
 *   bun hero-arena/src/t2/replay-boss.ts <bossAgent> <raidAgent> <seed> [outName=replay-boss]
 *   bun hero-arena/src/t2/replay-boss.ts agent-02 agent-04 42 replay-04-vs-boss
 *
 *   Open:  http://localhost:5173/?mode=replay&log=/<outName>.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveAction, serializeGameState } from "../../../shared/src/index.js";
import type { EntityId, GameEvent, PlayerAction, TeamId, GameState } from "../../../shared/src/index.js";
import { strategyForEntity } from "../../../shared/src/ai/strategy.js";
import type { HeroController } from "../types.js";
import type { ReplayFrame } from "../match.js";
import type { ArenaConfig } from "./types.js";
import { buildArena2 } from "./arena2.js";
import { BOSS_TEMPLATE, TANK_TEMPLATE, FIGHTER_TEMPLATE, RANGED_TEMPLATE } from "./loadouts.js";
import { AGENTS2 } from "./registry2.js";

const TURN_BUDGET_MS = Number(globalThis.process?.env?.HERO_TURN_BUDGET_MS ?? 2000);
const FORFEIT_FACTOR = 3;
const MAX_HERO_ACTIONS = 16;
const MAX_TURNS = 140;

const BOSS_MINIONS = [
  { key: "goblin-spear",  count: 1, dim: 0 as const },
  { key: "goblin-archer", count: 1, dim: 0 as const },
  { key: "goblin-shield", count: 1, dim: 0 as const },
  { key: "slime",         count: 1, dim: 0 as const },
  { key: "big-slime",     count: 1, dim: 0 as const },
];

const bossAgentName = process.argv[2];
const raidAgentName = process.argv[3];
const seed = Number(process.argv[4] ?? 42);
const outName = process.argv[5] ?? "replay-boss";

if (!bossAgentName || !raidAgentName || !AGENTS2[bossAgentName] || !AGENTS2[raidAgentName]) {
  console.error(`usage: bun hero-arena/src/t2/replay-boss.ts <bossAgent> <raidAgent> <seed> [outName]`);
  console.error(`  agents: ${Object.keys(AGENTS2).join(", ")}`);
  process.exit(2);
}

const bossAgent = AGENTS2[bossAgentName]!;
const raidAgent = AGENTS2[raidAgentName]!;

const config: ArenaConfig = {
  seed,
  red:  { heroes: [{ id: "R-boss", role: "boss", template: BOSS_TEMPLATE }], scriptedAllies: BOSS_MINIONS },
  blue: { heroes: [
    { id: "B-tank",    role: "tank",    template: TANK_TEMPLATE },
    { id: "B-fighter", role: "fighter", template: FIGHTER_TEMPLATE },
    { id: "B-ranged",  role: "ranged",  template: RANGED_TEMPLATE },
  ], scriptedAllies: [] },
};

const controllers: Record<TeamId, Map<EntityId, HeroController>> = { red: new Map(), blue: new Map() };
const bossCtlKey = (process.env.BOSS_CTL ?? "boss") as "boss" | "fighter" | "tank" | "ranged";
const bossPilot =
  bossCtlKey === "fighter" ? bossAgent.squad.fighter :
  bossCtlKey === "tank" ? bossAgent.squad.tank :
  bossCtlKey === "ranged" ? bossAgent.squad.ranged :
  bossAgent.boss;
controllers.red.set("R-boss" as EntityId, bossPilot);
if (bossCtlKey !== "boss") console.log(`# boss piloted by ${bossAgentName}.squad.${bossCtlKey}`);
controllers.blue.set("B-tank" as EntityId, raidAgent.raid.tank);
controllers.blue.set("B-fighter" as EntityId, raidAgent.raid.fighter);
controllers.blue.set("B-ranged" as EntityId, raidAgent.raid.ranged);

const heroIds: Record<TeamId, EntityId[]> = {
  red: ["R-boss"] as EntityId[],
  blue: ["B-tank", "B-fighter", "B-ranged"] as EntityId[],
};

console.log(`# ${bossAgentName}(boss) vs ${raidAgentName}(raid) — seed ${seed}`);

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

  // Heroes
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

  // Scripted allies (minions on red side)
  if (!state.winner) {
    const allies = [...state.entities.values()]
      .filter(e => e.teamId === team && !e.dead && !heroIds[team].includes(e.id))
      .sort((a, b) => closestEnemyDist(a) - closestEnemyDist(b));
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

function hpFraction(s: GameState, team: TeamId): number {
  let hp = 0, max = 0;
  for (const e of s.entities.values()) if (e.teamId === team) { max += e.maxHp; hp += e.dead ? 0 : e.hp + e.barrier; }
  return max > 0 ? hp / max : 0;
}

function closestEnemyDist(e: { teamId: TeamId; position: { x: number; y: number } }): number {
  let best = Infinity;
  for (const o of state.entities.values()) if (!o.dead && o.teamId !== e.teamId) {
    best = Math.min(best, Math.hypot(e.position.x - o.position.x, e.position.y - o.position.y));
  }
  return best;
}

const hpR = hpFraction(state, "red"), hpB = hpFraction(state, "blue");
const outcome = state.winner ?? (Math.abs(hpR - hpB) < 1e-6 ? "draw" : (hpR > hpB ? "red" : "blue"));
const boss = state.entities.get("R-boss" as EntityId);
const bossAlive = boss && !boss.dead;
const raidAlive = heroIds.blue.filter(id => { const e = state.entities.get(id); return e && !e.dead; }).length;

console.log(`\nResult: ${outcome === "red" ? `BOSS (${bossAgentName}) WINS` : outcome === "blue" ? `RAID (${raidAgentName}) WINS` : "DRAW"}`);
console.log(`  turns ${state.turnNumber}  HP%: red ${(hpR*100).toFixed(0)} / blue ${(hpB*100).toFixed(0)}`);
console.log(`  boss ${bossAlive ? `alive (${boss!.hp}/${boss!.maxHp} hp)` : "DEAD"}  |  raid heroes alive: ${raidAlive}/3`);

const outPath = join(import.meta.dir, "..", "..", "..", "client", "public", `${outName}.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ seed, dimensions: [0], frames }));
console.log(`\nWrote ${frames.length}-frame replay → ${outPath}`);
console.log(`Watch:  http://localhost:5173/?mode=replay&log=/${outName}.json`);
