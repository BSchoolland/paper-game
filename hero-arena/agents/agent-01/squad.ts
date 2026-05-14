/**
 * Role-specialized squad controllers built on top of the solo beam search.
 *
 *   tank:     extra weight on own survival + barrier upkeep + always-be-blocking
 *   fighter:  base solo profile — bursty single-target / cluster damage
 *   ranged:   weight kiting distance, prefer big single-target ranged hits
 *
 * Each role is just a wrapper that hands the search a tweaked eval profile.
 */
import type { HeroContext, HeroController } from "../../src/types.js";
import type { Entity, EntityId, GameState, TeamId } from "../../../shared/src/index.js";
import { canAffordAbility } from "../../../shared/src/index.js";
import {
  tryAction, resolveAction, teamOf, livingEnemies, nearest, dist,
  attackAbilities, attackRange, effectiveHp, simulateMyAlliesTurn, simulateScriptedTurn,
  attackHits, pathToward,
} from "../../src/toolkit.js";
import { referenceHero } from "../../src/reference-bot.js";

// Weights tuned per role; default mirrors solo's leaf eval.
export interface EvalProfile {
  killWeight: number;
  damageWeight: number;
  heroHpWeight: number;
  lowHpPenaltySlope: number;   // applied when heroFrac < 0.4
  closeDistanceWeight: number; // -per-px (pre-reply distance to nearest foe)
  allyHpWeight: number;        // how much we care about ally survival
  barrierUpkeepBonus: number;  // small bias toward keeping any barrier up
}

const TANK_PROFILE: EvalProfile = {
  killWeight: 2.5,
  damageWeight: 1.2,
  heroHpWeight: 2.0,        // tank's job: stay alive
  lowHpPenaltySlope: 8.0,
  closeDistanceWeight: 0.004, // tanks lead the line
  allyHpWeight: 0.8,
  barrierUpkeepBonus: 0.4,
};

const FIGHTER_PROFILE: EvalProfile = {
  killWeight: 3.0,
  damageWeight: 1.5,
  heroHpWeight: 1.0,
  lowHpPenaltySlope: 5.0,
  closeDistanceWeight: 0.003,
  allyHpWeight: 0.5,
  barrierUpkeepBonus: 0.15,
};

const RANGED_PROFILE: EvalProfile = {
  killWeight: 3.0,
  damageWeight: 1.7,
  heroHpWeight: 1.3,
  lowHpPenaltySlope: 6.5,
  closeDistanceWeight: -0.0015, // PREFER to stay back (penalty for being close)
  allyHpWeight: 0.4,
  barrierUpkeepBonus: 0.1,
};

// 300HP boss — much less need for caution; lean into AoE clears.
const BOSS_PROFILE: EvalProfile = {
  killWeight: 3.5,
  damageWeight: 1.6,
  heroHpWeight: 0.4,       // we have 300hp, hp swings matter less
  lowHpPenaltySlope: 3.0,
  closeDistanceWeight: 0.005,
  allyHpWeight: 0.3,
  barrierUpkeepBonus: 0.1,
};

// Mirror-duel skirmish profile. When the enemy team is composed of heroes (no scripted ladder
// enemies), the PvE-defensive profiles get aggressed off the map. Skirmish mode goes hard on
// enemy-hero suppression and largely ignores ally-keep / barrier-upkeep biases.
const SKIRMISH_PROFILE: EvalProfile = {
  killWeight: 5.0,             // killing a hero is decisive — they don't respawn and they hit hard
  damageWeight: 2.5,           // damage on heroes is far more valuable than on goblins
  heroHpWeight: 0.7,           // care about your own HP, but trade for damage
  lowHpPenaltySlope: 3.0,
  closeDistanceWeight: 0.002,  // mild close-in (engage, don't bunker)
  allyHpWeight: 0.6,
  barrierUpkeepBonus: 0.0,     // no free "be defensive" bonus
};

/** Detect whether the enemy team is entirely smart heroes (skirmish) or has scripted ladder
 *  enemies (PvE squad / raid). Cached per-call. */
function isSkirmishMode(state: GameState, myTeam: TeamId): boolean {
  for (const e of state.entities.values()) {
    if (e.teamId === myTeam || e.dead) continue;
    const cls = e.name;
    if (cls !== "tank" && cls !== "fighter" && cls !== "ranged" && cls !== "boss" && cls !== "solo") return false;
  }
  return true;
}

interface EnemySnap { id: EntityId; hp: number; maxHp: number; }
interface AllySnap  { id: EntityId; hp: number; maxHp: number; }

interface Node {
  state: GameState;
  actions: { type: "ability"; entityId: EntityId; abilityId: string; aimDirection?: { x: number; y: number }; destination?: { x: number; y: number } }[];
  cachedScore?: number;
}

const MAX_DEPTH = 4;
const BEAM_WIDTH = 4;
const PER_NODE_CANDIDATE_CAP = 22;
const SAFETY_MARGIN_MS = 350;

function planWithProfile(ctx: HeroContext, profile: EvalProfile) {
  const heroId = ctx.heroId;
  const team = teamOf(ctx.state, heroId);
  const deadline = ctx.deadlineMs - SAFETY_MARGIN_MS;

  // Adaptive profile: detect whether the enemies are smart heroes (skirmish / boss-vs-raid) or
  // scripted ladder enemies. The PvE-defensive profile loses 28/30 in skirmish; the aggressive
  // SKIRMISH_PROFILE at least picks up a couple of wins. ReferenceHero was even worse (0/30) —
  // it has no team coordination at all.
  const isTank = profile === TANK_PROFILE, isRanged = profile === RANGED_PROFILE, isFighter = profile === FIGHTER_PROFILE;
  const isBoss = profile === BOSS_PROFILE;
  if ((isTank || isRanged || isFighter) && isSkirmishMode(ctx.state, team)) {
    profile = {
      ...SKIRMISH_PROFILE,
      heroHpWeight: isTank ? 1.0 : (isRanged ? 0.85 : SKIRMISH_PROFILE.heroHpWeight),
      barrierUpkeepBonus: isTank ? 0.15 : 0,
      closeDistanceWeight: isRanged ? -0.001 : SKIRMISH_PROFILE.closeDistanceWeight,
    };
  } else if (isBoss && isSkirmishMode(ctx.state, team)) {
    // Boss vs raid team — go hard. 300HP and a big AoE kit; trade HP for cleave damage.
    profile = {
      ...SKIRMISH_PROFILE,
      killWeight: 6.0,
      damageWeight: 2.8,
      heroHpWeight: 0.35,
      lowHpPenaltySlope: 2.0,
      closeDistanceWeight: 0.006,
      barrierUpkeepBonus: 0.1,
    };
  }

  const initialEnemies = snapshotEnemies(ctx.state, team);
  const initialAllies  = snapshotAllies(ctx.state, team, heroId);

  const evalNode = (n: Node): number => {
    if (n.cachedScore !== undefined) return n.cachedScore;
    n.cachedScore = leaf(n.state, heroId, team, profile, initialEnemies, initialAllies);
    return n.cachedScore;
  };

  let beam: Node[] = [{ state: ctx.state, actions: [] }];
  let bestNode: Node = beam[0]!;
  let bestScore = evalNode(bestNode);

  outer: for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (Date.now() > deadline) break;
    const next: Node[] = [];
    let expanded = false;
    for (const node of beam) {
      const hero = node.state.entities.get(heroId);
      if (!hero || hero.dead || node.state.winner) continue;
      const cands = candidatesForHero(node.state, hero).slice(0, PER_NODE_CANDIDATE_CAP);
      for (const a of cands) {
        if (Date.now() > deadline) break outer;
        const after = tryAction(node.state, a);
        if (!after) continue;
        expanded = true;
        const child: Node = { state: after, actions: [...node.actions, a] };
        const s = evalNode(child);
        if (s > bestScore) { bestScore = s; bestNode = child; }
        next.push(child);
      }
    }
    if (!expanded) break;
    next.sort((a, b) => evalNode(b) - evalNode(a));
    beam = next.slice(0, BEAM_WIDTH);
  }
  return bestNode.actions;
}

function snapshotEnemies(s: GameState, myTeam: TeamId): EnemySnap[] {
  const out: EnemySnap[] = [];
  for (const e of s.entities.values())
    if (e.teamId !== myTeam) out.push({ id: e.id, hp: e.dead ? 0 : effectiveHp(e), maxHp: e.maxHp });
  return out;
}
function snapshotAllies(s: GameState, myTeam: TeamId, exclude: EntityId): AllySnap[] {
  const out: AllySnap[] = [];
  for (const e of s.entities.values())
    if (e.teamId === myTeam && e.id !== exclude) out.push({ id: e.id, hp: e.dead ? 0 : effectiveHp(e), maxHp: e.maxHp });
  return out;
}

function leaf(
  state: GameState,
  heroId: EntityId,
  team: TeamId,
  prof: EvalProfile,
  initEn: EnemySnap[],
  initAl: AllySnap[],
): number {
  const foe: TeamId = team === "red" ? "blue" : "red";

  // Pre-reply hero position info (used for closeDistance).
  const myHeroPre = state.entities.get(heroId);
  let preDistToNearest = Infinity;
  if (myHeroPre && !myHeroPre.dead) {
    for (const e of state.entities.values())
      if (!e.dead && e.teamId !== team) preDistToNearest = Math.min(preDistToNearest, dist(e.position, myHeroPre.position));
  }
  if (!Number.isFinite(preDistToNearest)) preDistToNearest = 0;

  let afterReply: GameState = state;
  if (!afterReply.winner) {
    // Squad teammates may have already acted, but their later-in-turn teammates haven't.
    // We simulate "my remaining allies finish their turn as if scripted" + endTurn + enemy turn.
    afterReply = simulateMyAlliesTurn(afterReply, heroId);
    afterReply = resolveAction(afterReply, { type: "endTurn" });
    if (!afterReply.winner) afterReply = simulateScriptedTurn(afterReply);
  }

  if (afterReply.winner === team) return 1e6;
  if (afterReply.winner === foe)  return -1e6;

  const hero = afterReply.entities.get(heroId);
  if (!hero || hero.dead) return -1e5;

  let kills = 0, damageFrac = 0, killValue = 0;
  for (const snap of initEn) {
    const cur = afterReply.entities.get(snap.id);
    const curHp = !cur || cur.dead ? 0 : effectiveHp(cur);
    if (snap.hp > 0 && curHp === 0) {
      kills++;
      // Bigger enemies are worth more to kill — the 300hp boss takes 10x effort but is also 10x
      // the threat. Use sqrt to dampen so we don't completely ignore minions.
      killValue += Math.sqrt(snap.maxHp / 120);
    }
    if (snap.maxHp > 0) damageFrac += Math.max(0, (snap.hp - curHp) / snap.maxHp);
  }

  let allyKept = 0, allyHpFrac = 0;
  for (const snap of initAl) {
    const cur = afterReply.entities.get(snap.id);
    const curHp = !cur || cur.dead ? 0 : effectiveHp(cur);
    if (snap.maxHp > 0) {
      allyHpFrac += curHp / snap.maxHp;
      if (curHp > 0) allyKept++;
    }
  }

  const heroFrac = (hero.hp + hero.barrier) / hero.maxHp;
  const lowHp = Math.max(0, 0.4 - heroFrac);
  const barrierBonus = hero.barrier > 0 ? prof.barrierUpkeepBonus : 0;

  return (
    killValue * prof.killWeight +
    damageFrac * prof.damageWeight +
    heroFrac * prof.heroHpWeight +
    allyHpFrac * prof.allyHpWeight +
    (initAl.length > 0 ? (allyKept / initAl.length) * 0.4 : 0) +
    barrierBonus +
    -lowHp * prof.lowHpPenaltySlope -
    preDistToNearest * prof.closeDistanceWeight
  );
}

// ── Candidate generation — same as solo's but importable here too ────────────

function candidatesForHero(state: GameState, hero: Entity) {
  // Re-import solo's generator indirectly by using the soloHero plan? Too heavy. We re-implement
  // candidate generation here using the toolkit primitives.
  // (Kept in lockstep with solo.ts by reusing the helpers.)
  const out: { type: "ability"; entityId: EntityId; abilityId: string; aimDirection?: { x:number;y:number }; destination?: { x:number;y:number } }[] = [];
  const enemies = livingEnemies(state, hero.id);
  if (enemies.length === 0) return out;
  const cluster = centroidOf(enemies);
  const near = nearest(hero.position, enemies)!;
  const atks = attackAbilities(hero).filter(a => canAffordAbility(hero, a));

  // Barriers
  for (const a of hero.abilities)
    if (a.kind === "barrier" && canAffordAbility(hero, a))
      out.push({ type: "ability", entityId: hero.id, abilityId: a.id });

  const aimTargets: { x:number; y:number }[] = enemies.map(e => e.position);
  if (enemies.length > 1) {
    aimTargets.push(cluster);
    const sorted = [...enemies].sort((a, b) => dist(hero.position, a.position) - dist(hero.position, b.position)).slice(0, 4);
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i]!.position, b = sorted[j]!.position;
        aimTargets.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
  }

  // Attack aims
  for (const atk of atks) {
    const seen = new Set<string>();
    for (const tp of aimTargets) {
      const aim = { x: tp.x - hero.position.x, y: tp.y - hero.position.y };
      if (!aim.x && !aim.y) continue;
      const hits = attackHits(state, hero, atk, aim);
      if (hits.length === 0) continue;
      const ang = Math.round(Math.atan2(aim.y, aim.x) * 100) / 100;
      const k = `${atk.id}@${ang}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ type: "ability", entityId: hero.id, abilityId: atk.id, aimDirection: aim });
    }
  }

  // Moves
  const mv = hero.abilities.find(a => a.kind === "move");
  if (mv && canAffordAbility(hero, mv)) {
    const moveTargets: { x:number; y:number }[] = [...enemies.map(e => e.position), cluster];
    const dx = hero.position.x - near.position.x, dy = hero.position.y - near.position.y;
    const dl = Math.hypot(dx, dy) || 1;
    const awayUnit = { x: dx / dl, y: dy / dl };
    const range = atks.reduce((r, a) => Math.max(r, attackRange(a)), 0);
    if (range > 1) moveTargets.push({ x: near.position.x + awayUnit.x * range * 0.85, y: near.position.y + awayUnit.y * range * 0.85 });
    moveTargets.push({ x: hero.position.x + awayUnit.x * (mv as any).distance, y: hero.position.y + awayUnit.y * (mv as any).distance });
    const tdx = cluster.x - hero.position.x, tdy = cluster.y - hero.position.y;
    const tdl = Math.hypot(tdx, tdy) || 1;
    moveTargets.push({ x: hero.position.x + (tdx / tdl) * 60, y: hero.position.y + (tdy / tdl) * 60 });

    const seen = new Set<string>();
    for (const target of moveTargets) {
      const dest = pathToward(state, hero.id, target);
      if (!dest) continue;
      const k = `${Math.round(dest.x / 10)},${Math.round(dest.y / 10)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ type: "ability", entityId: hero.id, abilityId: mv.id, destination: dest });
    }
  }
  return out;
}

function centroidOf(es: Entity[]) {
  let x = 0, y = 0;
  for (const e of es) { x += e.position.x; y += e.position.y; }
  return { x: x / es.length, y: y / es.length };
}

// ── Controllers ──────────────────────────────────────────────────────────────

export const tankHero: HeroController    = (ctx) => planWithProfile(ctx, TANK_PROFILE);
export const fighterHero: HeroController = (ctx) => planWithProfile(ctx, FIGHTER_PROFILE);
export const rangedHero: HeroController  = (ctx) => planWithProfile(ctx, RANGED_PROFILE);
export const bossHero: HeroController    = (ctx) => planWithProfile(ctx, BOSS_PROFILE);
