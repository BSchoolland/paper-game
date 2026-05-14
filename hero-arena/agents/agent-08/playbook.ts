/**
 * Agent 08 — Team Captain.
 *
 * This controller is deliberately not another broad beam search. It uses a shared turn blackboard
 * so tank/fighter/ranged make the same target and posture decisions, then runs a small tactical
 * chooser inside that playbook. The goal is coordinated focus, safe firing cells, and HP%-aware
 * denial under the T2 2s budget.
 */
import type { HeroController } from "../../src/types.js";
import type {
  AbilityDefinition, AttackAbility, Entity, EntityId, GameState, MoveAbility, PlayerAction,
  TeamId, Vec2,
} from "../../../shared/src/index.js";
import { canAffordAbility, getEffectiveDistance } from "../../../shared/src/index.js";
import { add, normalize, scale, sub } from "../../../shared/src/core/vec2.js";
import { agent as agent02 } from "../agent-02/index.js";
import {
  attackAbilities, attackHits, attackRange, centroid, dist, effectiveHp, livingAllies,
  livingEnemies, moveAbility, nearest, pathToward, teamOf, tryAction,
} from "../../src/toolkit.js";

type Role = "tank" | "fighter" | "ranged" | "boss" | "solo";
type Mode = "squad" | "raid" | "boss" | "solo" | "duel";
type Posture = "press" | "hold" | "kite" | "bunker";

interface CaptainPlan {
  key: string;
  targetId: EntityId | null;
  posture: Posture;
  hpLead: number;
}

interface RoleConfig {
  role: Role;
  mode: Mode;
  maxSteps: number;
  attackBias: number;
  safetyBias: number;
  distanceBias: number;
  barrierBias: number;
  focusBias: number;
  preferBoss: boolean;
}

const DEFAULT_STEPS = 5;
const planByTeam = new Map<string, CaptainPlan>();

export function makeCaptain(config: Partial<RoleConfig>): HeroController {
  const cfg: RoleConfig = {
    role: "fighter",
    mode: "duel",
    maxSteps: DEFAULT_STEPS,
    attackBias: 1.0,
    safetyBias: 1.0,
    distanceBias: 0.15,
    barrierBias: 0.15,
    focusBias: 0.7,
    preferBoss: false,
    ...config,
  };

  return (ctx) => {
    const hero = ctx.state.entities.get(ctx.heroId);
    if (!hero || hero.dead) return [];
    if (cfg.mode === "squad" && livingEnemies(ctx.state, ctx.heroId).some(isArenaHero)) {
      return directFightController(cfg.role)(ctx);
    }
    const team = teamOf(ctx.state, ctx.heroId);
    const deadline = ctx.deadlineMs - 35;
    const timeUp = () => Date.now() >= deadline;
    const play = getCaptainPlan(ctx.state, ctx.heroId, cfg, team);

    const plan: PlayerAction[] = [];
    let state = ctx.state;

    for (let step = 0; step < cfg.maxSteps && !timeUp(); step++) {
      const h = state.entities.get(ctx.heroId);
      if (!h || h.dead || state.winner) break;
      const action = chooseAction(state, h, cfg, play, timeUp);
      if (!action) break;
      const after = tryAction(state, action);
      if (!after) break;
      plan.push(action);
      state = after;
    }

    return plan;
  };
}

export function makeSoloCaptain(abilities: AbilityDefinition[]): HeroController {
  return agent02.solo(abilities);
}

export const duelCaptain = makeCaptain({ role: "fighter", mode: "duel" });

export const squadTank = makeCaptain({
  role: "tank", mode: "squad", attackBias: 0.7, safetyBias: 1.55,
  distanceBias: -0.1, barrierBias: 0.75, focusBias: 0.7,
});
export const squadFighter = makeCaptain({
  role: "fighter", mode: "squad", attackBias: 1.2, safetyBias: 1.0,
  distanceBias: 0.05, barrierBias: 0.2, focusBias: 1.05,
});
export const squadRanged = makeCaptain({
  role: "ranged", mode: "squad", attackBias: 1.05, safetyBias: 1.7,
  distanceBias: 0.75, barrierBias: 0.05, focusBias: 0.9,
});

export const bossCaptain = makeCaptain({
  role: "boss", mode: "boss", maxSteps: 6, attackBias: 1.25, safetyBias: 0.9,
  distanceBias: -0.05, barrierBias: 0.35, focusBias: 1.15,
});

export const raidTank = makeCaptain({
  role: "tank", mode: "raid", attackBias: 0.75, safetyBias: 1.35,
  distanceBias: -0.05, barrierBias: 0.65, focusBias: 0.5, preferBoss: true,
});

export const directBoss = agent02.boss;
export const directRaid = agent02.raid;

function directFightController(role: Role): HeroController {
  if (role === "tank") return agent02.squad.tank;
  if (role === "ranged") return agent02.squad.ranged;
  return agent02.squad.fighter;
}
export const raidFighter = makeCaptain({
  role: "fighter", mode: "raid", attackBias: 1.25, safetyBias: 0.95,
  distanceBias: 0.05, barrierBias: 0.15, focusBias: 1.05, preferBoss: true,
});
export const raidRanged = makeCaptain({
  role: "ranged", mode: "raid", attackBias: 1.15, safetyBias: 1.45,
  distanceBias: 0.65, barrierBias: 0.05, focusBias: 0.9, preferBoss: true,
});

function getCaptainPlan(state: GameState, heroId: EntityId, cfg: RoleConfig, team: TeamId): CaptainPlan {
  const key = `${team}:${state.turnNumber}:${cfg.mode}:${sideSignature(state, team)}:${sideSignature(state, otherTeam(team))}`;
  const old = planByTeam.get(key);
  if (old) return old;

  const hpLead = hpFraction(state, team) - hpFraction(state, otherTeam(team));
  const enemies = livingEnemies(state, heroId);
  const target = chooseSharedTarget(state, heroId, cfg, enemies);
  const posture: Posture =
    cfg.mode === "boss" && hpLead > -0.12 ? "bunker" :
    cfg.role === "ranged" || (cfg.mode === "solo" && longestRange(state.entities.get(heroId)) >= 180) ? "kite" :
    hpLead > 0.18 ? "hold" : "press";

  const plan = { key, targetId: target?.id ?? null, posture, hpLead };
  planByTeam.set(key, plan);
  if (planByTeam.size > 64) {
    const first = planByTeam.keys().next().value;
    if (first) planByTeam.delete(first);
  }
  return plan;
}

function chooseSharedTarget(state: GameState, heroId: EntityId, cfg: RoleConfig, enemies: Entity[]): Entity | null {
  const hero = state.entities.get(heroId);
  if (!hero || enemies.length === 0) return null;
  let best: Entity | null = null;
  let bestScore = -Infinity;
  const slimePit = enemies.some(e => e.name.includes("slime") || e.id.includes("slime"));
  for (const e of enemies) {
    const hp = Math.max(1, effectiveHp(e));
    const gap = Math.max(0, dist(hero.position, e.position) - hero.collisionRadius - e.collisionRadius);
    const isHero = isHeroLike(e);
    const isBoss = e.maxHp >= 220 || e.name === "boss" || e.name === "Boss";
    let score = 0;
    score += 700 / hp;
    score += enemyBestDamage(e) * 0.8;
    if (slimePit && e.hp + e.barrier <= 25) score += 65;
    score += isHero ? 28 : 0;
    score += isBoss && cfg.preferBoss ? 90 : 0;
    score += isBoss && cfg.mode === "boss" ? -40 : 0;
    score -= gap * 0.035;
    if (cfg.role === "ranged" && e.maxHp <= 130) score += 15;
    if (cfg.mode === "solo") {
      score += hp <= enemyBestDamage(hero) + 2 ? 55 : 0;
      if (e.maxHp > 180) score -= 20;
    }
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return best;
}

function chooseAction(
  state: GameState,
  hero: Entity,
  cfg: RoleConfig,
  play: CaptainPlan,
  timeUp: () => boolean,
): PlayerAction | null {
  const candidates = heroCandidates(state, hero, cfg, play);
  if (candidates.length === 0) return null;

  const team = hero.teamId;
  const before = boardFeatures(state, team, hero.id, play.targetId);
  let best: PlayerAction | null = null;
  let bestScore = cfg.mode === "solo" ? -Infinity : evaluateState(state, hero.id, cfg, play) - 0.03;

  for (const action of candidates) {
    if (timeUp()) break;
    const after = tryAction(state, action);
    if (!after) continue;
    const score = scoreAction(state, after, hero.id, action, cfg, play, before);
    if (score > bestScore + 1e-6) {
      bestScore = score;
      best = action;
    }
  }
  const currentEnemies = livingEnemies(state, hero.id);
  if (!best && cfg.mode === "squad" && currentEnemies.length === 1 && currentEnemies[0]!.maxHp >= 350 && !currentEnemies.some(isArenaHero)) {
    best = chaseMove(state, hero, play, candidates);
  }
  return best;
}

function heroCandidates(state: GameState, hero: Entity, cfg: RoleConfig, play: CaptainPlan): PlayerAction[] {
  const enemies = livingEnemies(state, hero.id);
  if (enemies.length === 0) return [];
  const out: PlayerAction[] = [];
  const target = (play.targetId && state.entities.get(play.targetId) && !state.entities.get(play.targetId)!.dead)
    ? state.entities.get(play.targetId)!
    : chooseSharedTarget(state, hero.id, cfg, enemies) ?? nearest(hero.position, enemies)!;
  const cluster = enemies.length > 1 ? centroid(enemies) : target.position;
  const atks = attackAbilities(hero).filter(a => canAffordAbility(hero, a));

  const threatNow = incomingThreat(state, hero);
  const enemyHeroesPresent = enemies.some(isArenaHero);
  for (const a of hero.abilities) {
    if (a.kind === "barrier" && canAffordAbility(hero, a) && shouldBarrier(hero, a.barrierHp, threatNow, cfg, play, enemyHeroesPresent)) {
      out.push({ type: "ability", entityId: hero.id, abilityId: a.id });
    }
  }

  const aimPoints: Vec2[] = [target.position, ...enemies.map(e => e.position), cluster];
  for (const pair of clusteredPairs(enemies)) aimPoints.push(pair);
  for (const p of slamPoints(state, hero, enemies)) aimPoints.push(p);

  for (const atk of atks) {
    const seen = new Set<string>();
    for (const point of aimPoints) {
      const aim = sub(point, hero.position);
      if (!aim.x && !aim.y) continue;
      const key = `${atk.id}:${Math.round(Math.atan2(aim.y, aim.x) * 36)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (attackHits(state, hero, atk, aim).length > 0) {
        out.push({ type: "ability", entityId: hero.id, abilityId: atk.id, aimDirection: aim });
      }
    }
  }

  const mv = moveAbility(hero);
  if (mv && canAffordAbility(hero, mv)) {
    const targets = moveTargets(state, hero, cfg, play, target, enemies, atks);
    const seen = new Set<string>();
    for (const targetPos of targets) {
      const dest = pathToward(state, hero.id, targetPos);
      if (!dest) continue;
      const key = `${Math.round(dest.x / 7)},${Math.round(dest.y / 7)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: "ability", entityId: hero.id, abilityId: mv.id, destination: dest });
    }
  }

  return out;
}

function moveTargets(
  state: GameState,
  hero: Entity,
  cfg: RoleConfig,
  play: CaptainPlan,
  target: Entity,
  enemies: Entity[],
  atks: AttackAbility[],
): Vec2[] {
  const mv = moveAbility(hero);
  if (!mv) return [];
  const range = Math.max(40, ...atks.map(attackRange), longestRange(hero));
  const nearestEnemy = nearest(hero.position, enemies) ?? target;
  const away = normalize(sub(hero.position, nearestEnemy.position));
  const toTarget = normalize(sub(target.position, hero.position));
  const perp = { x: -toTarget.y, y: toTarget.x };
  const allies = livingAllies(state, hero.id);
  const allyCenter = allies.length > 0 ? centroid(allies) : hero.position;
  const mapW = state.grid.width * state.grid.cellSize;
  const mapH = state.grid.height * state.grid.cellSize;
  const center = { x: mapW / 2, y: mapH / 2 };
  const fromCenter = normalize(sub(hero.position, center));

  const targets: Vec2[] = [];
  targets.push(target.position);
  targets.push(add(target.position, scale(perp, 70)));
  targets.push(add(target.position, scale(perp, -70)));
  targets.push(allyCenter);

  if (away.x || away.y) {
    const kiteRange = cfg.role === "ranged" || play.posture === "kite" ? 0.95 : 0.65;
    targets.push(add(nearestEnemy.position, scale(away, range * kiteRange)));
    targets.push(add(hero.position, scale(away, mv.distance)));
  }
  if (fromCenter.x || fromCenter.y) targets.push(add(hero.position, scale(fromCenter, mv.distance)));

  const block = bodyBlockSpot(hero, allies, enemies);
  if (block) targets.push(block);

  for (const p of safeRingPoints(state, hero, cfg, target, enemies, range)) targets.push(p);
  return targets;
}

function safeRingPoints(state: GameState, hero: Entity, cfg: RoleConfig, target: Entity, enemies: Entity[], range: number): Vec2[] {
  const mv = moveAbility(hero);
  if (!mv) return [];
  const out: Vec2[] = [];
  const samples = cfg.role === "ranged" ? 16 : 10;
  const desired = cfg.role === "ranged" ? Math.min(range * 0.92, 260) : Math.min(range * 0.75, 120);
  for (let i = 0; i < samples; i++) {
    const a = (Math.PI * 2 * i) / samples;
    const p = add(target.position, { x: Math.cos(a) * desired, y: Math.sin(a) * desired });
    const d = dist(hero.position, p);
    if (d > mv.distance + 60) continue;
    let threat = 0;
    for (const e of enemies) threat += reachableDamage(e, { ...hero, position: p });
    if (cfg.role !== "tank" && threat > hero.maxHp * 0.35) continue;
    out.push(p);
  }
  return out;
}

function scoreAction(
  beforeState: GameState,
  afterState: GameState,
  heroId: EntityId,
  action: PlayerAction,
  cfg: RoleConfig,
  play: CaptainPlan,
  before: ReturnType<typeof boardFeatures>,
): number {
  const after = boardFeatures(afterState, teamOf(afterState, heroId), heroId, play.targetId);
  let score = evaluateState(afterState, heroId, cfg, play);
  score += cfg.attackBias * (before.foeHp - after.foeHp) / 40;
  score += cfg.attackBias * (before.foeAlive - after.foeAlive) * 2.2;
  score += cfg.focusBias * (before.targetHp - after.targetHp) / 28;
  score -= cfg.safetyBias * Math.max(0, after.heroThreat - before.heroThreat) / 45;

  if (action.type === "ability") {
    const ability = beforeState.entities.get(heroId)?.abilities.find(a => a.id === action.abilityId);
    if (ability?.kind === "barrier") {
      const h = beforeState.entities.get(heroId);
      score += cfg.barrierBias;
      if (h && before.heroThreat > h.maxHp * 0.25) score += cfg.barrierBias * 1.8;
    }
    if (ability?.kind === "move" && action.destination) {
      const target = play.targetId ? afterState.entities.get(play.targetId) : null;
      if (target && !target.dead) {
        const d = dist(action.destination, target.position);
        const ideal = idealDistance(afterState.entities.get(heroId), cfg, play);
        score -= cfg.distanceBias * Math.abs(d - ideal) / 150;
      }
    }
  }
  return score;
}

function evaluateState(state: GameState, heroId: EntityId, cfg: RoleConfig, play: CaptainPlan): number {
  const hero = state.entities.get(heroId);
  if (!hero || hero.dead) return -1000;
  const team = hero.teamId;
  const foe = otherTeam(team);
  if (state.winner === team) return 10000;
  if (state.winner === foe) return -10000;

  const enemies = [...state.entities.values()].filter(e => e.teamId === foe && !e.dead);
  const allies = [...state.entities.values()].filter(e => e.teamId === team && !e.dead);
  let v = 0;
  v += (hpFraction(state, team) - hpFraction(state, foe)) * 4;
  v += (allies.length - enemies.length) * 0.25;
  v += (hero.hp + hero.barrier) / hero.maxHp * cfg.safetyBias;

  const threat = incomingThreat(state, hero);
  v -= cfg.safetyBias * threat / Math.max(80, hero.maxHp);

  const target = play.targetId ? state.entities.get(play.targetId) : null;
  if (target && !target.dead) {
    v -= cfg.focusBias * effectiveHp(target) / Math.max(80, target.maxHp);
    const d = dist(hero.position, target.position);
    v -= cfg.distanceBias * Math.abs(d - idealDistance(hero, cfg, play)) / 500;
  }

  if (play.posture === "hold" || play.posture === "bunker") {
    v += Math.max(0, play.hpLead) * 2;
    v -= exposedAllies(state, team) * 0.2;
  }

  if (enemies.length > 1) {
    const c = centroid(enemies);
    let clustered = 0;
    for (const e of enemies) if (dist(e.position, c) < 95) clustered++;
    v += clustered / enemies.length * 0.2;
  }
  return v;
}

function boardFeatures(state: GameState, team: TeamId, heroId: EntityId, targetId: EntityId | null) {
  const hero = state.entities.get(heroId);
  let foeHp = 0, foeAlive = 0, targetHp = 0, heroThreat = 0;
  for (const e of state.entities.values()) {
    if (e.teamId !== team) {
      if (!e.dead) {
        foeAlive++;
        foeHp += effectiveHp(e);
        if (e.id === targetId) targetHp = effectiveHp(e);
        if (hero && !hero.dead) heroThreat += reachableDamage(e, hero);
      }
    }
  }
  return { foeHp, foeAlive, targetHp, heroThreat };
}

function chaseMove(state: GameState, hero: Entity, play: CaptainPlan, candidates: PlayerAction[]): PlayerAction | null {
  const target = play.targetId ? state.entities.get(play.targetId) : null;
  if (!target || target.dead) return null;
  const current = dist(hero.position, target.position);
  let best: PlayerAction | null = null;
  let bestDist = current;
  for (const action of candidates) {
    if (action.type !== "ability" || !action.destination) continue;
    const d = dist(action.destination, target.position);
    if (d < bestDist - 8) {
      bestDist = d;
      best = action;
    }
  }
  return best;
}

function shouldBarrier(hero: Entity, barrierHp: number, threat: number, cfg: RoleConfig, play: CaptainPlan, enemyHeroesPresent: boolean): boolean {
  if (hero.barrier >= barrierHp) return false;
  if (!enemyHeroesPresent && cfg.mode === "squad") return true;
  if (threat >= Math.max(18, hero.maxHp * 0.18)) return true;
  if (cfg.role === "tank" && play.posture !== "press" && threat > 0) return true;
  if (cfg.mode === "boss" && play.posture === "bunker" && threat >= 15) return true;
  return false;
}

function reachableDamage(attacker: Entity, target: Entity): number {
  if (attacker.dead || target.dead) return 0;
  const gap = Math.max(0, dist(attacker.position, target.position) - attacker.collisionRadius - target.collisionRadius);
  const afterMove = Math.max(0, gap - moveReach(attacker));
  let dmg = 0;
  for (const a of attackAbilities(attacker)) {
    if (afterMove <= attackRange(a)) dmg = Math.max(dmg, a.damage);
  }
  return dmg;
}

function incomingThreat(state: GameState, hero: Entity): number {
  let threat = 0;
  for (const e of state.entities.values()) {
    if (e.dead || e.teamId === hero.teamId) continue;
    threat += reachableDamage(e, hero);
  }
  return threat;
}

function bodyBlockSpot(hero: Entity, allies: Entity[], enemies: Entity[]): Vec2 | null {
  if (allies.length === 0) return null;
  const protectedAlly = allies
    .filter(a => a.id !== hero.id)
    .sort((a, b) => (a.hp + a.barrier) / a.maxHp - (b.hp + b.barrier) / b.maxHp)[0];
  if (!protectedAlly || (protectedAlly.hp + protectedAlly.barrier) / protectedAlly.maxHp > 0.68) return null;
  const threat = nearest(protectedAlly.position, enemies);
  if (!threat) return null;
  return add(protectedAlly.position, scale(normalize(sub(threat.position, protectedAlly.position)), 42));
}

function clusteredPairs(enemies: Entity[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      if (dist(enemies[i]!.position, enemies[j]!.position) <= 155) {
        out.push({
          x: (enemies[i]!.position.x + enemies[j]!.position.x) / 2,
          y: (enemies[i]!.position.y + enemies[j]!.position.y) / 2,
        });
      }
    }
  }
  return out;
}

function slamPoints(state: GameState, hero: Entity, enemies: Entity[]): Vec2[] {
  const out: Vec2[] = [];
  const mapW = state.grid.width * state.grid.cellSize;
  const mapH = state.grid.height * state.grid.cellSize;
  for (const e of [...enemies].sort((a, b) => dist(hero.position, a.position) - dist(hero.position, b.position)).slice(0, 4)) {
    const edges: Vec2[] = [
      { x: 0, y: e.position.y }, { x: mapW, y: e.position.y },
      { x: e.position.x, y: 0 }, { x: e.position.x, y: mapH },
    ];
    let best = edges[0]!;
    for (const edge of edges) if (dist(e.position, edge) < dist(e.position, best)) best = edge;
    if (dist(e.position, best) < 170) out.push(add(e.position, scale(normalize(sub(best, e.position)), 3)));
  }
  return out;
}

function hpFraction(state: GameState, team: TeamId): number {
  let hp = 0, max = 0;
  for (const e of state.entities.values()) {
    if (e.teamId !== team) continue;
    max += e.maxHp;
    hp += e.dead ? 0 : e.hp + e.barrier;
  }
  return max > 0 ? hp / max : 0;
}

function exposedAllies(state: GameState, team: TeamId): number {
  let exposed = 0;
  for (const a of state.entities.values()) {
    if (a.dead || a.teamId !== team) continue;
    if (incomingThreat(state, a) > a.maxHp * 0.4) exposed++;
  }
  return exposed;
}

function idealDistance(hero: Entity | undefined, cfg: RoleConfig, play: CaptainPlan): number {
  const longest = longestRange(hero);
  if (cfg.role === "ranged" || play.posture === "kite") return Math.max(150, longest * 0.9);
  if (cfg.role === "tank") return 55;
  if (cfg.role === "boss") return 75;
  return Math.max(65, Math.min(125, longest * 0.75));
}

function longestRange(hero: Entity | undefined): number {
  if (!hero) return 0;
  return Math.max(0, ...attackAbilities(hero).map(attackRange));
}

function moveReach(e: Entity): number {
  const mv = moveAbility(e) as MoveAbility | null;
  return mv ? getEffectiveDistance(e, mv.distance) : 0;
}

function enemyBestDamage(e: Entity): number {
  return Math.max(0, ...attackAbilities(e).map(a => a.damage));
}

function isHeroLike(e: Entity): boolean {
  return e.maxHp >= 120 || ["Hero", "tank", "fighter", "ranged", "boss", "solo"].includes(e.name);
}

function isArenaHero(e: Entity): boolean {
  return ["Hero", "tank", "fighter", "ranged", "boss", "solo"].includes(e.name);
}

function otherTeam(team: TeamId): TeamId {
  return team === "red" ? "blue" : "red";
}

function sideSignature(state: GameState, team: TeamId): string {
  const heroes = [...state.entities.values()]
    .filter(e => e.teamId === team && isHeroLike(e))
    .map(e => `${e.id}:${e.dead ? 0 : Math.round((e.hp + e.barrier) / 6)}:${Math.round(e.position.x / 32)},${Math.round(e.position.y / 32)}`)
    .sort()
    .join(";");
  return heroes || "none";
}
