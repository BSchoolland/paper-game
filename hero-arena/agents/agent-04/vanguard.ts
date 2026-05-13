/**
 * agent-04 — "Vanguard".
 *
 * Wide beam search (width 28) over complete hero turns + blended adversarial
 * rollout. The wide beam finds multi-action combos that narrower beams miss,
 * while beam pruning keeps computation tractable.
 *
 * The rollout blends pessimistic (adversarial opponent) and expected (scripted
 * opponent) outcomes so the bot accepts calculated risk instead of turtling.
 *
 * The evaluation uses concave (sqrt) enemy HP scoring — a natural focus-fire
 * incentive where the last few HP on a wounded target are worth far more than
 * chip damage on a full-health one.
 */
import type { HeroController } from "../../src/types.js";
import type {
  AttackAbility, Entity, EntityId, GameState, MoveAbility, PlayerAction, TeamId, Vec2,
} from "../../../shared/src/index.js";
import { canAffordAbility, getEffectiveDistance } from "../../../shared/src/index.js";
import { add, sub, scale, normalize } from "../../../shared/src/core/vec2.js";
import {
  tryAction, resolveAction, teamOf, livingEnemies, livingAllies, nearest, centroid, dist,
  attackAbilities, attackRange, moveAbility, attackHits, pathToward, effectiveHp,
  simulateMyAlliesTurn, simulateScriptedTurn,
} from "../../src/toolkit.js";

// --- search parameters -------------------------------------------------------
const SAFETY_MS = 200;
const MAX_STEPS = 5;
const BEAM_WIDTH = 28;
const ROLLOUT_CAP = 18;
const ADVERSARIAL_BLEND = 0.55;

// --- eval weights ------------------------------------------------------------
const W_HERO_HP = 1.1;
const W_HERO_DEAD = 2.8;
const W_HERO_THREAT = 0.35;
const W_HERO_INITIATIVE = 0.55;
const W_HERO_ENGAGE = 0.4;
const W_ENEMY_HERO_DEAD = 2.0;
const W_ENEMY_HERO_SUPPRESS = 0.85;
const W_FOCUS_FIRE = 1.0;
const W_CLUSTER = 0.22;
const W_ALLY_HP = 0.15;
const W_DRIFT = 2.0;
const W_COHESION = 0.5;
const W_ALIVE = 0.7;
const W_OWN_HP = 0.5;

// --- the controller ----------------------------------------------------------

interface TurnCandidate { plan: PlayerAction[]; state: GameState }

export const vanguardHero: HeroController = (ctx) => {
  const team = teamOf(ctx.state, ctx.heroId);
  const me = ctx.state.entities.get(ctx.heroId);
  if (!me || me.dead || livingEnemies(ctx.state, ctx.heroId).length === 0) return [];

  const deadline = ctx.deadlineMs - SAFETY_MS;
  const timeUp = () => Date.now() >= deadline;

  // Phase 1: wide beam search over complete hero turns
  const turns = beamSearchTurns(ctx.state, ctx.heroId, team, timeUp);

  // Phase 2: rank by static eval, keep top ROLLOUT_CAP (always include pass)
  const scored = turns.map(t => ({
    ...t,
    val: t.state.winner === team ? 1e8 : staticEval(t.state, ctx.heroId, team),
  }));
  scored.sort((a, b) => b.val - a.val);

  // Dedup by action signature
  const seen = new Set<string>();
  const deduped: typeof scored = [];
  for (const s of scored) {
    const key = s.plan.map(sig).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }

  const pass: TurnCandidate & { val: number } = {
    plan: [], state: ctx.state, val: staticEval(ctx.state, ctx.heroId, team),
  };
  const candidates = [pass, ...deduped.filter(s => s.plan.length > 0)].slice(0, ROLLOUT_CAP);

  // Phase 3: blended adversarial rollout
  let best: TurnCandidate = pass;
  let bestVal = -Infinity;
  for (const c of candidates) {
    if (timeUp()) break;
    const v = c.state.winner === team
      ? 1e6
      : adversarialRollout(c.state, ctx.heroId, team, timeUp);
    if (v > bestVal) { bestVal = v; best = c; }
  }
  return best.plan;
};

// =============================================================================
// Phase 1 — wide beam search
// =============================================================================

function beamSearchTurns(
  root: GameState, heroId: EntityId, team: TeamId, timeUp: () => boolean,
): TurnCandidate[] {
  const results: TurnCandidate[] = [];
  const visited = new Set<string>();
  visited.add(stateKey(root, heroId));

  let frontier: TurnCandidate[] = [{ plan: [], state: root }];

  for (let depth = 0; depth < MAX_STEPS && frontier.length > 0 && !timeUp(); depth++) {
    const nextFrontier: TurnCandidate[] = [];
    for (const node of frontier) {
      if (timeUp()) break;
      const hero = node.state.entities.get(heroId);
      if (!hero || hero.dead || node.state.winner) continue;

      for (const action of heroCandidates(node.state, hero)) {
        if (timeUp()) break;
        const after = tryAction(node.state, action);
        if (!after) continue;

        const key = stateKey(after, heroId);
        if (visited.has(key)) continue;
        visited.add(key);

        const child: TurnCandidate = { plan: [...node.plan, action], state: after };
        results.push(child);

        if (!after.winner) {
          const h = after.entities.get(heroId);
          if (h && !h.dead && h.abilities.some(a => canAffordAbility(h, a))) {
            nextFrontier.push(child);
          }
        }
      }
    }
    if (nextFrontier.length > BEAM_WIDTH) {
      nextFrontier.sort((a, b) =>
        staticEval(b.state, heroId, team) - staticEval(a.state, heroId, team));
      frontier = nextFrontier.slice(0, BEAM_WIDTH);
    } else {
      frontier = nextFrontier;
    }
  }
  return results;
}

function stateKey(s: GameState, heroId: EntityId): string {
  const h = s.entities.get(heroId);
  if (!h || h.dead) return "dead";
  let alive = 0, foeHp = 0;
  for (const e of s.entities.values()) {
    if (!e.dead) { alive++; if (e.teamId !== h.teamId) foeHp += e.hp + e.barrier; }
  }
  return `${Math.round(h.position.x / 8)},${Math.round(h.position.y / 8)},${h.energy.red},${h.energy.blue},${Math.round((h.hp + h.barrier) / 4)},${alive},${Math.round(foeHp / 6)}`;
}

// =============================================================================
// Candidate generation
// =============================================================================

function heroCandidates(state: GameState, hero: Entity): PlayerAction[] {
  const enemies = livingEnemies(state, hero.id);
  if (enemies.length === 0) return [];
  const out: PlayerAction[] = [];
  const near = nearest(hero.position, enemies)!;
  const cluster = enemies.length > 1 ? centroid(enemies) : near.position;
  const enemyHero = enemies.find(isHeroLike) ?? null;

  for (const a of hero.abilities) {
    if (a.kind === "barrier" && canAffordAbility(hero, a))
      out.push({ type: "ability", entityId: hero.id, abilityId: a.id });
  }

  const atks = attackAbilities(hero).filter(a => canAffordAbility(hero, a));

  const aimPoints: Vec2[] = [...enemies.map(e => e.position), cluster];
  if (enemyHero) aimPoints.push(enemyHero.position);
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      if (dist(enemies[i]!.position, enemies[j]!.position) <= 160)
        aimPoints.push({
          x: (enemies[i]!.position.x + enemies[j]!.position.x) / 2,
          y: (enemies[i]!.position.y + enemies[j]!.position.y) / 2,
        });
    }
  }

  const slamPts = slamAimPoints(state, hero, enemies);

  for (const atk of atks) {
    const points = atk.knockback > 0 ? [...aimPoints, ...slamPts] : aimPoints;
    const seenAim = new Set<string>();
    for (const tp of points) {
      const aim = sub(tp, hero.position);
      if (!aim.x && !aim.y) continue;
      const k = `${atk.id}:${Math.round(Math.atan2(aim.y, aim.x) * 24)}`;
      if (seenAim.has(k)) continue;
      seenAim.add(k);
      if (attackHits(state, hero, atk, aim).length > 0)
        out.push({ type: "ability", entityId: hero.id, abilityId: atk.id, aimDirection: aim });
    }
  }

  const mv = moveAbility(hero);
  if (mv && canAffordAbility(hero, mv)) {
    const range = atks.reduce((r, a) => Math.max(r, attackRange(a)), 0)
      || attackAbilities(hero).reduce((r, a) => Math.max(r, attackRange(a)), 0);
    const away = normalize(sub(hero.position, near.position));
    const targets: Vec2[] = [];

    for (const e of enemies) targets.push(e.position);
    targets.push(cluster);
    if (enemyHero) {
      targets.push(enemyHero.position);
      const perp = { x: -away.y, y: away.x };
      targets.push(add(enemyHero.position, scale(perp, 55)));
      targets.push(add(enemyHero.position, scale(perp, -55)));
    }

    const allies = livingAllies(state, hero.id);
    if (allies.length > 0) targets.push(centroid(allies));

    if (allies.length > 0) {
      const weak = allies.reduce((a, b) =>
        (a.hp + a.barrier) / a.maxHp <= (b.hp + b.barrier) / b.maxHp ? a : b);
      if ((weak.hp + weak.barrier) / weak.maxHp < 0.5) {
        const threat = nearest(weak.position, enemies);
        if (threat) targets.push(add(weak.position, scale(sub(threat.position, weak.position), 0.33)));
      }
    }

    if (away.x || away.y) {
      if (range > 1) {
        for (const f of [0.7, 0.95]) targets.push(add(near.position, scale(away, range * f)));
      }
      targets.push(add(hero.position, scale(away, mv.distance)));
    }

    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      targets.push(add(hero.position, { x: Math.cos(ang) * mv.distance, y: Math.sin(ang) * mv.distance }));
    }

    const seenDest = new Set<string>();
    for (const target of targets) {
      const dest = pathToward(state, hero.id, target);
      if (!dest) continue;
      const k = `${Math.round(dest.x / 8)},${Math.round(dest.y / 8)}`;
      if (seenDest.has(k)) continue;
      seenDest.add(k);
      out.push({ type: "ability", entityId: hero.id, abilityId: mv.id, destination: dest });
    }
  }
  return out;
}

function slamAimPoints(state: GameState, hero: Entity, enemies: Entity[]): Vec2[] {
  const out: Vec2[] = [];
  const g = state.grid;
  const mapW = g.width * g.cellSize, mapH = g.height * g.cellSize;
  const sorted = [...enemies]
    .sort((a, b) => dist(hero.position, a.position) - dist(hero.position, b.position))
    .slice(0, 3);
  for (const e of sorted) {
    const edges: Vec2[] = [
      { x: 0, y: e.position.y }, { x: mapW, y: e.position.y },
      { x: e.position.x, y: 0 }, { x: e.position.x, y: mapH },
    ];
    let bestEdge: Vec2 | null = null, bestD = Infinity;
    for (const edge of edges) {
      const d = dist(e.position, edge);
      if (d < bestD) { bestD = d; bestEdge = edge; }
    }
    if (bestEdge && bestD < 150) {
      const dir = normalize(sub(bestEdge, e.position));
      out.push(add(e.position, scale(dir, 1)));
    }
    for (const o of enemies) {
      if (o.id === e.id) continue;
      const he = normalize(sub(e.position, hero.position));
      const eo = normalize(sub(o.position, e.position));
      if (he.x * eo.x + he.y * eo.y > 0.6 && dist(e.position, o.position) < 80)
        out.push(e.position);
    }
  }
  return out;
}

// =============================================================================
// Phase 3 — blended adversarial rollout
// =============================================================================

function adversarialRollout(
  state: GameState, heroId: EntityId, team: TeamId, timeUp: () => boolean,
): number {
  const afterAllies = simulateMyAlliesTurn(state, heroId);
  const afterEnd = resolveAction(afterAllies, { type: "endTurn" });
  if (afterEnd.winner) return staticEval(afterEnd, heroId, team);

  const enemyTeam = afterEnd.activeTeam;
  const enemyHero = [...afterEnd.entities.values()].find(
    e => !e.dead && e.teamId === enemyTeam && isHeroLike(e),
  ) ?? null;

  const scriptedVal = staticEval(simulateScriptedTurn(afterEnd), heroId, team);
  let worst = scriptedVal;

  if (enemyHero && !timeUp()) {
    worst = Math.min(worst, staticEval(
      applyEnemyHeroTurn(afterEnd, enemyHero.id, huntPlan(afterEnd, enemyHero.id, heroId)),
      heroId, team,
    ));

    if (!timeUp()) {
      const myAllies = [...afterEnd.entities.values()]
        .filter(e => !e.dead && e.teamId === team && e.id !== heroId);
      if (myAllies.length > 0) {
        const weak = myAllies.reduce((a, b) =>
          (a.hp + a.barrier) / a.maxHp <= (b.hp + b.barrier) / b.maxHp ? a : b);
        worst = Math.min(worst, staticEval(
          applyEnemyHeroTurn(afterEnd, enemyHero.id, huntPlan(afterEnd, enemyHero.id, weak.id)),
          heroId, team,
        ));
      }
    }
  }

  return ADVERSARIAL_BLEND * worst + (1 - ADVERSARIAL_BLEND) * scriptedVal;
}

function applyEnemyHeroTurn(state: GameState, enemyHeroId: EntityId, heroPlan: PlayerAction[]): GameState {
  let s = state;
  for (const a of heroPlan) s = resolveAction(s, a);
  if (s.winner) return s;
  s = simulateMyAlliesTurn(s, enemyHeroId);
  return resolveAction(s, { type: "endTurn" });
}

function huntPlan(state: GameState, attackerId: EntityId, victimId: EntityId): PlayerAction[] {
  const plan: PlayerAction[] = [];
  let s = state;
  for (let step = 0; step < MAX_STEPS; step++) {
    const a = s.entities.get(attackerId), v = s.entities.get(victimId);
    if (!a || a.dead || !v || v.dead || s.winner) break;
    let acted = false;
    for (const atk of attackAbilities(a).filter(x => canAffordAbility(a, x)).sort((x, y) => y.damage - x.damage)) {
      const aim = sub(v.position, a.position);
      if (!aim.x && !aim.y) continue;
      if (attackHits(s, a, atk, aim).some(h => h.id === victimId)) {
        const act: PlayerAction = { type: "ability", entityId: attackerId, abilityId: atk.id, aimDirection: aim };
        const after = tryAction(s, act);
        if (after) { plan.push(act); s = after; acted = true; break; }
      }
    }
    if (acted) continue;
    const mv = moveAbility(a);
    if (mv && canAffordAbility(a, mv)) {
      const dest = pathToward(s, attackerId, v.position);
      if (dest) {
        const act: PlayerAction = { type: "ability", entityId: attackerId, abilityId: mv.id, destination: dest };
        const after = tryAction(s, act);
        if (after) { plan.push(act); s = after; continue; }
      }
    }
    break;
  }
  return plan;
}

// =============================================================================
// Evaluation
// =============================================================================

function staticEval(s: GameState, heroId: EntityId, team: TeamId): number {
  const foeTeam: TeamId = team === "red" ? "blue" : "red";
  if (s.winner === team) return 1000;
  if (s.winner === foeTeam) return -1000;

  let ourAlive = 0, ourTot = 0, foeAlive = 0, foeTot = 0;
  let ourHp = 0, ourMax = 0;
  for (const e of s.entities.values()) {
    if (e.teamId === team) {
      ourTot++; ourMax += e.maxHp;
      if (!e.dead) { ourAlive++; ourHp += e.hp + e.barrier; }
    } else {
      foeTot++;
      if (!e.dead) foeAlive++;
    }
  }

  let v = W_ALIVE * ((ourTot ? ourAlive / ourTot : 0) - (foeTot ? foeAlive / foeTot : 0));
  if (ourMax > 0) v += W_OWN_HP * (ourHp / ourMax);

  let foeSqrtHp = 0;
  for (const e of s.entities.values()) {
    if (e.teamId === foeTeam && !e.dead)
      foeSqrtHp += Math.sqrt(effectiveHp(e) / e.maxHp);
  }
  v -= W_FOCUS_FIRE * (foeTot > 0 ? foeSqrtHp / foeTot : 0);

  const hero = s.entities.get(heroId);
  const enemies = [...s.entities.values()].filter(e => !e.dead && e.teamId === foeTeam);

  if (!hero || hero.dead) {
    v -= W_HERO_DEAD;
  } else {
    v += W_HERO_HP * (hero.hp + hero.barrier) / hero.maxHp;

    let incoming = 0;
    for (const e of enemies) {
      const reach = mReach(e) + aReach(e);
      const d = dist(e.position, hero.position) - hero.collisionRadius - e.collisionRadius;
      if (d <= reach) incoming += bDmg(e);
    }
    v -= W_HERO_THREAT * (incoming / hero.maxHp);

    if (enemies.length > 0) {
      const myReach = mReach(hero) + aReach(hero);
      const myAtkReach = aReach(hero);
      let canThreaten = false, inAttackRange = 0;
      for (const e of enemies) {
        const d = dist(e.position, hero.position) - hero.collisionRadius - e.collisionRadius;
        if (d <= myReach) canThreaten = true;
        if (d <= myAtkReach) inAttackRange++;
      }
      if (canThreaten) v += W_HERO_INITIATIVE * (bDmg(hero) / hero.maxHp);
      v += W_HERO_ENGAGE * Math.min(inAttackRange, 3);

      let nd = Infinity;
      for (const e of enemies) nd = Math.min(nd, dist(e.position, hero.position));
      if (Number.isFinite(nd)) v -= W_DRIFT * (nd / 1000);

      const mates = [...s.entities.values()]
        .filter(e => e.teamId === team && !e.dead && e.id !== heroId);
      if (mates.length > 0) v -= W_COHESION * (dist(hero.position, centroid(mates)) / 1000);

      if (enemies.length > 1) {
        const c = centroid(enemies);
        let within = 0;
        for (const e of enemies) if (dist(e.position, c) <= 90) within++;
        v += W_CLUSTER * (within / enemies.length);
      }
    }
  }

  const enemyHero = [...s.entities.values()].find(e => e.teamId === foeTeam && isHeroLike(e));
  if (enemyHero) {
    if (enemyHero.dead) v += W_ENEMY_HERO_DEAD;
    else v += W_ENEMY_HERO_SUPPRESS * (1 - (enemyHero.hp + enemyHero.barrier) / enemyHero.maxHp);
  }

  const allies = [...s.entities.values()].filter(e => e.teamId === team && e.id !== heroId);
  if (allies.length > 0) {
    let hp = 0, max = 0;
    for (const e of allies) { max += e.maxHp; hp += e.dead ? 0 : e.hp + e.barrier; }
    if (max > 0) v += W_ALLY_HP * (hp / max);
  }

  return v;
}

// =============================================================================
// Helpers
// =============================================================================

function isHeroLike(e: Entity): boolean {
  return e.abilities.some(a => a.id === "greatsword-halfsword");
}
function mReach(e: Entity): number {
  const mv = e.abilities.find(a => a.kind === "move") as MoveAbility | undefined;
  return mv ? getEffectiveDistance(e, mv.distance) : 0;
}
function aReach(e: Entity): number {
  let r = 0;
  for (const a of e.abilities) if (a.kind === "attack") r = Math.max(r, attackRange(a as AttackAbility));
  return r;
}
function bDmg(e: Entity): number {
  let d = 0;
  for (const a of e.abilities) if (a.kind === "attack") d = Math.max(d, (a as AttackAbility).damage);
  return d;
}
function sig(a: PlayerAction): string {
  if (a.type !== "ability") return a.type;
  const aim = a.aimDirection ? `@${Math.round(Math.atan2(a.aimDirection.y, a.aimDirection.x) * 32)}` : "";
  const dst = a.destination ? `>${Math.round(a.destination.x / 8)},${Math.round(a.destination.y / 8)}` : "";
  return `${a.abilityId}${aim}${dst}`;
}
