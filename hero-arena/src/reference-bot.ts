/**
 * The reference hero — a solid, easily-beaten starting point that every agent folder ships with.
 *
 * Strategy: greedily build the turn one action at a time. At each step, try every sensible next
 * hero action (attack aimed at each foe / the foe cluster if a shot connects; move toward each foe
 * / the cluster / a kite-range ring / a full retreat), evaluate each by *playing the rest of the
 * round out* — your dumb allies' scripted turn, then the opponent's whole turn assumed scripted —
 * and keep the best, or stop if stopping is best. One-ply lookahead with verification: nothing
 * fancy, but it focus-fires, repositions, and doesn't walk into death. Beat it.
 */
import type { HeroController } from "./types.js";
import type { AttackAbility, Entity, GameState, PlayerAction, TeamId, Vec2 } from "../../shared/src/index.js";
import { canAffordAbility } from "../../shared/src/index.js";
import { add, normalize, scale, sub } from "../../shared/src/core/vec2.js";
import {
  tryAction, resolveAction, teamOf, livingEnemies, nearest, centroid,
  attackAbilities, attackRange, moveAbility, attackHits, pathToward, basicScore,
  simulateMyAlliesTurn, simulateScriptedTurn,
} from "./toolkit.js";

const MAX_STEPS = 4;            // hero abilities per turn (energy bounds it tighter than this anyway)
const KITE_RING = 0.85;         // when repositioning to fire, aim for 85% of our attack range

export const referenceHero: HeroController = (ctx) => {
  const team = teamOf(ctx.state, ctx.heroId);
  const plan: PlayerAction[] = [];
  let state = ctx.state;

  for (let step = 0; step < MAX_STEPS; step++) {
    const hero = state.entities.get(ctx.heroId);
    if (!hero || hero.dead) break;

    let bestAction: PlayerAction | null = null;
    let bestValue = evalRound(state, ctx.heroId, team); // value of stopping here
    for (const action of heroCandidates(state, hero)) {
      const after = tryAction(state, action);
      if (!after) continue;
      const v = evalRound(after, ctx.heroId, team);
      if (v > bestValue + 1e-9) { bestValue = v; bestAction = action; }
    }
    if (!bestAction) break; // stopping wins

    plan.push(bestAction);
    state = tryAction(state, bestAction)!;
    if (state.winner) break;
  }
  return plan;
};

/** Value of the position from `team`'s view *after the hero has finished acting* — i.e. once the
 *  dumb allies take their scripted turn and the opponent takes a full (assumed-scripted) turn. */
function evalRound(state: GameState, heroId: string, team: TeamId): number {
  const afterAllies = simulateMyAlliesTurn(state, heroId);
  const afterEnd = resolveAction(afterAllies, { type: "endTurn" });
  const afterReply = afterEnd.winner ? afterEnd : simulateScriptedTurn(afterEnd);
  let v = basicScore(afterReply, team);
  const hero = afterReply.entities.get(heroId);
  if (!hero || hero.dead) {
    v -= 1.0; // the hero is the irreplaceable piece — losing it is far worse than losing an ally
  } else {
    v += 0.6 * (hero.hp + hero.barrier) / hero.maxHp;
    // tiny nudge: when nothing else distinguishes options, drift toward the nearest enemy so the
    // hero actually walks into the fight instead of idling. Far too small to override real HP swings.
    const foes = afterReply.entities.values();
    let nearestD = Infinity;
    for (const e of foes) if (!e.dead && e.teamId !== hero.teamId) nearestD = Math.min(nearestD, Math.hypot(e.position.x - hero.position.x, e.position.y - hero.position.y));
    if (Number.isFinite(nearestD)) v -= 0.0008 * nearestD;
  }
  return v;
}

function heroCandidates(state: GameState, hero: Entity): PlayerAction[] {
  const enemies = livingEnemies(state, hero.id);
  if (enemies.length === 0) return [];
  const out: PlayerAction[] = [];
  const near = nearest(hero.position, enemies)!;
  const cluster = enemies.length > 1 ? centroid(enemies) : near.position;
  const atks: AttackAbility[] = attackAbilities(hero).filter(a => canAffordAbility(hero, a));

  // non-aimed abilities (shield block, etc.) — just cast them
  for (const a of hero.abilities) if (a.kind === "barrier" && canAffordAbility(hero, a)) out.push({ type: "ability", entityId: hero.id, abilityId: a.id });

  // attack in place — aim at each foe (and the cluster) where a shot actually connects
  for (const atk of atks) {
    for (const targetPos of [...enemies.map(e => e.position), cluster]) {
      const aim = sub(targetPos, hero.position);
      if ((!aim.x && !aim.y)) continue;
      if (attackHits(state, hero, atk, aim).length > 0) out.push({ type: "ability", entityId: hero.id, abilityId: atk.id, aimDirection: aim });
    }
  }

  // moves — toward each foe / the cluster, and (defensively) a kite ring / full retreat from the nearest
  const mv = moveAbility(hero);
  if (mv && canAffordAbility(hero, mv)) {
    const range = atks.reduce((r, a) => Math.max(r, attackRange(a)), 0);
    const targets: Vec2[] = [...enemies.map(e => e.position), cluster];
    const away = normalize(sub(hero.position, near.position));
    if (away.x || away.y) {
      if (range > 1) targets.push(add(near.position, scale(away, range * KITE_RING)));
      targets.push(add(hero.position, scale(away, mv.distance)));
    }
    const seen = new Set<string>();
    for (const target of targets) {
      const dest = pathToward(state, hero.id, target);
      if (!dest) continue;
      const k = `${Math.round(dest.x)},${Math.round(dest.y)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ type: "ability", entityId: hero.id, abilityId: mv.id, destination: dest });
    }
  }
  return out;
}

/** A bare-bones bot (always charge the nearest foe; attack if a shot lands) — for smoke-testing. */
export const baselineHero: HeroController = (ctx) => {
  const hero = ctx.state.entities.get(ctx.heroId);
  if (!hero || hero.dead) return [];
  const enemies = livingEnemies(ctx.state, ctx.heroId);
  if (enemies.length === 0) return [];
  const target = nearest(hero.position, enemies)!;
  const plan: PlayerAction[] = [];
  let state = ctx.state;
  // attack in place if possible
  const fireAt = (s: GameState): PlayerAction | null => {
    const h = s.entities.get(ctx.heroId)!;
    for (const atk of attackAbilities(h).filter(a => canAffordAbility(h, a))) {
      const aim = sub(target.position, h.position);
      if (attackHits(s, h, atk, aim).length > 0) return { type: "ability", entityId: h.id, abilityId: atk.id, aimDirection: aim };
    }
    return null;
  };
  let shot = fireAt(state);
  if (shot) { plan.push(shot); return plan; }
  const h = state.entities.get(ctx.heroId)!;
  const mv = moveAbility(h);
  if (mv && canAffordAbility(h, mv)) {
    const dest = pathToward(state, h.id, target.position);
    if (dest) {
      const moveAction: PlayerAction = { type: "ability", entityId: h.id, abilityId: mv.id, destination: dest };
      const after = tryAction(state, moveAction);
      if (after) { plan.push(moveAction); state = after; shot = fireAt(state); if (shot) plan.push(shot); }
    }
  }
  return plan;
};
