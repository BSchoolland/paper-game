#!/usr/bin/env bun
/**
 * Headless AI-vs-AI battle simulator.
 *
 *   bun scripts/sim-battle.ts [redDim] [blueDim] [seed] [maxTurns]
 *
 * Loads the enemy templates for two dimensions out of the server DB, fields a team from each, and
 * runs the fight to a conclusion using the real `AiController` + `resolveAction`. (Pass the same
 * dimension twice for a mirror match; pass `-1` for a dimension to use the generic player unit.)
 *
 * Prints a turn-by-turn log to stdout (positions, moves, attacks, and any invariant violations —
 * no-op actions or attacks that hit nothing, the tell-tales of "confused" planning) and writes a
 * replay log to `replays/replay.json` that the web dev hub's replay viewer can step through
 * (backtick opens the hub). The replay carries the dimension ids so the client knows which
 * sprite sheets to load.
 */
import {
  buildScenarioMap, makeEntity, createGameState, AiController, resolveAction,
  serializeGameState, UNIT_TEMPLATES, findWalkablePosition,
} from "../shared/src/index.js";
import type { Entity, GameEvent, PlayerAction, TeamId, UnitTemplate, Vec2 } from "../shared/src/index.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPLAYS_DIR } from "../shared/src/paths.js";

const redDim = Number(process.argv[2] ?? 1);
const blueDim = Number(process.argv[3] ?? 3);
const seed = Number(process.argv[4] ?? 42);
const maxTurns = Number(process.argv[5] ?? 60);
const perSide = 4;

// The server's db module opens `hex-discovery.sqlite` relative to cwd, so run from `server/`.
// (ESM imports hoist above statements, hence the dynamic import after chdir.)
process.chdir(join(import.meta.dir, "..", "server"));
const { loadEnemyTemplateRegistry } = await import("../server/src/db.js");
const { loadCollisionGrid } = await import("../server/src/collision-loader.js");

function rosterFor(dim: number): { key: string; template: UnitTemplate }[] {
  if (dim < 0) return Array.from({ length: perSide }, (_, i) => ({ key: `unit${i}`, template: UNIT_TEMPLATES.player }));
  const reg = loadEnemyTemplateRegistry(dim);
  const keys = Object.keys(reg).sort();
  if (keys.length === 0) {
    console.warn(`dimension ${dim} has no enemy templates — using the generic player unit`);
    return Array.from({ length: perSide }, (_, i) => ({ key: `unit${i}`, template: UNIT_TEMPLATES.player }));
  }
  return Array.from({ length: perSide }, (_, i) => {
    const key = keys[i % keys.length]!;
    return { key, template: reg[key]! };
  });
}

// --- arena -----------------------------------------------------------------
const { grid, mapDefinition } = buildScenarioMap(seed);
const worldW = grid.width * grid.cellSize;
const worldH = grid.height * grid.cellSize;

// Rasterize the map objects (walls, rocks, trees) into the collision grid exactly like the
// server does, so the obstacles the client renders are the obstacles the AI has to deal with.
await loadCollisionGrid(grid, mapDefinition.objects);

// --- combatants ------------------------------------------------------------
const entities = new Map<string, Entity>();
function fielded(side: TeamId, dim: number, xFrac: number) {
  const roster = rosterFor(dim);
  roster.forEach(({ key, template }, i) => {
    const id = `${side === "red" ? "R" : "B"}-${key}-${i}`;
    const yFrac = (i + 1) / (roster.length + 1);
    const pos = findWalkablePosition(grid, { x: worldW * xFrac, y: worldH * yFrac }, template.collisionRadius);
    entities.set(id, makeEntity(id, key, pos.x, pos.y, side, template));
  });
}
fielded("red", redDim, 0.12);
fielded("blue", blueDim, 0.88);

let state = createGameState({ entities, grid, mapDefinition });

// --- run -------------------------------------------------------------------
const ai = new AiController();
const dimensions = [...new Set([redDim, blueDim].filter((d) => d >= 0))];
const frames: { serializedState: object; events: GameEvent[]; turnNumber: number; team: TeamId }[] = [
  { serializedState: serializeGameState(state), events: [], turnNumber: state.turnNumber, team: state.activeTeam },
];
const log: string[] = [`# AI battle  red=dim${redDim}  blue=dim${blueDim}  seed=${seed}`];
let warnings = 0;

const pt = (v: Vec2) => `(${v.x.toFixed(0)},${v.y.toFixed(0)})`;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function describeAction(action: PlayerAction): string {
  if (action.type === "endTurn") return "endTurn";
  return `${action.entityId}.${action.abilityId}${action.destination ? `→${pt(action.destination)}` : ""}`;
}
function describeEvents(events: readonly GameEvent[]): string {
  return events.map(ev => {
    switch (ev.type) {
      case "move": return `move ${ev.entityId} ${pt(ev.from)}→${pt(ev.to)} (${dist(ev.from, ev.to).toFixed(0)}px)`;
      case "attack": return `attack ${ev.attackerId} → ${ev.hits.length ? ev.hits.map(h => `${h.targetId}${h.killed ? "†" : ""}(-${h.damage})`).join(",") : "MISS"}`;
      case "knockback": return `knockback ${ev.entityId} ${pt(ev.from)}→${pt(ev.to)}`;
      case "pull": return `pull ${ev.entityId} ${pt(ev.from)}→${pt(ev.to)}`;
      case "barrier": return `barrier ${ev.entityId} +${ev.barrierHp}`;
      case "statusApplied": return `status ${ev.entityId} +${ev.status.type}(${ev.status.value})`;
      case "spawn": return `spawn ${ev.entityId} ${pt(ev.position)}`;
      case "turnStart": return `turnStart ${ev.team}`;
      case "endTurn": return `endTurn → ${ev.nextTeam}`;
    }
  }).join("; ");
}

for (let turn = 0; turn < maxTurns && !state.winner; turn++) {
  const team = state.activeTeam;
  log.push("", `## turn ${state.turnNumber}  ${team}`);
  for (const e of state.entities.values()) {
    if (e.dead) continue;
    const tag = e.teamId === team ? "*" : " ";
    const status = e.statusEffects?.length ? `  [${e.statusEffects.map(s => `${s.type}:${s.value}`).join(",")}]` : "";
    log.push(`  ${tag} ${e.id.padEnd(22)} ${pt(e.position)}  hp ${e.hp}/${e.maxHp}  energy ${e.energy.red}r/${e.energy.blue}b${status}`);
  }

  const actingIds = new Set([...state.entities.values()].filter(e => e.teamId === team && !e.dead).map(e => e.id));
  const actions = ai.computeActions(state, team);

  for (const action of actions) {
    const result = resolveAction(state, action);
    if (result.state === state) {
      log.push(`    !! NO-OP  ${describeAction(action)}  — controller emitted a dead action`);
      warnings++;
      continue;
    }
    for (const ev of result.events) {
      if (ev.type === "attack" && actingIds.has(ev.attackerId) && ev.hits.length === 0) {
        log.push(`    !! ${ev.attackerId} attacked but hit NOTHING — confused planning?`);
        warnings++;
      }
    }
    state = result.state;
    frames.push({ serializedState: serializeGameState(state), events: [...result.events], turnNumber: state.turnNumber, team: state.activeTeam });
    log.push(`    ${describeEvents(result.events)}`);
    if (state.winner) break;
  }
}

log.push("", state.winner ? `Winner: ${state.winner} (${state.winner === "red" ? `dim${redDim}` : `dim${blueDim}`})` : `Stalemate after ${maxTurns} turns`, `Warnings: ${warnings}`, `Replay frames: ${frames.length}`);

const replayPath = join(REPLAYS_DIR, "replay.json");
mkdirSync(dirname(replayPath), { recursive: true });
writeFileSync(replayPath, JSON.stringify({ seed, dimensions, redDim, blueDim, frames }));

console.log(log.join("\n"));
console.log(`\nWrote ${frames.length}-frame replay (dimensions ${dimensions.join(", ")}) → ${replayPath}`);
console.log(`View it:  bun dev → backtick (dev hub) → replay.json`);
if (warnings > 0) {
  console.error(`\n${warnings} invariant warning(s) — see "!!" lines above.`);
  process.exit(1);
}
