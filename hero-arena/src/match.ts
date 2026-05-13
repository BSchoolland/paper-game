import {
  resolveAction, serializeGameState,
} from "../../shared/src/index.js";
import type { EntityId, GameEvent, GameState, PlayerAction, TeamId } from "../../shared/src/index.js";
import { strategyForEntity } from "../../shared/src/ai/strategy.js";
import { buildArena } from "./arena.js";
import type { HeroContext, HeroController } from "./types.js";

/** Wall-clock ms a hero brain gets per turn. The harness measures and reports; enforcement is soft
 *  (see {@link HeroContext.deadlineMs}) — overruns are logged, egregious overruns forfeit the turn. */
export const TURN_BUDGET_MS = Number(globalThis.process?.env?.HERO_TURN_BUDGET_MS ?? 5000);
const FORFEIT_FACTOR = 3;   // a turn taking > 3× the budget is discarded (hero passes)
const MAX_HERO_ACTIONS = 16;

export type MatchOutcome = "red" | "blue" | "draw";

export interface ReplayFrame { serializedState: object; events: GameEvent[]; turnNumber: number; team: TeamId }

export interface MatchResult {
  outcome: MatchOutcome;
  seed: number;
  /** Which controller played which side. */
  red: string;
  blue: string;
  turns: number;
  /** Final HP% (current / max, alive units only) per side — the draw tie-break and a quality signal. */
  hpFrac: Record<TeamId, number>;
  /** Per-side: max single-turn wall time (ms) the hero brain used, and how many turns it overran the budget. */
  timing: Record<TeamId, { maxMs: number; overruns: number; forfeits: number }>;
  /** Whether each hero is still standing at the end. */
  heroAlive: Record<TeamId, boolean>;
  log: string[];
  frames: ReplayFrame[];
}

interface Bot { name: string; hero: HeroController }

/**
 * Play one match. `redBot`/`blueBot` each control their side's hero; the five World-1 allies on
 * each side run their own scripted strategies. Red moves first (the tournament balances sides).
 */
export async function runMatch(
  redBot: Bot, blueBot: Bot, seed: number,
  opts: { maxTurns?: number; verbose?: boolean } = {},
): Promise<MatchResult> {
  const maxTurns = opts.maxTurns ?? 120;
  const arena = await buildArena(seed);
  let state = arena.state;
  const bots: Record<TeamId, Bot> = { red: redBot, blue: blueBot };

  const log: string[] = [`# ${redBot.name} (red) vs ${blueBot.name} (blue) — seed ${seed}, allies = ${arena.allyKeys.join(", ")}`];
  const frames: ReplayFrame[] = [{ serializedState: serializeGameState(state), events: [], turnNumber: state.turnNumber, team: state.activeTeam }];
  const timing: Record<TeamId, { maxMs: number; overruns: number; forfeits: number }> = {
    red: { maxMs: 0, overruns: 0, forfeits: 0 }, blue: { maxMs: 0, overruns: 0, forfeits: 0 },
  };
  const turnIndex: Record<TeamId, number> = { red: 0, blue: 0 };

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

  for (let t = 0; t < maxTurns && !state.winner; t++) {
    const team = state.activeTeam;
    turnIndex[team]++;
    const heroId = arena.heroIds[team];
    log.push("", `## turn ${state.turnNumber}  ${team}  (${bots[team].name})`);

    // 1) the hero brain
    const hero = state.entities.get(heroId);
    if (hero && !hero.dead) {
      const ctx: HeroContext = { state, heroId, deadlineMs: Date.now() + TURN_BUDGET_MS, turnIndex: turnIndex[team] };
      const t0 = Date.now();
      let actions: PlayerAction[] = [];
      let crashed = false;
      try { actions = bots[team].hero(ctx) ?? []; }
      catch (e) { crashed = true; log.push(`  !! ${bots[team].name} threw: ${(e as Error).message} — hero forfeits the turn`); }
      const dt = Date.now() - t0;
      timing[team].maxMs = Math.max(timing[team].maxMs, dt);
      if (dt > TURN_BUDGET_MS) {
        timing[team].overruns++;
        log.push(`  !! ${bots[team].name} took ${dt}ms (> ${TURN_BUDGET_MS}ms budget)`);
      }
      if (crashed || dt > TURN_BUDGET_MS * FORFEIT_FACTOR) { timing[team].forfeits++; actions = []; }

      // 2) validate & apply the hero's actions
      let applied = 0;
      for (const a of actions) {
        if (applied >= MAX_HERO_ACTIONS) { log.push(`  !! ${bots[team].name} returned > ${MAX_HERO_ACTIONS} actions — extras ignored`); break; }
        if (a.type !== "ability" || a.entityId !== heroId) { log.push(`  !! ${bots[team].name} returned a non-hero action ${JSON.stringify(a)} — dropped`); continue; }
        if (step(a)) { applied++; log.push(`  hero ${describe(a)}`); }
        else log.push(`  !! ${bots[team].name}: ${describe(a)} did nothing (rejected by engine) — dropped`);
        if (state.winner) break;
      }
      if (applied === 0 && !crashed) log.push(`  hero passes`);
    } else {
      log.push(`  (hero is down)`);
    }

    // 3) the scripted World-1 allies, in the engine's usual closest-enemy-first order
    if (!state.winner) {
      const allies = [...state.entities.values()]
        .filter(e => e.teamId === team && !e.dead && e.id !== heroId)
        .sort((a, b) => closestEnemyDist(a, state) - closestEnemyDist(b, state));
      for (const u0 of allies) {
        if (state.entities.get(u0.id)?.dead) continue;
        for (const action of strategyForEntity(u0).planActions(u0, state)) { step(action); if (state.winner) break; }
        if (state.winner) break;
      }
    }

    // 4) end the turn (regen / barrier-clear / status-tick / zones for the next side)
    if (!state.winner) step({ type: "endTurn" });

    if (opts.verbose) for (const e of state.entities.values()) if (!e.dead) log.push(`     ${e.id.padEnd(22)} hp ${e.hp}/${e.maxHp}`);
  }

  const hpFrac = { red: hpFraction(state, "red"), blue: hpFraction(state, "blue") };
  const heroAlive = { red: !!state.entities.get(arena.heroIds.red) && !state.entities.get(arena.heroIds.red)!.dead,
                      blue: !!state.entities.get(arena.heroIds.blue) && !state.entities.get(arena.heroIds.blue)!.dead };
  const outcome: MatchOutcome = state.winner ?? (Math.abs(hpFrac.red - hpFrac.blue) < 1e-6 ? "draw" : (hpFrac.red > hpFrac.blue ? "red" : "blue"));
  log.push("", state.winner ? `Winner: ${state.winner}` : `Turn cap reached — HP% red ${(hpFrac.red * 100).toFixed(0)} / blue ${(hpFrac.blue * 100).toFixed(0)} → ${outcome}`);

  return { outcome, seed, red: redBot.name, blue: blueBot.name, turns: state.turnNumber, hpFrac, timing, heroAlive, log, frames };
}

// --- small helpers ---------------------------------------------------------

function describe(a: PlayerAction): string {
  if (a.type === "endTurn") return "endTurn";
  const aim = a.aimDirection ? ` aim(${a.aimDirection.x.toFixed(0)},${a.aimDirection.y.toFixed(0)})` : "";
  const dst = a.destination ? ` →(${a.destination.x.toFixed(0)},${a.destination.y.toFixed(0)})` : "";
  return `${a.abilityId}${aim}${dst}`;
}
function closestEnemyDist(e: { teamId: TeamId; position: { x: number; y: number } }, s: GameState): number {
  let best = Infinity;
  for (const o of s.entities.values()) if (!o.dead && o.teamId !== e.teamId) best = Math.min(best, Math.hypot(e.position.x - o.position.x, e.position.y - o.position.y));
  return best;
}
function hpFraction(s: GameState, team: TeamId): number {
  let hp = 0, max = 0;
  for (const e of s.entities.values()) if (e.teamId === team) { max += e.maxHp; hp += e.dead ? 0 : e.hp + e.barrier; }
  return max > 0 ? hp / max : 0;
}
