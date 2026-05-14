import type { HeroController } from "../../src/types.js";
import type {
  AbilityDefinition, AttackAbility, Entity, EntityId, GameState, MoveAbility, PlayerAction, TeamId, Vec2,
} from "../../../shared/src/index.js";
import { canAffordAbility, getEffectiveDistance } from "../../../shared/src/index.js";
import { ShapeKind } from "../../../shared/src/core/types.js";
import { add, sub, scale, normalize } from "../../../shared/src/core/vec2.js";
import {
  tryAction, resolveAction, teamOf, livingEnemies, livingAllies, nearest, centroid, dist,
  attackAbilities, attackRange, moveAbility, attackHits, pathToward, effectiveHp, basicScore,
  simulateMyAlliesTurn, simulateScriptedTurn,
} from "../../src/toolkit.js";

// =============================================================================
// Configurable factory
// =============================================================================

export interface VanguardConfig {
  beamWidth: number;
  maxSteps: number;
  finalists: number;
  safetyMs: number;
  pveMode: boolean;   // true = scripted rollout, false = adversarial
  lightPve: boolean;  // true = static eval only (skip rollout), for squad PvE
  rolloutBeam: boolean; // true = use rollout as beam eval (expensive but informed)
  adversarialBlend: number;
  // eval weights
  wHeroHp: number;
  wHeroDead: number;
  wHeroThreat: number;
  wHeroOffense: number;
  wFocusFire: number;    // sqrt-HP focus fire weight
  wFocusTarget: number;  // explicit focus target bonus
  wCluster: number;
  wAllyHp: number;
  wDrift: number;
  wCohesion: number;
  wKiteBonus: number;
  wLethalZone: number;
  moveSamples: number;
  maxCandidates: number;
}

export const BASE_CONFIG: VanguardConfig = {
  beamWidth: 14,
  maxSteps: 6,
  finalists: 24,
  safetyMs: 100,
  pveMode: false,
  lightPve: false,
  rolloutBeam: false,
  adversarialBlend: 0.5,
  wHeroHp: 0.8,
  wHeroDead: 2.5,
  wHeroThreat: 0.7,
  wHeroOffense: 0.8,
  wFocusFire: 0.6,
  wFocusTarget: 0.7,
  wCluster: 0.25,
  wAllyHp: 0.2,
  wDrift: 1.2,
  wCohesion: 0.6,
  wKiteBonus: 0,
  wLethalZone: 1.0,
  moveSamples: 10,
  maxCandidates: 0,
};

export const PVE_SOLO_CONFIG: VanguardConfig = {
  ...BASE_CONFIG,
  beamWidth: 14,
  finalists: 28,
  safetyMs: 60,
  pveMode: true,
  adversarialBlend: 0,
  wHeroHp: 1.1,
  wHeroDead: 3.0,
  wHeroThreat: 0.8,
  wHeroOffense: 1.0,
  wFocusFire: 0.8,
  wFocusTarget: 0.8,
  wDrift: 1.4,
  wCohesion: 0.0,
  wAllyHp: 0.0,
  wCluster: 0.3,
};

export const PVE_CONFIG: VanguardConfig = {
  ...BASE_CONFIG,
  beamWidth: 16,
  finalists: 28,
  pveMode: true,
  wHeroHp: 1.0,
  wHeroDead: 3.0,
  wHeroThreat: 0.9,
  wFocusFire: 0.8,
  wFocusTarget: 0.8,
  wDrift: 1.4,
  wCohesion: 0.0,
};

export const PVE_SQUAD_CONFIG: VanguardConfig = {
  ...PVE_CONFIG,
  beamWidth: 10,
  finalists: 14,
  safetyMs: 120,
  lightPve: true,
  wCohesion: 0.5,
  wAllyHp: 0.25,
};

export const PVE_TANK_CONFIG: VanguardConfig = {
  ...PVE_SQUAD_CONFIG,
  wHeroHp: 1.3,
  wHeroDead: 3.5,
  wHeroThreat: 0.5,
  wHeroOffense: 0.5,
  wCohesion: 0.6,
  wAllyHp: 0.3,
  wDrift: 1.2,
};

export const PVE_RANGED_CONFIG: VanguardConfig = {
  ...PVE_SQUAD_CONFIG,
  wHeroThreat: 1.3,
  wHeroOffense: 1.0,
  wKiteBonus: 0.4,
  wDrift: -0.1,
  wCohesion: 0.4,
};

export const FIGHTER_CONFIG: VanguardConfig = {
  ...BASE_CONFIG,
  beamWidth: 12,
  finalists: 18,
  lightPve: true,
  wFocusTarget: 0.9,
};

export const TANK_CONFIG: VanguardConfig = {
  ...BASE_CONFIG,
  beamWidth: 12,
  finalists: 18,
  lightPve: true,
  wHeroHp: 1.2,
  wHeroDead: 3.0,
  wHeroThreat: 0.5,
  wHeroOffense: 0.5,
  wCohesion: 0.7,
  wAllyHp: 0.3,
  wDrift: 1.0,
  wFocusTarget: 0.9,
};

export const RANGED_CONFIG: VanguardConfig = {
  ...BASE_CONFIG,
  beamWidth: 12,
  finalists: 18,
  lightPve: true,
  wHeroThreat: 1.3,
  wHeroOffense: 1.0,
  wKiteBonus: 0.4,
  wDrift: -0.15,
  wCohesion: 0.5,
  wFocusTarget: 0.9,
};

export const RAID_FIGHTER_CONFIG: VanguardConfig = {
  ...BASE_CONFIG,
  beamWidth: 12,
  finalists: 18,
  adversarialBlend: 0.5,
  wLethalZone: 0,
  wHeroHp: 1.0,
  wHeroDead: 3.0,
  wHeroThreat: 0.8,
  wHeroOffense: 1.2,
  wFocusTarget: 1.2,
  wFocusFire: 0.8,
  wDrift: 1.4,
  wAllyHp: 0.4,
  wCohesion: 0.3,
};

export const RAID_TANK_CONFIG: VanguardConfig = {
  ...BASE_CONFIG,
  beamWidth: 12,
  finalists: 18,
  adversarialBlend: 0.5,
  wLethalZone: 0,
  wHeroHp: 1.5,
  wHeroDead: 3.5,
  wHeroThreat: 0.6,
  wHeroOffense: 0.5,
  wCohesion: 0.5,
  wAllyHp: 0.6,
  wDrift: 1.0,
  wFocusTarget: 1.0,
  wFocusFire: 0.8,
};

export const RAID_RANGED_CONFIG: VanguardConfig = {
  ...BASE_CONFIG,
  beamWidth: 12,
  finalists: 18,
  adversarialBlend: 0.5,
  wLethalZone: 0,
  wHeroHp: 1.2,
  wHeroDead: 3.0,
  wHeroThreat: 1.0,
  wHeroOffense: 1.0,
  wKiteBonus: 0.4,
  wDrift: -0.1,
  wCohesion: 0.3,
  wFocusTarget: 1.0,
  wFocusFire: 0.8,
  wAllyHp: 0.4,
};

export const BOSS_CONFIG: VanguardConfig = {
  ...BASE_CONFIG,
  beamWidth: 16,
  finalists: 24,
  lightPve: true,
  wLethalZone: 0,
  wHeroHp: 0.3,
  wHeroDead: 1.5,
  wHeroThreat: 0.1,
  wHeroOffense: 2.0,
  wFocusTarget: 1.5,
  wFocusFire: 1.5,
  wCluster: 0.7,
  wDrift: 2.5,
  wCohesion: 0.0,
  wAllyHp: 0.15,
};

// =============================================================================
// The controller factory
// =============================================================================

interface TurnCandidate { plan: PlayerAction[]; state: GameState }

interface EnemySnap { id: EntityId; hp: number; maxHp: number }

interface EvalCtx {
  heroId: EntityId;
  team: TeamId;
  cfg: VanguardConfig;
  focusId: EntityId | null;
  focusBaseHp: number;
  initEnemies: EnemySnap[];
  initAllies: EnemySnap[];
}

export function makeVanguard(cfg: VanguardConfig): HeroController {
  return (ctx) => {
    const team = teamOf(ctx.state, ctx.heroId);
    const me = ctx.state.entities.get(ctx.heroId);
    if (!me || me.dead || livingEnemies(ctx.state, ctx.heroId).length === 0) return [];

    const deadline = ctx.deadlineMs - cfg.safetyMs;
    const timeUp = () => Date.now() >= deadline;

    const focusId = findFocusTarget(ctx.state, team, ctx.heroId);
    const focusE = focusId ? ctx.state.entities.get(focusId) : null;
    const initEnemies: EnemySnap[] = [];
    const initAllies: EnemySnap[] = [];
    for (const e of ctx.state.entities.values()) {
      if (e.teamId !== team) initEnemies.push({ id: e.id, hp: e.dead ? 0 : effectiveHp(e), maxHp: e.maxHp });
      else if (e.id !== ctx.heroId) initAllies.push({ id: e.id, hp: e.dead ? 0 : effectiveHp(e), maxHp: e.maxHp });
    }
    const ec: EvalCtx = {
      heroId: ctx.heroId, team, cfg, focusId,
      focusBaseHp: focusE ? focusE.hp + focusE.barrier : 0,
      initEnemies, initAllies,
    };
    const beamEvalFn = cfg.rolloutBeam
      ? (s: GameState) => rolloutEval(s, ec)
      : (s: GameState) => staticEval(s, ec);

    // Phase 1: beam search
    let beam: TurnCandidate[] = [{ plan: [], state: ctx.state }];
    const finals: TurnCandidate[] = [];
    const scoreCache = new Map<GameState, number>();
    const cachedEval = (s: GameState): number => {
      let v = scoreCache.get(s);
      if (v === undefined) { v = beamEvalFn(s); scoreCache.set(s, v); }
      return v;
    };

    for (let step = 0; step < cfg.maxSteps && !timeUp(); step++) {
      const next: TurnCandidate[] = [];
      let anyExpanded = false;
      for (const node of beam) {
        if (node.state.winner) { finals.push(node); continue; }
        finals.push(node);
        const hero = node.state.entities.get(ctx.heroId);
        if (!hero || hero.dead) continue;

        const cands = heroCandidates(node.state, hero, cfg);
        for (let ci = 0; ci < cands.length; ci++) {
          if (timeUp()) break;
          const after = tryAction(node.state, cands[ci]!);
          if (!after) continue;
          anyExpanded = true;
          const child: TurnCandidate = { plan: [...node.plan, cands[ci]!], state: after };
          cachedEval(after);
          next.push(child);
        }
      }
      if (!anyExpanded) break;
      next.sort((a, b) => cachedEval(b.state) - cachedEval(a.state));
      beam = next.slice(0, cfg.beamWidth);
    }
    for (const node of beam) finals.push(node);

    // Dedup
    const seen = new Set<string>();
    const unique: TurnCandidate[] = [];
    for (const f of finals) {
      const key = f.plan.map(sig).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(f);
    }
    unique.sort((a, b) => cachedEval(b.state) - cachedEval(a.state));

    const pass: TurnCandidate = { plan: [], state: ctx.state };
    const candidates = [pass, ...unique.filter(f => f.plan.length > 0)].slice(0, cfg.finalists);

    // Phase 2: rollout each finalist (skip if rolloutBeam already did rollouts)
    let best: TurnCandidate = pass;
    let bestVal = -Infinity;
    for (const c of candidates) {
      if (timeUp()) break;
      let v: number;
      if (c.state.winner === team) {
        v = 1e6;
      } else if (cfg.rolloutBeam || cfg.lightPve) {
        v = cachedEval(c.state);
      } else if (cfg.pveMode) {
        v = pveRollout(c.state, ec);
      } else {
        v = adversarialRollout(c.state, ec, timeUp);
      }
      if (v > bestVal) { bestVal = v; best = c; }
    }
    return best.plan;
  };
}

export const vanguardHero: HeroController = makeVanguard(BASE_CONFIG);

// =============================================================================
// Solo controller — inspects random abilities
// =============================================================================

export function makeSoloVanguard(abilities: AbilityDefinition[]): HeroController {
  const attacks = abilities.filter((a): a is AttackAbility => a.kind === "attack");
  const hasRanged = attacks.some(a => attackRange(a) >= 150);
  const bestRangedDmg = attacks.filter(a =>
    a.shape.kind === ShapeKind.Point || (a.shape.kind === ShapeKind.Circle && a.shape.range > 100)
  ).reduce((m, a) => Math.max(m, a.damage), 0);
  const bestMeleeDmg = attacks.filter(a =>
    a.shape.kind !== ShapeKind.Point && !(a.shape.kind === ShapeKind.Circle && a.shape.range > 100)
  ).reduce((m, a) => Math.max(m, a.damage), 0);
  const rangedLeaning = hasRanged && (bestMeleeDmg === 0 || bestRangedDmg >= bestMeleeDmg - 6);

  if (rangedLeaning) {
    return makeVanguard({
      ...PVE_SOLO_CONFIG,
      wHeroThreat: 1.4,
      wHeroOffense: 1.1,
      wKiteBonus: 0.5,
      wDrift: -0.1,
    });
  }
  return makeVanguard(PVE_SOLO_CONFIG);
}

// =============================================================================
// Focus target selection
// =============================================================================

function findFocusTarget(s: GameState, myTeam: TeamId, myHeroId: EntityId): EntityId | null {
  let heavy: Entity | null = null;
  let wounded: Entity | null = null;
  for (const e of s.entities.values()) {
    if (e.teamId === myTeam || e.id === myHeroId || e.dead) continue;
    if (e.maxHp >= 120) {
      if (!heavy || e.maxHp > heavy.maxHp) heavy = e;
    } else if ((e.hp + e.barrier) < e.maxHp * 0.7) {
      const hp = e.hp + e.barrier;
      const w = wounded ? wounded.hp + wounded.barrier : Infinity;
      if (hp < w) wounded = e;
    }
  }
  return (heavy ?? wounded)?.id ?? null;
}

// =============================================================================
// Candidate generation
// =============================================================================

function heroCandidates(state: GameState, hero: Entity, cfg: VanguardConfig): PlayerAction[] {
  const enemies = livingEnemies(state, hero.id);
  if (enemies.length === 0) return [];
  const attacks: PlayerAction[] = [];
  const moves: PlayerAction[] = [];
  const barriers: PlayerAction[] = [];
  const near = nearest(hero.position, enemies)!;
  const cluster = enemies.length > 1 ? centroid(enemies) : near.position;
  const enemyHero = enemies.find(isHeroLike) ?? null;

  // Barriers
  for (const a of hero.abilities) {
    if (a.kind === "barrier" && canAffordAbility(hero, a))
      barriers.push({ type: "ability", entityId: hero.id, abilityId: a.id });
  }

  const atks = attackAbilities(hero).filter(a => canAffordAbility(hero, a));

  // Aim points
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
    const range = attackRange(atk);
    const points = atk.knockback > 0 ? [...aimPoints, ...slamPts] : aimPoints;

    // For ranged circle attacks, offset aim points
    if (range >= 150 && atk.shape.kind === ShapeKind.Circle) {
      for (const e of enemies.slice(0, 5)) {
        const dir = normalize(sub(e.position, hero.position));
        points.push(add(e.position, scale(dir, 20)));
        points.push(add(e.position, scale(dir, -20)));
      }
    }

    const seenAim = new Set<string>();
    for (const tp of points) {
      const aim = sub(tp, hero.position);
      if (!aim.x && !aim.y) continue;
      const k = `${atk.id}:${Math.round(Math.atan2(aim.y, aim.x) * 64)}`;
      if (seenAim.has(k)) continue;
      seenAim.add(k);
      if (attackHits(state, hero, atk, aim).length > 0)
        attacks.push({ type: "ability", entityId: hero.id, abilityId: atk.id, aimDirection: aim });
    }
  }

  // Movement
  const mv = moveAbility(hero);
  if (mv && canAffordAbility(hero, mv)) {
    const allAtks = attackAbilities(hero);
    const range = allAtks.reduce((r, a) => Math.max(r, attackRange(a)), 0);
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

    // Kite rings
    if (away.x || away.y) {
      if (range > 1) {
        for (const f of [0.7, 0.85, 0.95, 1.1]) {
          targets.push(add(near.position, scale(away, range * f)));
        }
      }
      targets.push(add(hero.position, scale(away, mv.distance)));
    }

    // Radial samples
    for (let k = 0; k < cfg.moveSamples; k++) {
      const ang = (k / cfg.moveSamples) * Math.PI * 2;
      targets.push(add(hero.position, { x: Math.cos(ang) * mv.distance, y: Math.sin(ang) * mv.distance }));
    }

    const seenDest = new Set<string>();
    for (const target of targets) {
      const dest = pathToward(state, hero.id, target);
      if (!dest) continue;
      const k = `${Math.round(dest.x / 8)},${Math.round(dest.y / 8)}`;
      if (seenDest.has(k)) continue;
      seenDest.add(k);
      moves.push({ type: "ability", entityId: hero.id, abilityId: mv.id, destination: dest });
    }
  }
  if (cfg.maxCandidates > 0) {
    const cap = cfg.maxCandidates;
    const atkCap = Math.max(4, cap - barriers.length - Math.min(moves.length, 6));
    const mvCap = cap - barriers.length - Math.min(attacks.length, atkCap);
    return [...barriers, ...attacks.slice(0, atkCap), ...moves.slice(0, Math.max(4, mvCap))];
  }
  return [...barriers, ...attacks, ...moves];
}

function slamAimPoints(state: GameState, hero: Entity, enemies: Entity[]): Vec2[] {
  const out: Vec2[] = [];
  const g = state.grid;
  const mapW = g.width * g.cellSize, mapH = g.height * g.cellSize;
  const sorted = [...enemies]
    .sort((a, b) => dist(hero.position, a.position) - dist(hero.position, b.position))
    .slice(0, 4);
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
// PvE rollout — simulate allies + scripted enemy turn
// =============================================================================

function pveRollout(state: GameState, ec: EvalCtx): number {
  return rolloutEval(state, ec);
}

function rolloutEval(state: GameState, ec: EvalCtx): number {
  // Pre-rollout distance to nearest enemy (reward closing distance)
  const heroPre = state.entities.get(ec.heroId);
  let preDistNearest = 0;
  if (heroPre && !heroPre.dead) {
    preDistNearest = Infinity;
    for (const e of state.entities.values())
      if (!e.dead && e.teamId !== ec.team) preDistNearest = Math.min(preDistNearest, dist(e.position, heroPre.position));
    if (!Number.isFinite(preDistNearest)) preDistNearest = 0;
  }

  const afterAllies = simulateMyAlliesTurn(state, ec.heroId);
  const afterEnd = resolveAction(afterAllies, { type: "endTurn" });
  const foeTeam: TeamId = ec.team === "red" ? "blue" : "red";
  if (afterEnd.winner === ec.team) return 1e6;
  if (afterEnd.winner === foeTeam) return -1e6;
  const afterEnemy = simulateScriptedTurn(afterEnd);
  if (afterEnemy.winner === ec.team) return 1e6;
  if (afterEnemy.winner === foeTeam) return -1e6;

  const hero = afterEnemy.entities.get(ec.heroId);
  if (!hero || hero.dead) return -1e5;

  // Kills and damage dealt
  let kills = 0, damageFrac = 0;
  for (const snap of ec.initEnemies) {
    const cur = afterEnemy.entities.get(snap.id);
    const curHp = !cur || cur.dead ? 0 : effectiveHp(cur);
    if (snap.hp > 0 && curHp === 0) kills++;
    if (snap.maxHp > 0) damageFrac += Math.max(0, (snap.hp - curHp) / snap.maxHp);
  }

  // Ally survival
  let allyHpFrac = 0;
  for (const snap of ec.initAllies) {
    const cur = afterEnemy.entities.get(snap.id);
    const curHp = !cur || cur.dead ? 0 : effectiveHp(cur);
    if (snap.maxHp > 0) allyHpFrac += curHp / snap.maxHp;
  }

  const heroFrac = (hero.hp + hero.barrier) / hero.maxHp;
  const lowHp = Math.max(0, 0.4 - heroFrac);

  // Focus target bonus
  let focusBonus = 0;
  if (ec.focusId && ec.cfg.wFocusTarget > 0) {
    const f = afterEnemy.entities.get(ec.focusId);
    if (!f || f.dead) focusBonus = 1.5;
    else focusBonus = Math.max(0, ec.focusBaseHp - (f.hp + f.barrier)) / 100;
  }

  return (
    kills * 3.0 +
    damageFrac * 1.5 +
    heroFrac * ec.cfg.wHeroHp +
    allyHpFrac * ec.cfg.wAllyHp +
    focusBonus * ec.cfg.wFocusTarget +
    (hero.barrier > 0 ? 0.15 : 0) -
    lowHp * ec.cfg.wHeroDead -
    preDistNearest * 0.003
  );
}

// =============================================================================
// Adversarial rollout
// =============================================================================

function adversarialRollout(state: GameState, ec: EvalCtx, timeUp: () => boolean): number {
  const afterAllies = simulateMyAlliesTurn(state, ec.heroId);
  const afterEnd = resolveAction(afterAllies, { type: "endTurn" });
  if (afterEnd.winner) return staticEval(afterEnd, ec);

  let worst = Infinity;

  // Reply 1: scripted
  const scriptedVal = staticEval(simulateScriptedTurn(afterEnd), ec);
  worst = scriptedVal;

  // Reply 2: enemy hero hunts us
  if (!timeUp()) {
    const enemyTeam = afterEnd.activeTeam;
    const enemyHero = [...afterEnd.entities.values()].find(
      e => !e.dead && e.teamId === enemyTeam && isHeroLike(e),
    );
    if (enemyHero) {
      worst = Math.min(worst, staticEval(
        applyEnemyHeroTurn(afterEnd, enemyHero.id, huntPlan(afterEnd, enemyHero.id, ec.heroId)),
        ec,
      ));

      // Reply 3: enemy hero hunts our weakest ally
      if (!timeUp()) {
        const myAllies = [...afterEnd.entities.values()]
          .filter(e => !e.dead && e.teamId === ec.team && e.id !== ec.heroId);
        if (myAllies.length > 0) {
          const weak = myAllies.reduce((a, b) =>
            (a.hp + a.barrier) / a.maxHp <= (b.hp + b.barrier) / b.maxHp ? a : b);
          worst = Math.min(worst, staticEval(
            applyEnemyHeroTurn(afterEnd, enemyHero.id, huntPlan(afterEnd, enemyHero.id, weak.id)),
            ec,
          ));
        }
      }
    }
  }

  return ec.cfg.adversarialBlend * worst + (1 - ec.cfg.adversarialBlend) * scriptedVal;
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
  for (let step = 0; step < 6; step++) {
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

function staticEval(s: GameState, ec: EvalCtx): number {
  const { heroId, team, cfg } = ec;
  const foeTeam: TeamId = team === "red" ? "blue" : "red";

  // Start with basicScore as foundation
  let v = basicScore(s, team);

  const hero = s.entities.get(heroId);
  if (!hero || hero.dead) {
    v -= cfg.wHeroDead;
  } else {
    v += cfg.wHeroHp * (hero.hp + hero.barrier) / hero.maxHp;

    const enemies = livingEnemies(s, heroId);

    // Threat: incoming damage reachable next turn
    let incoming = 0;
    for (const e of enemies) {
      const reach = mReach(e) + aReach(e);
      const d = dist(e.position, hero.position) - hero.collisionRadius - e.collisionRadius;
      if (d <= reach) {
        incoming += bDmg(e);
      }
    }
    v -= cfg.wHeroThreat * (incoming / hero.maxHp);
    if (cfg.wLethalZone > 0) {
      const overkill = incoming - (hero.hp + hero.barrier);
      if (overkill > 0) v -= cfg.wLethalZone * cfg.wHeroDead * Math.min(1, overkill / hero.maxHp);
    }

    if (enemies.length > 0) {
      // Offense: can we threaten someone?
      const myReach = mReach(hero) + aReach(hero);
      let threatenable = false;
      for (const e of enemies) {
        const d = dist(e.position, hero.position) - hero.collisionRadius - e.collisionRadius;
        if (d <= myReach) { threatenable = true; break; }
      }
      if (threatenable) v += cfg.wHeroOffense * (bDmg(hero) / hero.maxHp);

      // Drift: distance to nearest enemy
      let nd = Infinity;
      for (const e of enemies) nd = Math.min(nd, dist(e.position, hero.position));
      v -= cfg.wDrift * (nd / 1000);

      // Kite bonus for ranged heroes
      if (cfg.wKiteBonus > 0 && Number.isFinite(nd)) {
        const optRange = aReach(hero) * 0.8;
        if (nd >= optRange * 0.5) {
          v += cfg.wKiteBonus * Math.min(1, nd / optRange);
        }
      }

      // Cohesion with allies
      const mates = [...s.entities.values()]
        .filter(e => e.teamId === team && !e.dead && e.id !== heroId);
      if (mates.length > 0) v -= cfg.wCohesion * (dist(hero.position, centroid(mates)) / 1000);

      // Cluster bonus
      if (enemies.length > 1) {
        const c = centroid(enemies);
        let within = 0;
        for (const e of enemies) if (dist(e.position, c) <= 90) within++;
        v += cfg.wCluster * (within / enemies.length);
      }
    }
  }

  // Focus-fire: sqrt HP scoring
  let foeSqrtHp = 0, foeTot = 0;
  for (const e of s.entities.values()) {
    if (e.teamId === foeTeam) {
      foeTot++;
      if (!e.dead) foeSqrtHp += Math.sqrt(effectiveHp(e) / e.maxHp);
    }
  }
  v -= cfg.wFocusFire * (foeTot > 0 ? foeSqrtHp / foeTot : 0);

  // Focus target bonus
  if (ec.focusId && cfg.wFocusTarget > 0) {
    const f = s.entities.get(ec.focusId);
    if (!f || f.dead) {
      v += cfg.wFocusTarget * 1.5;
    } else {
      v += cfg.wFocusTarget * Math.max(0, ec.focusBaseHp - (f.hp + f.barrier)) / 100;
    }
  }

  // Ally HP
  const allies = [...s.entities.values()].filter(e => e.teamId === team && e.id !== heroId);
  if (allies.length > 0) {
    let hp = 0, max = 0;
    for (const e of allies) { max += e.maxHp; hp += e.dead ? 0 : e.hp + e.barrier; }
    if (max > 0) v += cfg.wAllyHp * (hp / max);
  }

  return v;
}

// =============================================================================
// Helpers
// =============================================================================

function isHeroLike(e: Entity): boolean {
  return e.maxHp >= 120;
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
function totalBurstDmg(e: Entity): number {
  const atks = e.abilities.filter(a => a.kind === "attack") as AttackAbility[];
  if (atks.length === 0) return 0;
  const budget = e.energy.regenRed;
  atks.sort((a, b) => b.damage - a.damage);
  let total = 0, spent = 0;
  for (const a of atks) {
    const cost = a.cost?.red ?? 0;
    if (cost === 0) continue;
    if (spent + cost <= budget) { total += a.damage; spent += cost; }
  }
  return total;
}
function sig(a: PlayerAction): string {
  if (a.type !== "ability") return a.type;
  const aim = a.aimDirection ? `@${Math.round(Math.atan2(a.aimDirection.y, a.aimDirection.x) * 32)}` : "";
  const dst = a.destination ? `>${Math.round(a.destination.x / 8)},${Math.round(a.destination.y / 8)}` : "";
  return `${a.abilityId}${aim}${dst}`;
}
