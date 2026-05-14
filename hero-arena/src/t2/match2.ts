import { resolveAction, serializeGameState } from "../../../shared/src/index.js";
import type { EntityId, GameEvent, GameState, PlayerAction, TeamId } from "../../../shared/src/index.js";
import { strategyForEntity } from "../../../shared/src/ai/strategy.js";
import type { HeroContext, HeroController } from "../types.js";
import type { ArenaConfig, MultiMatchResult, MultiMatchOutcome } from "./types.js";
import { buildArena2 } from "./arena2.js";

export const TURN_BUDGET_MS = Number(globalThis.process?.env?.HERO_TURN_BUDGET_MS ?? 2000);
const FORFEIT_FACTOR = 3;
const MAX_HERO_ACTIONS = 16;

export interface BotTeam {
  name: string;
  controllers: Map<EntityId, HeroController>;
}

export interface Match2Options {
  maxTurns?: number;
  verbose?: boolean;
}

export async function runMatch2(
  redTeam: BotTeam,
  blueTeam: BotTeam,
  config: ArenaConfig,
  opts: Match2Options = {},
): Promise<MultiMatchResult> {
  const maxTurns = opts.maxTurns ?? 120;
  const arena = await buildArena2(config);
  let state = arena.state;
  const teams: Record<TeamId, BotTeam> = { red: redTeam, blue: blueTeam };

  const log: string[] = [`# ${redTeam.name} (red) vs ${blueTeam.name} (blue) — seed ${config.seed}`];
  const turnIndex: Record<TeamId, number> = { red: 0, blue: 0 };

  const step = (action: PlayerAction): boolean => {
    const res = resolveAction(state, action);
    if (res.state === state) return false;
    state = res.state;
    return true;
  };

  for (let t = 0; t < maxTurns && !state.winner; t++) {
    const team = state.activeTeam;
    turnIndex[team]++;
    const heroIdList = arena.heroIds[team];
    const botTeam = teams[team];
    log.push(`## turn ${state.turnNumber}  ${team}  (${botTeam.name})`);

    // 1) Each hero on this team acts sequentially
    for (const heroId of heroIdList) {
      const hero = state.entities.get(heroId);
      if (!hero || hero.dead) continue;

      const controller = botTeam.controllers.get(heroId);
      if (!controller) continue;

      const ctx: HeroContext = { state, heroId, deadlineMs: Date.now() + TURN_BUDGET_MS, turnIndex: turnIndex[team] };
      const t0 = Date.now();
      let actions: PlayerAction[] = [];
      let crashed = false;
      try { actions = controller(ctx) ?? []; }
      catch (e) { crashed = true; log.push(`  !! ${heroId} threw: ${(e as Error).message}`); }
      const dt = Date.now() - t0;

      if (dt > TURN_BUDGET_MS) log.push(`  !! ${heroId} took ${dt}ms (> ${TURN_BUDGET_MS}ms budget)`);
      if (crashed || dt > TURN_BUDGET_MS * FORFEIT_FACTOR) actions = [];

      let applied = 0;
      for (const a of actions) {
        if (applied >= MAX_HERO_ACTIONS) break;
        if (a.type !== "ability" || a.entityId !== heroId) continue;
        if (step(a)) { applied++; log.push(`  ${heroId} ${describe(a)}`); }
        if (state.winner) break;
      }
      if (applied === 0 && !crashed) log.push(`  ${heroId} passes`);
      if (state.winner) break;
    }

    // 2) Scripted allies
    if (!state.winner) {
      const allies = [...state.entities.values()]
        .filter(e => e.teamId === team && !e.dead && !heroIdList.includes(e.id))
        .sort((a, b) => closestEnemyDist(a, state) - closestEnemyDist(b, state));
      for (const u0 of allies) {
        if (state.entities.get(u0.id)?.dead) continue;
        for (const action of strategyForEntity(u0).planActions(u0, state)) {
          step(action);
          if (state.winner) break;
        }
        if (state.winner) break;
      }
    }

    // 3) End turn
    if (!state.winner) step({ type: "endTurn" });

    if (opts.verbose) {
      for (const e of state.entities.values()) {
        if (!e.dead) log.push(`     ${e.id.padEnd(22)} hp ${e.hp}/${e.maxHp}`);
      }
    }
  }

  const hpFrac = { red: hpFraction(state, "red"), blue: hpFraction(state, "blue") };
  const heroesAlive = {
    red: arena.heroIds.red.filter(id => { const e = state.entities.get(id); return e && !e.dead; }).length,
    blue: arena.heroIds.blue.filter(id => { const e = state.entities.get(id); return e && !e.dead; }).length,
  };
  const outcome: MultiMatchOutcome = state.winner ??
    (Math.abs(hpFrac.red - hpFrac.blue) < 1e-6 ? "draw" : (hpFrac.red > hpFrac.blue ? "red" : "blue"));
  log.push(state.winner ? `Winner: ${state.winner}` : `Turn cap — HP% red ${(hpFrac.red * 100).toFixed(0)} / blue ${(hpFrac.blue * 100).toFixed(0)} → ${outcome}`);

  return { outcome, red: redTeam.name, blue: blueTeam.name, seed: config.seed, turns: state.turnNumber, hpFrac, heroesAlive, log };
}

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
