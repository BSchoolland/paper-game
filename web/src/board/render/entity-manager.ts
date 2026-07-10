import { Container, Graphics } from "pixi.js";
import type { AimDirection, AttackAbility, CombatShapeDefinition, Entity, GameEvent, GameState, PlayerAction, ShapeFootprint, TrailEffect, Vec2, ZoneEffectKind } from "shared";
import { ShapeKind, computeShapeFootprint, defenseTierFromPower, defenseToMultiplier, normalize, length as vecLength, raycast, resolveAction, STATUS_META, planDisplayRoute, moveRadiusOf, distance } from "shared";
import { EntityVisual } from "./entity-renderer.js";
import { drawRoughArc, drawRoughRect, drawRoughLine, drawXMark, drawRoughCircle } from "./sketch-utils.js";
import { FloatingTextManager } from "./floating-text.js";
import { defenseLabel } from "./impact-labels.js";
import { planAttack, type AttackPlan } from "./attack-performance.js";
import { drawIncomingAttackPreview } from "./targeting-renderer.js";
import { Sequencer } from "./sequencer.js";

const FOOT_OFFSET = 272 * 0.2 * (1 - 0.75);
const DEFAULT_FLASH_COLOR = 0x8b2020;
const FLASH_DURATION = 0.4;
const MOVE_DURATION = 0.625;
const KNOCKBACK_DURATION = 0.36;
/** A locally-predicted swing/defense unclaimed after this long is stale (aborted round). */
const PREDICTION_TTL_MS = 10_000;

const ZONE_TICK_LABEL: Record<ZoneEffectKind, (m: number) => string> = {
  damage: (m) => `-${m}`,
  heal: (m) => `+${m}`,
  addBarrier: (m) => `+${m} shield`,
  drainRed: () => STATUS_META.suppressed.label,
  drainBlue: () => STATUS_META.winded.label,
  cover: () => "",
  wall: () => "",
};
const ZONE_TICK_COLOR: Record<ZoneEffectKind, number> = {
  damage: 0xc0392b,
  heal: 0x2ecc71,
  addBarrier: 0x3498db,
  drainRed: STATUS_META.suppressed.color,
  drainBlue: STATUS_META.winded.color,
  cover: 0xffffff,
  wall: 0xffffff,
};

interface AttackFlash {
  gfx: Graphics;
  timer: number;
}

export type ShakeRequest = { intensity: number };

function easeOutQuad(t: number): number {
  return t * (2 - t);
}

/** Position at arc-length fraction `t` (0..1) along a polyline. */
function pointAlongPolyline(pts: { x: number; y: number }[], t: number): { x: number; y: number } {
  if (pts.length === 1) return pts[0]!;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  if (total < 1e-6) return pts[pts.length - 1]!;
  let target = t * total;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (target <= seg || i === pts.length - 1) {
      const f = seg < 1e-6 ? 0 : target / seg;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    target -= seg;
  }
  return pts[pts.length - 1]!;
}

/** Everything one attack performance needs to draw itself, bundled for the clip closures. */
interface PerfCtx {
  plan: AttackPlan;
  attackerId: string;
  attackerPos: Vec2;
  aim: Vec2;
  ability: AttackAbility;
  telegraph: Graphics;
  fx: Graphics | null;
}

/**
 * Owns the presentation layer of combat: entity visuals, and the ONE clock (Sequencer) that
 * everything time-based plays on. Server event batches are COMPILED into a clip timeline —
 * motion clips move `displayPos`, and simulation facts (HP, damage numbers, deaths, knockbacks)
 * are committed at each clip's impact beat, never at message arrival. A final settle clip snaps
 * every touched entity to the authoritative state, so playback can never drift from the sim.
 *
 * Local prediction (the defend prompt) registers what it already showed — the attacker's full
 * performance, the defender's block/miss reaction — and the authoritative event CONSUMES those
 * registrations, playing only the residual facts (vitals, damage numbers, deaths).
 */
export class EntityManager {
  private visuals = new Map<string, EntityVisual>();
  private pendingEvents: GameEvent[] = [];
  private attackFlashes: AttackFlash[] = [];
  private floatingText: FloatingTextManager;
  private seq = new Sequencer();
  /** Entities whose presentation is currently owned by batch clips — settle skips them. */
  private claimed = new Set<string>();
  /** Graphics created by performances, tracked so destroy() can't leak them. */
  private liveGfx = new Set<Graphics>();
  private lastState: GameState | null = null;
  /** Locally-played attacker performances awaiting their authoritative attack event. */
  private predictedAttacks = new Map<string, { plan: AttackPlan; at: number }>();
  /** Targets whose ENTIRE outcome (reaction, damage, HP, knockback, death) already played
   *  locally on the impact frame — the authoritative batch skips them; settle reconciles. */
  private predictedOutcomes = new Map<string, number>();
  onShake: ((req: ShakeRequest) => void) | null = null;
  onPerfectBlock: (() => void) | null = null;

  constructor(private layer: Container, private mySeatId: string | null = null) {
    this.floatingText = new FloatingTextManager(layer);
  }

  pushEvents(events: readonly GameEvent[]) {
    this.pendingEvents.push(...events);
  }

  sync(state: GameState, selectedEntityId: string | null) {
    this.lastState = state;
    const currentEntities = state.entities;

    for (const [id, visual] of this.visuals) {
      if (!currentEntities.has(id)) {
        this.layer.removeChild(visual.container);
        visual.container.destroy({ children: true });
        this.visuals.delete(id);
        this.claimed.delete(id);
      }
    }

    for (const [id, entity] of currentEntities) {
      let visual = this.visuals.get(id);

      if (visual && (visual.entitySprites?.idle !== entity.sprites?.idle || visual.heightMeters !== (entity.heightMeters ?? 2))) {
        this.layer.removeChild(visual.container);
        visual.container.destroy({ children: true });
        visual = undefined;
      }

      if (!visual) {
        visual = new EntityVisual(entity, this.mySeatId);
        this.visuals.set(id, visual);
        this.layer.addChild(visual.container);
      }
    }

    if (this.pendingEvents.length > 0) {
      this.compileBatch(this.pendingEvents, state);
      this.pendingEvents.length = 0;
    }

    for (const [id, entity] of currentEntities) {
      const visual = this.visuals.get(id)!;
      visual.update(entity, id === selectedEntityId && !entity.dead, 0);
      if (!this.claimed.has(id)) this.settleVisual(visual, entity);
    }
  }

  tick(state: GameState, selectedEntityId: string | null, dt: number) {
    this.seq.update(dt);

    for (const [id, visual] of this.visuals) {
      const entity = state.entities.get(id);
      if (!entity) continue;
      visual.update(entity, id === selectedEntityId && !entity.dead, dt);
    }

    for (let i = this.attackFlashes.length - 1; i >= 0; i--) {
      const flash = this.attackFlashes[i]!;
      flash.timer -= dt;
      flash.gfx.alpha = Math.max(0, flash.timer / FLASH_DURATION);
      if (flash.timer <= 0) {
        this.layer.removeChild(flash.gfx);
        flash.gfx.destroy();
        this.attackFlashes.splice(i, 1);
      }
    }

    this.floatingText.tick(dt);
  }

  isAnimating(): boolean {
    if (this.seq.busy || this.attackFlashes.length > 0) return true;
    if (this.floatingText.isAnimating()) return true;
    for (const visual of this.visuals.values()) {
      if (visual.isBusy) return true;
    }
    return false;
  }

  destroy() {
    this.seq.clear();
    for (const gfx of this.liveGfx) {
      this.layer.removeChild(gfx);
      gfx.destroy();
    }
    this.liveGfx.clear();
    for (const visual of this.visuals.values()) {
      this.layer.removeChild(visual.container);
      visual.container.destroy({ children: true });
    }
    this.visuals.clear();
    for (const flash of this.attackFlashes) {
      this.layer.removeChild(flash.gfx);
      flash.gfx.destroy();
    }
    this.attackFlashes.length = 0;
    this.pendingEvents.length = 0;
    this.claimed.clear();
    this.predictedAttacks.clear();
    this.predictedOutcomes.clear();
    this.floatingText.destroy();
  }

  // =====================================================================================
  // Batch compilation: events -> clips on the shared clock
  // =====================================================================================

  private compileBatch(events: readonly GameEvent[], state: GameState): void {
    /** Seconds offset of each hit target's impact beat within this batch. */
    const hitAt = new Map<string, number>();
    const kbEnd = new Map<string, number>();
    /** Targets whose outcome this batch confirmed as already locally played — their hit,
     *  knockback, and collision events are skipped wholesale (settle still reconciles them). */
    const outcomePlayed = new Set<string>();
    let end = 0;

    for (const event of events) {
      switch (event.type) {
        case "move": {
          const visual = this.visuals.get(event.entityId);
          if (!visual) break;
          this.claimed.add(event.entityId);
          // Recompute the route locally so playback follows the threaded path around obstacles.
          const mover = state.entities.get(event.entityId);
          const radius = mover ? moveRadiusOf(mover) : 16;
          const { route, smoothed } = planDisplayRoute(event.from, event.to, state.grid, radius);
          const followsPath = route.length > 0 && distance(route[route.length - 1]!, event.to) < radius;
          const path = followsPath && smoothed.length > 1
            ? smoothed.map((p) => ({ x: p.x, y: p.y }))
            : [{ x: event.from.x, y: event.from.y }, { x: event.to.x, y: event.to.y }];
          this.seq.schedule({
            delay: 0,
            duration: MOVE_DURATION,
            onStart: () => visual.startMovePose(),
            onUpdate: (t) => {
              const p = pointAlongPolyline(path, easeOutQuad(t));
              visual.moveDisplayTo(p.x, p.y);
            },
            onEnd: () => visual.endMovePose(),
          });
          end = Math.max(end, MOVE_DURATION);
          break;
        }

        case "attack": {
          // A locally-predicted (defended) performance already played its motion and impact;
          // consume it and play only the residual facts. Otherwise stage the full performance.
          const predicted = this.predictedAttacks.get(event.attackerId);
          this.predictedAttacks.delete(event.attackerId);
          const fresh = predicted && performance.now() - predicted.at < PREDICTION_TTL_MS;

          let plan: AttackPlan;
          if (fresh) {
            plan = predicted.plan;
          } else {
            const brief = state.entities.get(event.attackerId)?.teamId === "red";
            plan = planAttack(event.ability, event.attackerPosition, event.aimDirection, state.entities, state.grid, event.attackerId, { brief });
            this.claimed.add(event.attackerId);
            this.schedulePerformance(plan, event.attackerId, event.attackerPosition, event.aimDirection, event.ability, state);
            end = Math.max(end, plan.totalMs / 1000);
          }

          for (const hit of event.hits) {
            // Whole-outcome prediction: this target already saw its reaction, damage number,
            // HP drop, and knockback on the impact frame — nothing left for the event to play.
            const predictedOutcomeAt = this.predictedOutcomes.get(hit.targetId);
            this.predictedOutcomes.delete(hit.targetId);
            if (predictedOutcomeAt !== undefined && performance.now() - predictedOutcomeAt < PREDICTION_TTL_MS) {
              outcomePlayed.add(hit.targetId);
              this.claimed.add(hit.targetId);
              // The predicted knockback may still be mid-flight — hold this batch's settle
              // until it can only have finished, so the snap never fights the clip.
              end = Math.max(end, KNOCKBACK_DURATION + 0.05);
              continue;
            }
            const impact = fresh ? 0 : this.impactOffset(plan, event.attackerPosition, hit.targetId, state);
            hitAt.set(hit.targetId, impact);
            this.claimed.add(hit.targetId);
            this.scheduleHit(hit.targetId, hit.damage, hit.killed, hit.defenseTier, event.attackerPosition, impact, state);
            if (hit.riderLabels?.length) {
              const labels = hit.riderLabels;
              const targetId = hit.targetId;
              this.seq.schedule({
                delay: impact + 0.18,
                duration: 0,
                onEnd: () => {
                  const visual = this.visuals.get(targetId);
                  if (!visual) return;
                  this.floatingText.spawn(visual.displayPos.x, visual.displayPos.y - 62, labels.join(" · "), 0xd4a533);
                },
              });
            }
            end = Math.max(end, impact + 0.05);
          }
          break;
        }

        case "knockback":
        case "pull": {
          if (outcomePlayed.has(event.entityId)) break; // shove already played locally
          const visual = this.visuals.get(event.entityId);
          if (!visual) break;
          this.claimed.add(event.entityId);
          const off = hitAt.get(event.entityId) ?? 0;
          const from = event.from;
          const to = event.to;
          this.seq.schedule({
            delay: off,
            duration: KNOCKBACK_DURATION,
            onStart: () => visual.triggerShoved(from.x + (from.x - to.x)),
            onUpdate: (t) => {
              const e = easeOutQuad(t);
              visual.displayPos.x = from.x + (to.x - from.x) * e;
              visual.displayPos.y = from.y + (to.y - from.y) * e;
            },
          });
          kbEnd.set(event.entityId, off + KNOCKBACK_DURATION);
          end = Math.max(end, off + KNOCKBACK_DURATION);
          break;
        }

        case "collision": {
          if (outcomePlayed.has(event.entityId)) break; // wall-slam already played locally
          const off = kbEnd.get(event.entityId) ?? hitAt.get(event.entityId) ?? 0;
          const ev = event;
          this.claimed.add(event.entityId);
          this.seq.schedule({
            delay: off,
            duration: 0,
            onEnd: () => {
              this.spawnImpactBurst(ev.at, 0xb0392b);
              this.floatingText.spawn(ev.at.x, ev.at.y - 30, `-${ev.damage}`, 0xc0392b);
              const visual = this.visuals.get(ev.entityId);
              if (!visual) return;
              const entity = this.lastState?.entities.get(ev.entityId);
              if (entity) visual.commitVitals(entity.hp, entity.maxHp, entity.barrier);
              if (ev.killed) visual.triggerDeath();
              else {
                visual.triggerHit();
                visual.flashHit();
              }
            },
          });
          end = Math.max(end, off + 0.05);
          break;
        }

        case "statusApplied": {
          const off = hitAt.get(event.entityId) ?? 0;
          const ev = event;
          this.seq.schedule({
            delay: off + 0.12,
            duration: 0,
            onEnd: () => this.playStatusApplied(ev.entityId, ev.status.type),
          });
          end = Math.max(end, off + 0.2);
          break;
        }

        case "zoneTick":
        case "auraTick": {
          const ev = event;
          this.seq.schedule({
            delay: 0,
            duration: 0,
            onEnd: () => {
              const visual = this.visuals.get(ev.entityId);
              if (!visual) return;
              this.floatingText.spawn(visual.displayPos.x, visual.displayPos.y - 45, ZONE_TICK_LABEL[ev.effect](ev.magnitude), ZONE_TICK_COLOR[ev.effect]);
              const entity = this.lastState?.entities.get(ev.entityId);
              if (entity) visual.commitVitals(entity.hp, entity.maxHp, entity.barrier);
            },
          });
          break;
        }

        case "blink": {
          // No walk: dissolve at the origin, materialize at the destination.
          const visual = this.visuals.get(event.entityId);
          if (!visual) break;
          this.claimed.add(event.entityId);
          const off = hitAt.get(event.entityId) ?? 0;
          const to = event.to;
          const BLINK_DURATION = 0.3;
          this.seq.schedule({
            delay: off,
            duration: BLINK_DURATION,
            onUpdate: (t) => {
              if (t < 0.5) {
                visual.container.alpha = 1 - t * 2;
              } else {
                visual.moveDisplayTo(to.x, to.y);
                visual.container.alpha = (t - 0.5) * 2;
              }
            },
            onEnd: () => {
              visual.container.alpha = 1;
              this.spawnImpactBurst(to, 0x9b8bee);
            },
          });
          end = Math.max(end, off + BLINK_DURATION);
          break;
        }

        case "restore": {
          const ev = event;
          const off = hitAt.get(event.entityId) ?? 0;
          this.seq.schedule({
            delay: off + 0.1,
            duration: 0,
            onEnd: () => {
              const visual = this.visuals.get(ev.entityId);
              if (!visual) return;
              const parts: string[] = [];
              if (ev.hp > 0) parts.push(`+${ev.hp}`);
              if (ev.red > 0) parts.push(`+${ev.red} red`);
              if (ev.blue > 0) parts.push(`+${ev.blue} blue`);
              this.floatingText.spawn(visual.displayPos.x, visual.displayPos.y - 45, parts.join(" "), ev.hp > 0 ? 0x2ecc71 : 0xd4a533);
              const entity = this.lastState?.entities.get(ev.entityId);
              if (entity) visual.commitVitals(entity.hp, entity.maxHp, entity.barrier);
            },
          });
          end = Math.max(end, off + 0.2);
          break;
        }

        case "spawn":
        case "turnStart":
        case "endTurn":
        case "barrier":
        case "zoneCreated":
        case "zoneExpired":
          // Barrier/zone overlays draw straight from GameState; spawns appear via sync; the
          // batch settle commits any vitals these changed.
          break;
      }
    }

    // The settle: after every clip has landed, snap every touched entity to the authoritative
    // state. Playback can lag the sim, but it can never end somewhere the sim isn't.
    this.seq.schedule({
      delay: end + 0.02,
      duration: 0,
      onEnd: () => {
        for (const id of this.claimed) {
          const visual = this.visuals.get(id);
          const entity = this.lastState?.entities.get(id);
          if (visual && entity) this.settleVisual(visual, entity);
        }
        this.claimed.clear();
      },
    });
  }

  private settleVisual(visual: EntityVisual, entity: Entity): void {
    visual.displayPos.x = entity.position.x;
    visual.displayPos.y = entity.position.y;
    visual.commitVitals(entity.hp, entity.maxHp, entity.barrier);
    if (entity.dead && !visual.isDead) visual.forceDead();
  }

  /** When (seconds from performance start) the impact physically reaches this target. */
  private impactOffset(plan: AttackPlan, attackerPos: Vec2, targetId: string, state: GameState): number {
    if (plan.waveReach > 0) {
      const target = state.entities.get(targetId);
      const dist = target
        ? Math.min(plan.waveReach, Math.hypot(target.position.x - attackerPos.x, target.position.y - attackerPos.y))
        : plan.waveReach;
      return (plan.swingMs + dist / plan.waveSpeed) / 1000 + 0.02;
    }
    return plan.contactMs / 1000 + 0.03;
  }

  private scheduleHit(
    targetId: string,
    damage: number,
    killed: boolean,
    defenseTier: "perfect" | "decent" | undefined,
    attackerPos: Vec2,
    delay: number,
    state: GameState,
  ): void {
    this.seq.schedule({
      delay,
      duration: 0,
      onEnd: () => {
        const entity = this.lastState?.entities.get(targetId) ?? state.entities.get(targetId);
        this.playHitReaction(targetId, damage, killed, defenseTier, attackerPos, entity ?? null);
      },
    });
  }

  /** The full on-impact reaction for one target: vitals commit, damage number, and the
   *  block verdict / flinch+flash+burst / death. Shared by event playback and local prediction.
   *  Guarded chip damage floats muted grey — "reduced damage leaked through", not "you got hit". */
  private playHitReaction(
    targetId: string,
    damage: number,
    killed: boolean,
    defenseTier: "perfect" | "decent" | undefined,
    attackerPos: Vec2,
    vitals: { hp: number; maxHp: number; barrier: number } | null,
  ): void {
    const visual = this.visuals.get(targetId);
    if (!visual) return;
    if (vitals) visual.commitVitals(vitals.hp, vitals.maxHp, vitals.barrier);
    if (damage > 0) {
      if (defenseTier) {
        this.floatingText.spawn(visual.displayPos.x + 14, visual.displayPos.y - 48, `-${damage}`, 0x77808a, { fontSize: 12 });
      } else {
        this.floatingText.spawn(visual.displayPos.x + 14, visual.displayPos.y - 48, `-${damage}`, 0xc0392b);
      }
    }
    if (killed) {
      visual.triggerDeath();
      return;
    }
    if (defenseTier) {
      this.playBlockReaction(targetId, attackerPos, defenseTier);
    } else {
      visual.triggerHit();
      visual.flashHit();
      this.spawnImpactBurst(visual.displayPos, 0xb0392b);
    }
  }

  /**
   * A status landing is told in two beats: falling colored chevrons over the body right after
   * the hit (the debuff "settling in"), THEN the named toast once they finish — extra info
   * after the impact, never competing with the damage number on the impact frame.
   */
  private playStatusApplied(targetId: string, statusType: keyof typeof STATUS_META): void {
    const visual = this.visuals.get(targetId);
    if (!visual || visual.isDead) return;
    const meta = STATUS_META[statusType];
    const color = meta?.color ?? 0xffffff;
    const gfx = new Graphics();
    gfx.zIndex = 100000;
    this.layer.addChild(gfx);
    this.liveGfx.add(gfx);
    const xOffsets = [-13, -5, 3, 11];
    this.seq.schedule({
      delay: 0,
      duration: 0.65,
      onUpdate: (t) => {
        gfx.clear();
        const px = visual.displayPos.x;
        const py = visual.displayPos.y;
        for (let i = 0; i < xOffsets.length; i++) {
          // Staggered starts so the chevrons rain rather than march.
          const ti = Math.min(1, Math.max(0, t * 1.45 - i * 0.11));
          if (ti <= 0 || ti >= 1) continue;
          const x = px + xOffsets[i]!;
          const y = py - 52 + ti * 30;
          const alpha = ti < 0.25 ? ti / 0.25 : 1 - (ti - 0.25) / 0.75;
          gfx.moveTo(x - 4, y - 4);
          gfx.lineTo(x, y);
          gfx.lineTo(x + 4, y - 4);
          gfx.moveTo(x - 4, y - 9);
          gfx.lineTo(x, y - 5);
          gfx.lineTo(x + 4, y - 9);
          gfx.stroke({ color, alpha: Math.max(0, alpha), width: 2.4 });
        }
      },
      onEnd: () => {
        this.layer.removeChild(gfx);
        gfx.destroy();
        this.liveGfx.delete(gfx);
        const v = this.visuals.get(targetId);
        if (v && !v.isDead) {
          this.floatingText.spawn(v.displayPos.x, v.displayPos.y - 50, meta?.label ?? statusType, color);
        }
      },
    });
  }

  private playBlockReaction(defenderId: string, attackerPosition: Vec2, tier: "perfect" | "decent"): void {
    const visual = this.visuals.get(defenderId);
    if (!visual) return;
    // Shield sparks at the contact edge — the absorption reads at the point of impact.
    const toward = normalize({ x: attackerPosition.x - visual.displayPos.x, y: attackerPosition.y - visual.displayPos.y });
    const sparkAt = { x: visual.displayPos.x + toward.x * 14, y: visual.displayPos.y + toward.y * 14 - 10 };
    if (tier === "perfect") {
      visual.triggerPerfectBlock(attackerPosition.x);
      visual.flashPerfect();
      this.spawnImpactBurst(sparkAt, 0xfff2d8);
      this.onPerfectBlock?.();
    } else {
      visual.triggerBlock(attackerPosition.x);
      visual.flashGuard();
      this.spawnImpactBurst(sparkAt, 0xb9c2cc);
    }
    const label = defenseLabel(tier);
    this.floatingText.spawn(visual.displayPos.x, visual.displayPos.y - 55, label.text, label.color, {
      fontSize: label.fontSize,
      lifetime: label.lifetime,
      strokeColor: label.strokeColor,
      strokeWidth: label.strokeWidth,
      fontWeight: label.fontWeight,
      fontFamily: label.fontFamily,
    });
  }

  // =====================================================================================
  // Attack performances (wind-up -> strike -> shockwave/projectile), as clips
  // =====================================================================================

  /**
   * Start the attacker-side performance for a defended incoming attack and register it as a
   * prediction — the authoritative event consumes the registration instead of replaying it.
   * The returned plan's `contactMs` is the beat the defend prompt scores presses against.
   */
  startDefendedAttackPerformance(
    attackerId: string,
    attackerPosition: Vec2,
    aimDirection: AimDirection,
    ability: AttackAbility,
    state: GameState,
    targetPos?: Vec2,
  ): AttackPlan {
    const plan = planAttack(ability, attackerPosition, aimDirection, state.entities, state.grid, attackerId, { targetPos });
    this.predictedAttacks.set(attackerId, { plan, at: performance.now() });
    this.schedulePerformance(plan, attackerId, attackerPosition, aimDirection, ability, state);
    return plan;
  }

  /** Raise the guard pose (no label/flash — those are the verdict, and it isn't in yet). */
  raiseGuardPose(defenderIds: readonly string[], attackerPosition: Vec2): void {
    for (const id of defenderIds) {
      this.visuals.get(id)?.triggerBlock(attackerPosition.x, 1.4);
    }
  }

  /**
   * Predict and play MY hero's COMPLETE outcome on the impact frame. This dry-runs the same
   * deterministic resolver the server will run, with my defense multiplier — my hero's damage,
   * knockback, wall-slam, and death depend only on my own press, so the prediction is exact.
   * The authoritative batch then skips this target entirely and the settle reconciles, so a
   * divergence (which the shared resolver makes impossible in practice) self-corrects.
   */
  predictDefendOutcome(
    attackerId: string,
    attackerPosition: Vec2,
    aimDirection: AimDirection,
    ability: AttackAbility,
    targetId: string,
    power: number,
    state: GameState,
  ): void {
    this.predictedOutcomes.set(targetId, performance.now());
    this.claimed.add(targetId); // predicted motion owns the body until the event batch settles
    const tier = defenseTierFromPower(power);
    const action: PlayerAction = { type: "ability", entityId: attackerId, abilityId: ability.id, aimDirection };
    const result = resolveAction(state, action, {
      defenseMap: new Map([[targetId, defenseToMultiplier(power)]]),
    });
    const after = result.state.entities.get(targetId);
    const vitals = after ? { hp: after.hp, maxHp: after.maxHp, barrier: after.barrier } : null;

    let kbDelay = 0;
    for (const ev of result.events) {
      if (ev.type === "attack") {
        const hit = ev.hits.find((h) => h.targetId === targetId);
        if (!hit) continue;
        // The guard pose went up at keydown; this is the VERDICT, all in one beat.
        this.playHitReaction(targetId, hit.damage, hit.killed, tier === "none" ? undefined : tier, attackerPosition, vitals);
      } else if ((ev.type === "knockback" || ev.type === "pull") && ev.entityId === targetId) {
        const visual = this.visuals.get(targetId);
        if (!visual) continue;
        const from = ev.from;
        const to = ev.to;
        this.seq.schedule({
          delay: 0,
          duration: KNOCKBACK_DURATION,
          onStart: () => visual.triggerShoved(from.x + (from.x - to.x)),
          onUpdate: (t) => {
            const e = easeOutQuad(t);
            visual.displayPos.x = from.x + (to.x - from.x) * e;
            visual.displayPos.y = from.y + (to.y - from.y) * e;
          },
        });
        kbDelay = KNOCKBACK_DURATION;
      } else if (ev.type === "collision" && ev.entityId === targetId) {
        const collided = ev;
        this.seq.schedule({
          delay: kbDelay,
          duration: 0,
          onEnd: () => {
            this.spawnImpactBurst(collided.at, 0xb0392b);
            this.floatingText.spawn(collided.at.x, collided.at.y - 30, `-${collided.damage}`, 0xc0392b);
            const visual = this.visuals.get(targetId);
            if (!visual) return;
            if (collided.killed) visual.triggerDeath();
            else visual.triggerHit();
          },
        });
      }
    }
  }

  private schedulePerformance(
    plan: AttackPlan,
    attackerId: string,
    attackerPos: Vec2,
    aim: Vec2,
    ability: AttackAbility,
    state: GameState,
  ): void {
    const telegraph = new Graphics();
    telegraph.zIndex = -1; // ground marking, under every body
    this.layer.addChild(telegraph);
    this.liveGfx.add(telegraph);
    let fx: Graphics | null = null;
    if (plan.projectile || plan.waveReach > 0) {
      fx = new Graphics();
      fx.zIndex = 100000; // in-flight visuals over the bodies
      this.layer.addChild(fx);
      this.liveGfx.add(fx);
    }
    const ctx: PerfCtx = { plan, attackerId, attackerPos: { ...attackerPos }, aim, ability, telegraph, fx };

    let strikePosed = false;
    let swingFired = false;
    const anticipationEnd = plan.anticipationMs;
    const holdEnd = plan.anticipationMs + plan.holdMs;

    this.seq.schedule({
      delay: 0,
      duration: plan.totalMs / 1000,
      onStart: () => this.visuals.get(attackerId)?.faceToward(attackerPos.x + aim.x),
      onUpdate: (tt) => {
        const t = tt * plan.totalMs;
        const visual = this.visuals.get(attackerId);

        if (t < anticipationEnd) {
          // Wind-up: pull away from the aim, crouch, telegraph fades in.
          const a = t / plan.anticipationMs;
          const ease = a * a * (3 - 2 * a);
          const deep = plan.kind === "nova" ? 0.16 : 0.1;
          visual?.setPerformancePose(
            plan.backoff.x * ease,
            plan.backoff.y * ease,
            1 + deep * 0.5 * ease,
            1 - deep * ease,
          );
          this.drawPerformanceTelegraph(ctx, state, Math.min(1, a * 1.2), Math.min(1, t / plan.contactMs));
        } else if (t < holdEnd) {
          // Tension: full telegraph, tiny shiver at the deepest point of the wind-up.
          const jitter = Math.sin(t * 0.09) * 1.4;
          const deep = plan.kind === "nova" ? 0.16 : 0.1;
          visual?.setPerformancePose(plan.backoff.x + jitter, plan.backoff.y, 1 + deep * 0.5, 1 - deep);
          this.drawPerformanceTelegraph(ctx, state, 1, t / plan.contactMs);
        } else if (t < plan.swingMs) {
          // Strike: accelerate into the lunge / fly the projectile.
          if (!strikePosed) {
            strikePosed = true;
            visual?.triggerAttack(ctx.attackerPos.x + aim.x);
          }
          const s = (t - holdEnd) / plan.strikeMs;
          const ease = s * s;
          visual?.setPerformancePose(
            plan.backoff.x + (plan.lunge.x - plan.backoff.x) * ease,
            plan.backoff.y + (plan.lunge.y - plan.backoff.y) * ease,
            1,
            1,
          );
          this.drawPerformanceTelegraph(ctx, state, 1, t / plan.contactMs);
          if (fx && plan.projectile) this.drawProjectile(ctx, s);
        } else {
          // The swing has landed: the shockwave carries the impact outward — the wave physically
          // reaching a target IS its impact beat. Wave attacks get only a compact origin pop
          // here (a full-area flash would be the brightest thing on screen at the exact moment
          // the eye needs to acquire the moving front); projectile/nova kinds keep the full
          // footprint flash since their impact IS this moment.
          if (!swingFired) {
            swingFired = true;
            ctx.telegraph.clear();
            ctx.fx?.clear();
            if (plan.waveReach > 0) {
              this.spawnImpactBurst(ctx.attackerPos, ability.visual?.color ?? DEFAULT_FLASH_COLOR);
            } else {
              this.spawnAttackFlash(ctx.attackerPos, aim, ability, attackerId, state);
            }
            const shake = ability.visual?.screenShake;
            if (shake && shake > 0) this.onShake?.({ intensity: shake });
          }
          if (plan.waveReach > 0 && fx) {
            const waveDist = (t - plan.swingMs) * plan.waveSpeed;
            // Keep drawing past the reach so the tail burns out instead of vanishing.
            if (waveDist <= plan.waveReach + 40) this.drawShockwave(ctx, waveDist);
            else fx.clear();
          }
          if (t < plan.swingMs + plan.recoverMs) {
            // Recover: ease the body back to rest while the wave travels.
            const r = (t - plan.swingMs) / plan.recoverMs;
            const back = 1 - r;
            visual?.setPerformancePose(plan.lunge.x * back, plan.lunge.y * back, 1, 1);
          } else {
            visual?.clearPerformancePose();
          }
        }
      },
      onEnd: () => {
        this.visuals.get(attackerId)?.clearPerformancePose();
        this.layer.removeChild(telegraph);
        telegraph.destroy();
        this.liveGfx.delete(telegraph);
        if (fx) {
          this.layer.removeChild(fx);
          fx.destroy();
          this.liveGfx.delete(fx);
        }
      },
    });
  }

  /** Redraw the ground telegraph for one performance frame. `intensity` ramps the shape in
   *  during the wind-up; `progress` (0..1 of time-to-contact) drives the converging cues. */
  private drawPerformanceTelegraph(ctx: PerfCtx, state: GameState, intensity: number, progress: number): void {
    const g = ctx.telegraph;
    g.clear();
    const color = ctx.ability.visual?.color ?? DEFAULT_FLASH_COLOR;

    if (ctx.plan.kind === "nova") {
      // The clock IS the ring: it contracts from the blast edge onto the body, touching at contact.
      const radius = ctx.plan.ringRadius;
      drawRoughCircle(g, ctx.attackerPos.x, ctx.attackerPos.y, radius, 1.5, 24, 59);
      g.stroke({ color, alpha: 0.3 * intensity, width: 1.4 });
      const ringR = Math.max(10, radius * (1 - progress));
      drawRoughCircle(g, ctx.attackerPos.x, ctx.attackerPos.y, ringR, 1.2, 20, 61);
      g.stroke({ color, alpha: 0.8 * intensity, width: 2.2 });
      return;
    }

    if (ctx.plan.kind === "lob" && ctx.plan.projectile) {
      // Landing marker: the blast disc plus a shadow that grows as the bomb comes down.
      const to = ctx.plan.projectile.to;
      const radius = ctx.ability.shape.kind === ShapeKind.Circle ? ctx.ability.shape.radius : 40;
      drawRoughCircle(g, to.x, to.y, radius, 1.5, 24, 67);
      g.stroke({ color, alpha: 0.45 * intensity, width: 1.6 });
      g.circle(to.x, to.y, 4 + 8 * progress);
      g.fill({ color: 0x1a140e, alpha: 0.25 * intensity });
      return;
    }

    // Sector / rectangle / point: the sketched footprint, brightening toward contact.
    drawIncomingAttackPreview(
      g,
      ctx.attackerId,
      ctx.attackerPos,
      ctx.aim,
      ctx.ability,
      state.entities,
      state.grid,
      (0.25 + 0.45 * progress) * intensity,
      0.1 * intensity,
    );
  }

  /**
   * The traveling impact front, drawn to OWN the eye: nothing ahead of it (clean ground to
   * acquire against), a white-hot leading edge, a thick body in the ability color, and a
   * painted tail that decays behind it — the wave *creates* the strike area and it burns out.
   */
  private drawShockwave(ctx: PerfCtx, dist: number): void {
    const g = ctx.fx!;
    g.clear();
    const color = ctx.ability.visual?.color ?? DEFAULT_FLASH_COLOR;
    const norm = normalize(ctx.aim);
    const baseAngle = Math.atan2(norm.y, norm.x);
    const reach = ctx.plan.waveReach;
    // Past the shape's edge the front holds at the reach and burns out while the tail catches up.
    const front = Math.min(dist, reach);
    const overrun = Math.max(0, dist - reach);
    const fade = (1 - (front / reach) * 0.3) * Math.max(0, 1 - overrun / 40);
    // Tail bands: (offset behind the front, alpha, width) — a cheap painted gradient.
    const tail: [number, number, number][] = [
      [7, 0.5, 7],
      [15, 0.32, 8],
      [24, 0.18, 9],
      [34, 0.08, 10],
    ];

    if (ctx.plan.kind === "sector" && ctx.ability.shape.kind === ShapeKind.Sector) {
      const half = ctx.ability.shape.halfAngle * 0.95;
      const cx = ctx.attackerPos.x;
      const cy = ctx.attackerPos.y;
      for (const [back, alpha, width] of tail) {
        const r = dist - back;
        if (r <= 4 || r > reach) continue;
        drawRoughArc(g, cx, cy, r, baseAngle - half, baseAngle + half, 1.5, 18, 87 + back);
        g.stroke({ color, alpha: alpha * fade, width });
      }
      drawRoughArc(g, cx, cy, front, baseAngle - half, baseAngle + half, 1.2, 20, 89);
      g.stroke({ color, alpha: 0.95 * fade, width: 6 });
      drawRoughArc(g, cx, cy, front, baseAngle - half, baseAngle + half, 0.8, 20, 91);
      g.stroke({ color: 0xfff2d8, alpha: 1 * fade, width: 2.4 });
      return;
    }

    if (ctx.plan.kind === "rectangle" && ctx.ability.shape.kind === ShapeKind.Rectangle) {
      const halfW = ctx.ability.shape.width / 2;
      const perp = { x: -norm.y, y: norm.x };
      const lineAt = (d: number, alpha: number, width: number, lineColor: number, seed: number) => {
        const p = { x: ctx.attackerPos.x + norm.x * d, y: ctx.attackerPos.y + norm.y * d };
        drawRoughLine(g, p.x - perp.x * halfW, p.y - perp.y * halfW, p.x + perp.x * halfW, p.y + perp.y * halfW, 0.8, seed);
        g.stroke({ color: lineColor, alpha, width });
      };
      for (const [back, alpha, width] of tail) {
        const d = dist - back;
        if (d <= 2 || d > reach) continue;
        lineAt(d, alpha * fade, width, color, 93 + back);
      }
      lineAt(front, 0.95 * fade, 6, color, 95);
      lineAt(front, 1 * fade, 2.4, 0xfff2d8, 97);
    }
  }

  private drawProjectile(ctx: PerfCtx, s: number): void {
    const g = ctx.fx!;
    const { from, to, arc } = ctx.plan.projectile!;
    g.clear();
    const color = ctx.ability.visual?.color ?? DEFAULT_FLASH_COLOR;
    const x = from.x + (to.x - from.x) * s;
    const y = from.y + (to.y - from.y) * s;

    if (arc) {
      // Lobbed bomb: parabolic height faked with a y-offset; the ground shadow stays honest.
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const arcH = Math.min(90, Math.max(30, dist * 0.25));
      const h = Math.sin(Math.PI * s) * arcH;
      g.ellipse(x, y, 7 * (1 - 0.4 * Math.sin(Math.PI * s)), 3.5);
      g.fill({ color: 0x1a140e, alpha: 0.3 });
      drawRoughCircle(g, x, y - h, 6, 1, 10, 43);
      g.fill({ color, alpha: 0.9 });
      g.stroke({ color: 0x1a140e, alpha: 0.5, width: 1 });
      return;
    }

    // Straight shot: a short dart along the flight line.
    const norm = normalize({ x: to.x - from.x, y: to.y - from.y });
    drawRoughLine(g, x - norm.x * 12, y - norm.y * 12, x, y, 0.6, 47);
    g.stroke({ color, alpha: 0.95, width: 2.5 });
    g.circle(x, y, 2.2);
    g.fill({ color, alpha: 0.95 });
  }

  // =====================================================================================
  // One-shot flash/burst graphics + previews (unchanged visuals)
  // =====================================================================================

  /** Spawn a floating text label in world space. Used for impact-feedback callouts (CRIT!,
   *  BLOCK!, PARRY!) on top of the standard damage/status floats. */
  spawnFloatingText(x: number, y: number, message: string, color: number, opts?: import("./floating-text.js").FloatingTextOptions): void {
    this.floatingText.spawn(x, y, message, color, opts);
  }

  setDamagePreview(targets: { entityId: string; damage: number; currentHp: number; maxHp: number; barrier: number }[]): void {
    const targetIds = new Set(targets.map(t => t.entityId));
    for (const [id, visual] of this.visuals) {
      if (targetIds.has(id)) {
        const t = targets.find(t => t.entityId === id)!;
        visual.setDamagePreview(t.damage, t.currentHp, t.maxHp, t.barrier);
      } else {
        visual.clearDamagePreview();
      }
    }
  }

  setBarrierPreview(entityId: string, barrierHp: number, currentHp: number, maxHp: number, currentBarrier: number): void {
    for (const [id, visual] of this.visuals) {
      if (id === entityId) {
        visual.setBarrierPreview(barrierHp, currentHp, maxHp, currentBarrier);
      } else {
        visual.clearDamagePreview();
      }
    }
  }

  clearDamagePreview(): void {
    for (const visual of this.visuals.values()) {
      visual.clearDamagePreview();
    }
  }

  depthSort() {
    for (const visual of this.visuals.values()) {
      visual.container.zIndex = visual.container.position.y + FOOT_OFFSET;
    }
  }

  private spawnImpactBurst(at: Vec2, color: number) {
    const gfx = new Graphics();
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2 + 0.2;
      const len = 6 + (i % 3) * 4;
      gfx.moveTo(at.x, at.y);
      gfx.lineTo(at.x + Math.cos(angle) * len, at.y + Math.sin(angle) * len);
    }
    gfx.stroke({ color, alpha: 0.85, width: 2 });
    drawRoughCircle(gfx, at.x, at.y, 7, 1.5, 12, 61);
    gfx.stroke({ color, alpha: 0.6, width: 1.5 });
    this.layer.addChild(gfx);
    this.attackFlashes.push({ gfx, timer: FLASH_DURATION });
  }

  private spawnAttackFlash(
    pos: Vec2,
    aimDirection: AimDirection,
    ability: AttackAbility,
    attackerId: string,
    state: GameState
  ) {
    const gfx = new Graphics();
    const aimLen = vecLength(aimDirection);
    const norm = normalize(aimDirection);
    const baseAngle = Math.atan2(norm.y, norm.x);
    const shape = ability.shape;
    const visual = ability.visual;
    const color = visual?.color ?? DEFAULT_FLASH_COLOR;
    const trail = visual?.trailEffect;
    const circleDist = shape.kind === ShapeKind.Circle ? Math.min(aimLen, shape.range) : 0;

    const footprint = computeShapeFootprint(
      shape, pos, aimDirection,
      state.entities, state.grid,
      attackerId, ability.ignoreCoverRange
    );
    this.drawShapeFlash(gfx, footprint, color);

    if (trail) {
      this.drawTrailEffect(gfx, pos, norm, baseAngle, shape, color, trail, attackerId, ability, state, circleDist);
    }

    this.layer.addChild(gfx);
    this.attackFlashes.push({ gfx, timer: FLASH_DURATION });
  }

  private drawShapeFlash(gfx: Graphics, footprint: ShapeFootprint, color: number) {
    switch (footprint.kind) {
      case ShapeKind.Sector: {
        gfx.moveTo(footprint.origin.x, footprint.origin.y);
        drawRoughArc(gfx, footprint.origin.x, footprint.origin.y, footprint.radius, footprint.startAngle, footprint.endAngle, 1.5, 24, 71);
        gfx.lineTo(footprint.origin.x, footprint.origin.y);
        gfx.fill({ color, alpha: 0.25 });
        gfx.stroke({ color, alpha: 0.7, width: 1.5 });
        break;
      }
      case ShapeKind.Rectangle: {
        drawRoughRect(gfx, footprint.corners, 1, 73);
        gfx.fill({ color, alpha: 0.25 });
        gfx.stroke({ color, alpha: 0.7, width: 1.5 });
        break;
      }
      case ShapeKind.Point: {
        drawRoughLine(gfx, footprint.from.x, footprint.from.y, footprint.to.x, footprint.to.y, 0.8, 77);
        gfx.stroke({ color, alpha: 0.8, width: 2 });
        if (footprint.hitEntityId) {
          drawXMark(gfx, footprint.to.x, footprint.to.y, 7, 79);
          gfx.stroke({ color, alpha: 0.9, width: 2 });
        }
        break;
      }
      case ShapeKind.Circle: {
        drawRoughArc(gfx, footprint.center.x, footprint.center.y, footprint.radius, 0, Math.PI * 2, 1.5, 24, 83);
        gfx.fill({ color, alpha: 0.2 });
        gfx.stroke({ color, alpha: 0.7, width: 1.5 });
        break;
      }
    }
  }

  private drawTrailEffect(
    gfx: Graphics,
    pos: Vec2,
    norm: Vec2,
    baseAngle: number,
    shape: CombatShapeDefinition,
    color: number,
    trail: TrailEffect,
    attackerId: string,
    ability: AttackAbility,
    state: GameState,
    circleDist: number
  ) {
    switch (trail) {
      case "slash":
        this.drawSlashTrail(gfx, pos, baseAngle, shape, color);
        break;
      case "thrust":
        this.drawThrustTrail(gfx, pos, norm, shape, color);
        break;
      case "projectile":
        this.drawProjectileTrail(gfx, pos, norm, shape, color, attackerId, ability, state);
        break;
      case "explosion":
        this.drawExplosionTrail(gfx, pos, norm, shape, color, circleDist);
        break;
      case "splash":
        this.drawSplashTrail(gfx, pos, norm, shape, color, circleDist);
        break;
    }
  }

  private drawSlashTrail(gfx: Graphics, pos: Vec2, baseAngle: number, shape: CombatShapeDefinition, color: number) {
    const radius = shape.kind === ShapeKind.Sector ? shape.radius :
                   shape.kind === ShapeKind.Rectangle ? shape.length :
                   shape.kind === ShapeKind.Circle ? shape.radius : 50;
    const halfAngle = shape.kind === ShapeKind.Sector ? shape.halfAngle : Math.PI / 4;

    for (let i = 1; i <= 3; i++) {
      const r = radius * (0.3 + i * 0.2);
      const angleOffset = (i - 2) * 0.08;
      drawRoughArc(
        gfx, pos.x, pos.y, r,
        baseAngle - halfAngle * 0.8 + angleOffset,
        baseAngle + halfAngle * 0.8 + angleOffset,
        2.0, 16, 90 + i * 7
      );
      gfx.stroke({ color, alpha: 0.5 - i * 0.1, width: 2.5 - i * 0.4 });
    }
  }

  private drawThrustTrail(gfx: Graphics, pos: Vec2, norm: Vec2, shape: CombatShapeDefinition, color: number) {
    const length = shape.kind === ShapeKind.Rectangle ? shape.length :
                   shape.kind === ShapeKind.Point ? shape.range : 80;

    const endX = pos.x + norm.x * length;
    const endY = pos.y + norm.y * length;
    drawRoughLine(gfx, pos.x, pos.y, endX, endY, 0.5, 95);
    gfx.stroke({ color, alpha: 0.7, width: 3 });

    const tipLen = 8;
    const tipSpread = 5;
    const perpX = -norm.y;
    const perpY = norm.x;
    gfx.moveTo(endX, endY);
    gfx.lineTo(endX - norm.x * tipLen + perpX * tipSpread, endY - norm.y * tipLen + perpY * tipSpread);
    gfx.moveTo(endX, endY);
    gfx.lineTo(endX - norm.x * tipLen - perpX * tipSpread, endY - norm.y * tipLen - perpY * tipSpread);
    gfx.stroke({ color, alpha: 0.6, width: 2 });
  }

  private drawProjectileTrail(
    gfx: Graphics,
    pos: Vec2,
    norm: Vec2,
    shape: CombatShapeDefinition,
    color: number,
    attackerId: string,
    ability: AttackAbility,
    state: GameState
  ) {
    if (shape.kind !== ShapeKind.Point) return;

    const result = raycast(
      pos, norm, shape.range,
      state.entities, state.grid,
      attackerId, ability.ignoreCoverRange
    );
    const endX = result.endPoint.x;
    const endY = result.endPoint.y;

    const perpX = -norm.y;
    const perpY = norm.x;
    const dx = endX - pos.x;
    const dy = endY - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const segments = Math.max(3, Math.floor(dist / 20));

    for (let i = 0; i < segments; i++) {
      const t = i / segments;
      const x = pos.x + dx * t;
      const y = pos.y + dy * t;
      const dotSize = 1.5 + t * 1.5;
      gfx.circle(x + perpX * Math.sin(t * 12) * 1.5, y + perpY * Math.sin(t * 12) * 1.5, dotSize);
    }
    gfx.fill({ color, alpha: 0.4 });

    if (result.hit) {
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        // eslint-disable-next-line no-restricted-syntax -- visual-only spark jitter, determinism not required
        const sparkLen = 5 + Math.random() * 5;
        gfx.moveTo(endX, endY);
        gfx.lineTo(endX + Math.cos(angle) * sparkLen, endY + Math.sin(angle) * sparkLen);
      }
      gfx.stroke({ color, alpha: 0.8, width: 1.5 });
    } else if (result.wallDistance !== null) {
      for (let i = 0; i < 5; i++) {
        const angle = Math.atan2(-norm.y, -norm.x) + (i - 2) * 0.4;
        // eslint-disable-next-line no-restricted-syntax -- visual-only spark jitter, determinism not required
        const sparkLen = 4 + Math.random() * 4;
        gfx.moveTo(endX, endY);
        gfx.lineTo(endX + Math.cos(angle) * sparkLen, endY + Math.sin(angle) * sparkLen);
      }
      gfx.stroke({ color, alpha: 0.6, width: 1.5 });
    }
  }

  private drawExplosionTrail(gfx: Graphics, pos: Vec2, norm: Vec2, shape: CombatShapeDefinition, color: number, circleDist: number) {
    let cx: number, cy: number, radius: number;

    if (shape.kind === ShapeKind.Circle) {
      cx = pos.x + norm.x * circleDist;
      cy = pos.y + norm.y * circleDist;
      radius = shape.radius;
    } else if (shape.kind === ShapeKind.Sector) {
      cx = pos.x + norm.x * shape.radius * 0.5;
      cy = pos.y + norm.y * shape.radius * 0.5;
      radius = shape.radius * 0.6;
    } else {
      cx = pos.x + norm.x * 40;
      cy = pos.y + norm.y * 40;
      radius = 30;
    }

    for (let i = 1; i <= 3; i++) {
      const r = radius * (0.3 + i * 0.25);
      drawRoughCircle(gfx, cx, cy, r, 2.0, 20, 100 + i * 11);
      gfx.stroke({ color, alpha: 0.6 - i * 0.15, width: 2.5 - i * 0.5 });
    }

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + 0.3;
      // eslint-disable-next-line no-restricted-syntax -- visual-only spark jitter, determinism not required
      const len = radius * (0.5 + Math.random() * 0.5);
      gfx.moveTo(cx, cy);
      gfx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    }
    gfx.stroke({ color, alpha: 0.35, width: 1.5 });
  }

  private drawSplashTrail(gfx: Graphics, pos: Vec2, norm: Vec2, shape: CombatShapeDefinition, color: number, circleDist: number) {
    let cx: number, cy: number, spread: number;

    if (shape.kind === ShapeKind.Circle) {
      cx = pos.x + norm.x * circleDist;
      cy = pos.y + norm.y * circleDist;
      spread = shape.radius;
    } else if (shape.kind === ShapeKind.Sector) {
      cx = pos.x + norm.x * shape.radius * 0.5;
      cy = pos.y + norm.y * shape.radius * 0.5;
      spread = shape.radius * 0.7;
    } else {
      cx = pos.x + norm.x * 40;
      cy = pos.y + norm.y * 40;
      spread = 30;
    }

    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + i * 0.5;
      // eslint-disable-next-line no-restricted-syntax -- visual-only spark jitter, determinism not required
      const dist = spread * (0.2 + Math.random() * 0.8);
      const blobX = cx + Math.cos(angle) * dist;
      const blobY = cy + Math.sin(angle) * dist;
      // eslint-disable-next-line no-restricted-syntax -- visual-only spark jitter, determinism not required
      const blobR = 2 + Math.random() * 4;
      drawRoughCircle(gfx, blobX, blobY, blobR, 1.0, 8, 120 + i * 5);
      gfx.fill({ color, alpha: 0.35 });
    }

    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const d1 = spread * 0.3;
      // eslint-disable-next-line no-restricted-syntax -- visual-only spark jitter, determinism not required
      const d2 = spread * (0.6 + Math.random() * 0.4);
      gfx.moveTo(cx + Math.cos(angle) * d1, cy + Math.sin(angle) * d1);
      gfx.lineTo(cx + Math.cos(angle) * d2, cy + Math.sin(angle) * d2);
    }
    gfx.stroke({ color, alpha: 0.3, width: 1.5 });
  }
}
