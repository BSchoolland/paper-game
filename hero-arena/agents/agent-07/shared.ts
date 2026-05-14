/**
 * Shared building blocks for agent-07: candidate generation, team-aware evaluation,
 * and a fast greedy "teammate simulator" used to project the rest of the squad's turn
 * inside our own hero's lookahead.
 */
import type {
  AttackAbility, Entity, EntityId, GameState, PlayerAction, TeamId, Vec2,
} from "../../../shared/src/index.js";
import { canAffordAbility } from "../../../shared/src/index.js";
import { add, normalize, scale, sub } from "../../../shared/src/core/vec2.js";
import { strategyForEntity } from "../../../shared/src/ai/strategy.js";
import {
  tryAction, resolveAction, teamOf, livingEnemies, livingAllies, nearest, centroid, dist,
  attackAbilities, attackRange, moveAbility, attackHits, pathToward, effectiveHp,
  simulateScriptedTurn,
} from "../../src/toolkit.js";

const KITE_RING = 0.8;
const HERO_ROLES = new Set(["tank", "fighter", "ranged", "solo", "boss"]);

// ── identifying heroes ──────────────────────────────────────────────────────
// Entity.name is set by makeEntity to the role string ("tank", "boss", etc.)
// for heroes, or the enemy template key for scripted units. So name-based
// detection is reliable; we also accept "Boss"/"hero" capitalisation as a fallback.

export function isHero(e: Entity): boolean {
  const n = e.name.toLowerCase();
  if (HERO_ROLES.has(n)) return true;
  return e.maxHp >= 120 && e.abilities.some(a => a.kind === "attack");
}

export function squadmates(s: GameState, myHeroId: EntityId): Entity[] {
  return livingAllies(s, myHeroId).filter(isHero);
}

export function enemyHeroes(s: GameState, of: EntityId): Entity[] {
  return livingEnemies(s, of).filter(isHero);
}

// ── candidate action generation for a single hero ───────────────────────────

export function heroCandidates(state: GameState, hero: Entity): PlayerAction[] {
  const enemies = livingEnemies(state, hero.id);
  if (enemies.length === 0) return [];
  const out: PlayerAction[] = [];
  const near = nearest(hero.position, enemies)!;
  const cluster = enemies.length > 1 ? centroid(enemies) : near.position;
  const atks: AttackAbility[] = attackAbilities(hero).filter(a => canAffordAbility(hero, a));

  // Non-aimed (barrier) abilities
  for (const a of hero.abilities) {
    if (a.kind === "barrier" && canAffordAbility(hero, a)) {
      out.push({ type: "ability", entityId: hero.id, abilityId: a.id });
    }
  }

  // Attack aimed at each enemy / cluster — keep only those that actually connect
  const aimTargets: Vec2[] = enemies.map(e => e.position);
  if (enemies.length > 1) aimTargets.push(cluster);
  for (const atk of atks) {
    for (const targetPos of aimTargets) {
      const aim = sub(targetPos, hero.position);
      if (!aim.x && !aim.y) continue;
      if (attackHits(state, hero, atk, aim).length > 0) {
        out.push({ type: "ability", entityId: hero.id, abilityId: atk.id, aimDirection: aim });
      }
    }
  }

  // Knockback-aim variants: aim attacks past targets toward walls for slam damage.
  // For each kb-capable attack and each enemy near a wall, aim further along the
  // hero→enemy direction so the kb vector points at the wall.
  for (const atk of atks) {
    if (!atk.knockback || atk.knockback < 30) continue;
    for (const foe of enemies) {
      const wallDir = wallDirectionNear(state, foe.position, 80);
      if (!wallDir) continue;
      // Aim along wallDir from hero (so kb vector matches wallDir).
      const aim = { x: wallDir.x * 200, y: wallDir.y * 200 };
      if (attackHits(state, hero, atk, aim).length > 0) {
        out.push({ type: "ability", entityId: hero.id, abilityId: atk.id, aimDirection: aim });
      }
    }
  }

  // Moves: toward each foe, cluster, a kite ring, retreat
  const mv = moveAbility(hero);
  if (mv && canAffordAbility(hero, mv)) {
    const range = atks.reduce((r, a) => Math.max(r, attackRange(a)), 0);
    const moveTargets: Vec2[] = [...enemies.map(e => e.position), cluster];
    const away = normalize(sub(hero.position, near.position));
    if (away.x || away.y) {
      if (range > 1) moveTargets.push(add(near.position, scale(away, range * KITE_RING)));
      moveTargets.push(add(hero.position, scale(away, mv.distance)));
    }
    // Toward each squadmate (regroup option)
    for (const ally of livingAllies(state, hero.id)) {
      moveTargets.push(ally.position);
    }
    const seen = new Set<string>();
    for (const target of moveTargets) {
      const dest = pathToward(state, hero.id, target);
      if (!dest) continue;
      const k = `${Math.round(dest.x / 8)},${Math.round(dest.y / 8)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ type: "ability", entityId: hero.id, abilityId: mv.id, destination: dest });
    }
  }
  return out;
}

function wallDirectionNear(state: GameState, pos: Vec2, probe: number): Vec2 | null {
  const w = state.grid.width * state.grid.cellSize;
  const h = state.grid.height * state.grid.cellSize;
  // Closest map edge
  const dL = pos.x, dR = w - pos.x, dT = pos.y, dB = h - pos.y;
  const minE = Math.min(dL, dR, dT, dB);
  if (minE > probe) return null;
  if (minE === dL) return { x: -1, y: 0 };
  if (minE === dR) return { x: 1, y: 0 };
  if (minE === dT) return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

// ── teammate projection: fast greedy plan for one teammate ──────────────────

/** Unused at the moment — kept for the option of re-enabling explicit teammate
 *  projection in future. Currently the leaf eval is cheap (no projection) and
 *  coordination flows via shared focus target + team-aware weights. */
export function fastTeammatePlan(state: GameState, allyId: EntityId): PlayerAction[] {
  const ally = state.entities.get(allyId);
  if (!ally || ally.dead) return [];
  const plan: PlayerAction[] = [];
  let s = state;
  for (let step = 0; step < 2; step++) {
    const me = s.entities.get(allyId);
    if (!me || me.dead) break;
    const enemies = livingEnemies(s, allyId);
    if (enemies.length === 0) break;
    // Thin candidates: only attacks that connect + a single best-cluster move
    const cands = thinCandidatesForTeammate(s, me);
    let best: PlayerAction | null = null;
    let bestV = quickAllyScore(s, allyId);
    for (const a of cands) {
      const after = tryAction(s, a);
      if (!after) continue;
      const v = quickAllyScore(after, allyId);
      if (v > bestV + 1e-9) { bestV = v; best = a; }
    }
    if (!best) break;
    plan.push(best);
    s = tryAction(s, best)!;
    if (s.winner) break;
  }
  return plan;
}

function thinCandidatesForTeammate(s: GameState, hero: Entity): PlayerAction[] {
  const enemies = livingEnemies(s, hero.id);
  if (enemies.length === 0) return [];
  const out: PlayerAction[] = [];
  const sortedFoes = [...enemies].sort((a, b) =>
    (effectiveHp(a) / Math.max(1, a.maxHp)) - (effectiveHp(b) / Math.max(1, b.maxHp))
  ).slice(0, 3);
  const atks: AttackAbility[] = attackAbilities(hero).filter(a => canAffordAbility(hero, a));
  for (const atk of atks) {
    for (const foe of sortedFoes) {
      const aim = sub(foe.position, hero.position);
      if (!aim.x && !aim.y) continue;
      if (attackHits(s, hero, atk, aim).length > 0) {
        out.push({ type: "ability", entityId: hero.id, abilityId: atk.id, aimDirection: aim });
        break; // one good aim per ability is enough
      }
    }
  }
  // Single move toward weakest foe
  const mv = moveAbility(hero);
  if (mv && canAffordAbility(hero, mv) && sortedFoes[0]) {
    const dest = pathToward(s, hero.id, sortedFoes[0].position);
    if (dest) out.push({ type: "ability", entityId: hero.id, abilityId: mv.id, destination: dest });
  }
  return out;
}

function quickAllyScore(s: GameState, heroId: EntityId): number {
  const h = s.entities.get(heroId);
  if (!h) return -100;
  const team = h.teamId;
  let v = 0;
  if (!h.dead) v += 1.5 * (h.hp + h.barrier) / h.maxHp;
  for (const e of s.entities.values()) {
    if (e.dead) continue;
    const hp = effectiveHp(e);
    if (e.teamId === team) v += 0.1 * (hp / e.maxHp);
    else v -= 0.6 * Math.sqrt(hp / Math.max(1, e.maxHp));
  }
  return v;
}

/** Apply fastTeammatePlan for each living squadmate (excluding self) in their action
 *  order (closest-to-enemy first matches engine), threading state. */
export function projectTeammatesTurn(state: GameState, myHeroId: EntityId): GameState {
  const me = state.entities.get(myHeroId);
  if (!me) return state;
  const myTeam = me.teamId;
  const mates = [...state.entities.values()]
    .filter(e => e.teamId === myTeam && !e.dead && e.id !== myHeroId && isHero(e))
    .sort((a, b) => closestEnemyDist(a, state) - closestEnemyDist(b, state));
  let s = state;
  for (const m of mates) {
    if (s.entities.get(m.id)?.dead) continue;
    for (const action of fastTeammatePlan(s, m.id)) {
      const next = tryAction(s, action);
      if (next) s = next;
      if (s.winner) return s;
    }
  }
  return s;
}

function closestEnemyDist(e: Entity, s: GameState): number {
  let best = Infinity;
  for (const o of s.entities.values()) {
    if (o.dead || o.teamId === e.teamId) continue;
    best = Math.min(best, dist(e.position, o.position));
  }
  return best;
}

// ── team-aware leaf evaluation ──────────────────────────────────────────────

export interface EvalWeights {
  heroHp: number;
  heroDeadPenalty: number;
  enemyHp: number;            // we subtract sqrt-scaled enemy HP — concave → focus fire
  enemyHero: number;          // extra weight on enemy heroes/bosses
  enemyAliveCount: number;
  ourAliveCount: number;
  drift: number;              // pull our heroes toward enemy cluster
  cohesion: number;           // small penalty for heroes drifting apart
  enemyCluster: number;       // bonus when foes are bunched — AoE/cleave candy
  winBonus: number;
}

export const DEFAULT_WEIGHTS: EvalWeights = {
  heroHp: 1.0,
  heroDeadPenalty: 2.5,
  enemyHp: 1.2,
  enemyHero: 0.8,
  enemyAliveCount: 0.4,
  ourAliveCount: 0.6,
  drift: 0.6,
  cohesion: 0.15,
  enemyCluster: 0.0,   // off by default — opt in per-role; bumping it regressed squad
  winBonus: 50,
};

export function teamScore(s: GameState, team: TeamId, w: EvalWeights = DEFAULT_WEIGHTS): number {
  if (s.winner === team) return w.winBonus;
  if (s.winner && s.winner !== team) return -w.winBonus;

  let v = 0;
  const myHeroes: Entity[] = [];
  const myAll: Entity[] = [];
  const foeAll: Entity[] = [];
  for (const e of s.entities.values()) {
    if (e.teamId === team) {
      myAll.push(e);
      if (isHero(e)) myHeroes.push(e);
    } else {
      foeAll.push(e);
    }
  }

  // Our heroes — irreplaceable. Strong dead-penalty + HP weight.
  for (const h of myHeroes) {
    if (h.dead) v -= w.heroDeadPenalty;
    else v += w.heroHp * (h.hp + h.barrier) / h.maxHp;
  }

  // Enemy HP — concave (sqrt) per-unit, scaled by hero-ness.
  let foeAlive = 0;
  for (const e of foeAll) {
    if (e.dead) continue;
    foeAlive++;
    const hp = effectiveHp(e);
    const frac = Math.max(0, Math.min(1, hp / Math.max(1, e.maxHp)));
    const wgt = isHero(e) ? (w.enemyHp + w.enemyHero) : w.enemyHp;
    v -= wgt * Math.sqrt(frac);
  }
  v -= w.enemyAliveCount * foeAlive;

  // Our alive count
  const myAlive = myAll.filter(e => !e.dead).length;
  v += w.ourAliveCount * myAlive;

  // Drift: pull our heroes toward enemy cluster (so they actually engage)
  const livingFoes = foeAll.filter(e => !e.dead);
  if (livingFoes.length > 0 && myHeroes.length > 0) {
    const fc = centroid(livingFoes);
    let totalDist = 0, n = 0;
    for (const h of myHeroes) {
      if (h.dead) continue;
      totalDist += dist(h.position, fc);
      n++;
    }
    if (n > 0) v -= w.drift * (totalDist / n) / 1000;
  }

  // Cohesion: penalize squad-spread
  const aliveHeroes = myHeroes.filter(e => !e.dead);
  if (aliveHeroes.length > 1) {
    const hc = centroid(aliveHeroes);
    let spread = 0;
    for (const h of aliveHeroes) spread += dist(h.position, hc);
    v -= w.cohesion * (spread / aliveHeroes.length) / 500;
  }

  // Enemy clustering: reward foes bunched within an AoE radius — AoE/cleave candy.
  if (livingFoes.length > 1) {
    const fc = centroid(livingFoes);
    let inCluster = 0;
    for (const e of livingFoes) if (dist(e.position, fc) < 90) inCluster++;
    v += w.enemyCluster * (inCluster / livingFoes.length);
  }

  return v;
}

// ── round eval ──────────────────────────────────────────────────────────────
// We do NOT project teammates inside the leaf eval — it was eating the time budget
// and giving us shallower plans than reference-bot × 3. Coordination comes instead
// from (a) team-aware per-role weights and (b) a shared focus-target the controllers
// read from module state. Each hero's eval is cheap: state-after-my-action → end turn
// → enemy scripted reply → score.

export interface FocusHint { targetId: EntityId | null; bonus: number }

export function evalRoundForHero(
  state: GameState,
  heroId: EntityId,
  team: TeamId,
  w: EvalWeights = DEFAULT_WEIGHTS,
  focus: FocusHint | null = null,
): number {
  if (state.winner) return teamScore(state, team, w) + focusContribution(state, focus);
  const afterEnd = resolveAction(state, { type: "endTurn" });
  if (afterEnd.winner) return teamScore(afterEnd, team, w) + focusContribution(afterEnd, focus);
  const afterEnemy = simulateScriptedTurn(afterEnd);
  let score = teamScore(afterEnemy, team, w) + focusContribution(afterEnemy, focus);
  score += shotOpportunityBonus(state, heroId);
  return score;
}

/** Adversarial rollout: simulate multiple plausible enemy replies and take the MIN
 *  (worst-case-for-us). The scripted reply is the cheap baseline; we also run a
 *  greedy "hunt-my-weakest-hero" reply for the enemy's most threatening unit. This
 *  is what stops the planner from walking into a competent opponent's punish. */
export function adversarialEval(
  state: GameState,
  heroId: EntityId,
  team: TeamId,
  w: EvalWeights,
  focus: FocusHint | null,
): number {
  if (state.winner) return teamScore(state, team, w) + focusContribution(state, focus);
  const afterEnd = resolveAction(state, { type: "endTurn" });
  if (afterEnd.winner) return teamScore(afterEnd, team, w) + focusContribution(afterEnd, focus);

  // Reply 1: pure scripted (the cheap baseline).
  const scripted = simulateScriptedTurn(afterEnd);
  const scriptedScore = teamScore(scripted, team, w) + focusContribution(scripted, focus);

  // Reply 2: enemy's strongest threat greedy-hunts our weakest hero, then their
  // other units play scripted. Only worth running if there's a hero-class enemy
  // (PvP/raid); for PvE this collapses to the scripted reply.
  const huntScore = huntReplyScore(afterEnd, heroId, team, w, focus);

  const baseShot = shotOpportunityBonus(state, heroId);
  const worst = Math.min(scriptedScore, huntScore);
  return worst + baseShot;
}

function huntReplyScore(
  state: GameState,
  myHeroId: EntityId,
  team: TeamId,
  w: EvalWeights,
  focus: FocusHint | null,
): number {
  // state is on the enemy's turn already (after our endTurn).
  const enemyTeam = state.activeTeam;
  if (enemyTeam === team) return teamScore(state, team, w); // shouldn't happen
  // Pick the strongest enemy hero (most damage potential = biggest threat).
  let attacker: Entity | null = null;
  let attackerScore = -Infinity;
  for (const e of state.entities.values()) {
    if (e.dead || e.teamId !== enemyTeam || !isHero(e)) continue;
    let dmg = 0;
    for (const a of e.abilities) if (a.kind === "attack") dmg = Math.max(dmg, a.damage);
    if (dmg > attackerScore) { attackerScore = dmg; attacker = e; }
  }
  if (!attacker) return teamScore(simulateScriptedTurn(state), team, w);
  // Pick our weakest hero as victim.
  let victim: Entity | null = null;
  let victimHp = Infinity;
  for (const e of state.entities.values()) {
    if (e.dead || e.teamId !== team || !isHero(e)) continue;
    const hp = effectiveHp(e);
    if (hp < victimHp) { victimHp = hp; victim = e; }
  }
  if (!victim) return teamScore(simulateScriptedTurn(state), team, w);

  // Greedy-hunt the victim with the attacker, threading state. Then everyone else
  // on enemy team plays scripted.
  let s = greedyHunt(state, attacker.id, victim.id, 6);
  // Run the rest of the enemy team scripted (mirrors AI ordering — closest-first).
  const restEnemies = [...s.entities.values()]
    .filter(e => !e.dead && e.teamId === enemyTeam && e.id !== attacker!.id)
    .sort((a, b) => closestEnemyDist(a, s) - closestEnemyDist(b, s));
  for (const u of restEnemies) {
    const live = s.entities.get(u.id);
    if (!live || live.dead) continue;
    for (const action of strategyForEntity(live).planActions(live, s)) {
      s = resolveAction(s, action);
      if (s.winner) return teamScore(s, team, w) + focusContribution(s, focus);
    }
  }
  s = resolveAction(s, { type: "endTurn" });
  return teamScore(s, team, w) + focusContribution(s, focus);
}

function greedyHunt(state: GameState, attackerId: EntityId, victimId: EntityId, maxSteps: number): GameState {
  let s = state;
  for (let i = 0; i < maxSteps; i++) {
    const a = s.entities.get(attackerId);
    const v = s.entities.get(victimId);
    if (!a || a.dead || !v || v.dead) break;
    // Try every affordable attack aimed at the victim.
    const atks = attackAbilities(a).filter(x => canAffordAbility(a, x)).sort((x, y) => y.damage - x.damage);
    let acted = false;
    for (const atk of atks) {
      const aim = sub(v.position, a.position);
      if (!aim.x && !aim.y) continue;
      if (attackHits(s, a, atk, aim).some(h => h.id === victimId)) {
        const after = tryAction(s, { type: "ability", entityId: attackerId, abilityId: atk.id, aimDirection: aim });
        if (after) { s = after; acted = true; break; }
      }
    }
    if (acted) continue;
    // Else move toward victim.
    const mv = moveAbility(a);
    if (mv && canAffordAbility(a, mv)) {
      const dest = pathToward(s, attackerId, v.position);
      if (dest) {
        const after = tryAction(s, { type: "ability", entityId: attackerId, abilityId: mv.id, destination: dest });
        if (after && after !== s) { s = after; continue; }
      }
    }
    break;
  }
  return s;
}


function shotOpportunityBonus(s: GameState, heroId: EntityId): number {
  const h = s.entities.get(heroId);
  if (!h || h.dead) return 0;
  const atks = attackAbilities(h).filter(a => canAffordAbility(h, a));
  if (atks.length === 0) return 0;
  let bestRange = 0;
  for (const a of atks) bestRange = Math.max(bestRange, attackRange(a));
  if (bestRange <= 0) return 0;
  let nearest = Infinity;
  for (const e of s.entities.values()) {
    if (e.dead || e.teamId === h.teamId) continue;
    const d = dist(h.position, e.position);
    if (d < nearest) nearest = d;
  }
  if (!Number.isFinite(nearest)) return 0;
  if (nearest <= bestRange) return 0.15;
  const slack = Math.max(0, 1 - (nearest - bestRange) / bestRange);
  return 0.15 * slack;
}

function focusContribution(s: GameState, focus: FocusHint | null): number {
  if (!focus || !focus.targetId) return 0;
  const t = s.entities.get(focus.targetId);
  if (!t || t.dead) return focus.bonus; // dead focus target = full bonus
  const dmgFrac = 1 - Math.max(0, effectiveHp(t) / Math.max(1, t.maxHp));
  return focus.bonus * dmgFrac;
}

// ── per-hero beam search turn builder ───────────────────────────────────────
// Two-phase: (1) beam search over whole-turn plans using cheap static eval (no
// enemy scripted turn) for pruning — much faster than the rollout eval, so we can
// explore more breadth. (2) Take the top-K finalists and re-rank with the full
// rollout eval (which simulates the enemy reply). Pick the best.

export interface PlanResult { plan: PlayerAction[]; finalState: GameState }

interface BeamNode { state: GameState; plan: PlayerAction[]; staticScore: number }

const DEFAULT_BEAM_WIDTH = 6;
const DEFAULT_FINALISTS = 10;

function staticEvalForHero(
  state: GameState,
  team: TeamId,
  heroId: EntityId,
  w: EvalWeights,
  focus: FocusHint | null,
): number {
  // No simulateScriptedTurn — just score the current board. Cheap.
  let v = teamScore(state, team, w);
  v += focusContribution(state, focus);
  v += shotOpportunityBonus(state, heroId);
  return v;
}

export interface BuildOpts {
  maxSteps?: number;
  weights?: EvalWeights;
  focus?: FocusHint | null;
  beamWidth?: number;
  finalists?: number;
  /** When true, every candidate is evaluated by the full rollout eval (simulateScriptedTurn).
   *  Slower but much safer when enemy reactions dominate the match outcome (solo PvE,
   *  fragile heroes). False (default) uses static eval for beam pruning, rollout only
   *  on finalists — faster and works well for squad/raid where team-aware weights carry. */
  useRolloutDuringSearch?: boolean;
}

export function buildHeroTurn(
  state: GameState,
  heroId: EntityId,
  deadlineMs: number,
  maxSteps = 5,
  w: EvalWeights = DEFAULT_WEIGHTS,
  focus: FocusHint | null = null,
  beamWidth = DEFAULT_BEAM_WIDTH,
  finalists = DEFAULT_FINALISTS,
  useRolloutDuringSearch = false,
  useAdversarialFinal = false,
): PlanResult {
  const team = teamOf(state, heroId);
  const safety = 120;
  const timeUp = () => Date.now() > deadlineMs - safety;

  // Phase 1: beam search over partial plans. Pruned by cheap static eval by default,
  // or by the full rollout eval if useRolloutDuringSearch is set (slower but more
  // accurate when enemy reaction dominates — solo PvE).
  const scoreNode = (s: GameState): number =>
    useRolloutDuringSearch
      ? evalRoundForHero(s, heroId, team, w, focus)
      : staticEvalForHero(s, team, heroId, w, focus);

  const passNode: BeamNode = { state, plan: [], staticScore: scoreNode(state) };
  let beam: BeamNode[] = [passNode];
  const allFinals: BeamNode[] = [passNode];

  outer: for (let step = 0; step < maxSteps; step++) {
    const next: BeamNode[] = [];
    let anyExpanded = false;
    for (const node of beam) {
      if (node.state.winner) continue;
      const h = node.state.entities.get(heroId);
      if (!h || h.dead) continue;
      const cands = heroCandidates(node.state, h);
      for (const a of cands) {
        if (timeUp()) break outer;
        const after = tryAction(node.state, a);
        if (!after) continue;
        anyExpanded = true;
        const child: BeamNode = {
          state: after,
          plan: [...node.plan, a],
          staticScore: scoreNode(after),
        };
        next.push(child);
      }
    }
    if (!anyExpanded) break;
    // Dedup by action signature
    const seen = new Set<string>();
    const deduped: BeamNode[] = [];
    for (const n of next) {
      const key = n.plan.map(planSig).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(n);
    }
    deduped.sort((a, b) => b.staticScore - a.staticScore);
    beam = deduped.slice(0, beamWidth);
    allFinals.push(...beam);
    if (beam.length === 0) break;
  }

  // Phase 2: full rollout eval on the top-K (by static score) unique finalists.
  const seen = new Set<string>();
  const uniqueFinals: BeamNode[] = [];
  for (const n of allFinals) {
    const key = n.plan.map(planSig).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueFinals.push(n);
  }
  uniqueFinals.sort((a, b) => b.staticScore - a.staticScore);
  const top = uniqueFinals.slice(0, finalists);

  const finalEval = (s: GameState) =>
    useAdversarialFinal
      ? adversarialEval(s, heroId, team, w, focus)
      : evalRoundForHero(s, heroId, team, w, focus);

  let bestNode = passNode;
  let bestRolloutScore = finalEval(passNode.state);
  for (const n of top) {
    if (timeUp()) break;
    if (n === passNode) continue; // already scored
    const v = n.state.winner === team
      ? 1e7 + n.staticScore
      : finalEval(n.state);
    if (v > bestRolloutScore + 1e-9) {
      bestRolloutScore = v;
      bestNode = n;
    }
  }

  return { plan: bestNode.plan, finalState: bestNode.state };
}

function planSig(a: PlayerAction): string {
  if (a.type === "endTurn") return "endTurn";
  let s = a.abilityId;
  if (a.aimDirection) s += `@a${Math.round(a.aimDirection.x / 16)},${Math.round(a.aimDirection.y / 16)}`;
  if (a.destination) s += `@d${Math.round(a.destination.x / 16)},${Math.round(a.destination.y / 16)}`;
  return s;
}
