import { Application, Container, Graphics, Sprite, Text } from "pixi.js";
import type { AttackAbility, BarrierAbility, GameEvent, GridState, Vec2, ZoneAbility } from "shared";
import { CELL_WALL, CELL_COVER, distance, getAbilityCost, resolveAction, sub, length as vecLength, scaleAttack, powerToMultiplier, reachableArea, playerMovePath, getAffordableMoveDistance } from "shared";
import type { ClientState } from "../client-state.svelte.js";
import {
  createBackground,
  createMapObjects,
  getBottomY,
} from "./grid-renderer.js";
import { assetUrl, mapAssetUrl } from "../../lib/urls.js";
import { EntityManager } from "./entity-manager.js";
import { drawTargetingPreview, drawEffectPreview, drawIncomingAttackPreview } from "./targeting-renderer.js";
import { drawZones } from "./zone-renderer.js";
import { drawMovePreview } from "./move-preview-renderer.js";
import { ScreenFlash, type FlashOptions } from "./screen-flash.js";
import type { FramePacer } from "./frame-pacer.js";

const PADDING = 75;
const DIM_ALPHA = 0.4;
const DIM_COLOR = 0x1a140e;
const BORDER_COLOR = 0x4a3728;
const BORDER_WIDTH = 2;
const SHADOW_COLOR = 0x1a140e;
const SHADOW_BLUR = 18;
const SHADOW_ALPHA = 0.35;

// Per-frame exponential ease for the move preview target. Fixed factor (the selection token pins the
// frame rate to ~45fps while aiming), snapping the last fraction of a pixel so it settles cleanly.
function easeToward(cur: Vec2 | null, target: Vec2): Vec2 {
  if (!cur) return { x: target.x, y: target.y };
  const k = 0.35;
  const nx = cur.x + (target.x - cur.x) * k;
  const ny = cur.y + (target.y - cur.y) * k;
  if (Math.hypot(target.x - nx, target.y - ny) < 0.5) return { x: target.x, y: target.y };
  return { x: nx, y: ny };
}

export class GameRenderer {
  private outerContainer = new Container();
  private dimGfx = new Graphics();
  private frameGfx = new Graphics();
  private worldContainer = new Container();
  private backgroundLayer = new Container();
  private sortableLayer = new Container();
  private overlayLayer = new Container();
  private zonesGfx = new Graphics();
  private targetingGfx = new Graphics();
  private moveGfx = new Graphics();
  /** Eased on-screen move target — chases the (12px-snapped) reachable destination so the preview
   *  line/marker glide instead of jumping. May sit briefly between cells while easing. */
  private movePreviewTarget: Vec2 | null = null;
  private costLabel = new Text({ text: "", style: { fontSize: 11, fontFamily: "monospace", fontWeight: "bold", fill: 0x4a3728 } });
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private entities: EntityManager | null = null;
  private mapObjectSprites: Sprite[] = [];
  private debugLayer = new Container();
  private debugVisible = false;
  private tickerActive = false;
  private unregisterPacer: (() => void) | null = null;
  private shakeIntensity = 0;
  private shakeTimer = 0;
  private playbackSpeed = 1;
  private baseOffsetX = 0;
  private baseOffsetY = 0;
  private lastMouseWorld: Vec2 = { x: 0, y: 0 };
  private screenFlash: ScreenFlash;

  constructor(
    private app: Application,
    private clientState: ClientState,
    private pacer: FramePacer
  ) {
    this.outerContainer.addChild(this.dimGfx);
    this.outerContainer.addChild(this.frameGfx);
    this.outerContainer.addChild(this.worldContainer);
    this.screenFlash = new ScreenFlash(this.outerContainer);
    this.app.stage.addChild(this.outerContainer);
    this.outerContainer.visible = false;
  }

  flash(opts?: FlashOptions) {
    this.screenFlash.trigger(opts);
  }

  /** Locally play the attacker swing + shape flash for an incoming attack — used by the
   *  defense prompt so the visual lands at the press window, not after the server roundtrip. */
  previewIncomingAttack(attackerId: string, attackerPosition: Vec2, aimDirection: Vec2, ability: AttackAbility): void {
    const state = this.clientState.getState();
    if (!state || !this.entities) return;
    this.entities.previewIncomingAttack(attackerId, attackerPosition, aimDirection, ability, state);
  }

  /** Locally play the defender block animation + perfect-block screen flash. */
  triggerLocalBlock(defenderId: string, attackerPosition: Vec2, tier: "perfect" | "decent"): void {
    if (!this.entities) return;
    this.entities.triggerLocalBlock(defenderId, attackerPosition, tier);
  }

  /** Spawn an impact-feedback floating label (CRIT, PARRY, etc.) at a world position. */
  spawnFloatingText(x: number, y: number, message: string, color: number, opts?: import("./floating-text.js").FloatingTextOptions): void {
    if (!this.entities) return;
    this.entities.spawnFloatingText(x, y, message, color, opts);
  }

  bringToFront() {
    this.app.stage.addChild(this.outerContainer);
  }

  enter() {
    if (this.entities) {
      this.entities.destroy();
      this.entities = null;
    }
    this.rebuildGrid();
    this.entities = new EntityManager(this.sortableLayer, this.clientState.seat.mySeatId);
    this.entities.onShake = (req) => {
      this.shakeIntensity = req.intensity;
      this.shakeTimer = 0.3;
    };
    this.entities.onPerfectBlock = () => {
      this.screenFlash.trigger({ intensity: 0.65, duration: 0.22, color: 0xfff4d0 });
    };
    this.layout();
    const enterState = this.clientState.getState();
    if (enterState) {
      this.entities.sync(enterState, this.clientState.selectedEntityId);
      this.zonesGfx.clear();
      drawZones(this.zonesGfx, enterState.zones);
    }
    this.bringToFront();
    this.outerContainer.visible = true;

    if (!this.unregisterPacer) {
      this.unregisterPacer = this.pacer.register(() => this.desiredFps());
    }

    if (!this.tickerActive) {
      this.tickerActive = true;
      this.app.ticker.add((ticker) => {
        if (!this.outerContainer.visible || !this.entities) return;
        const dt = (ticker.deltaTime / 60) * this.playbackSpeed;
        const shaking = this.shakeTimer > 0;
        const flashing = this.screenFlash.active;

        if (flashing) {
          this.screenFlash.tick(dt);
        }

        if (shaking) {
          this.shakeTimer -= dt;
          const progress = Math.max(0, this.shakeTimer / 0.3);
          const magnitude = this.shakeIntensity * progress * 6;
          const shakeX = (Math.random() - 0.5) * 2 * magnitude;
          const shakeY = (Math.random() - 0.5) * 2 * magnitude;
          this.worldContainer.position.set(this.baseOffsetX + shakeX, this.baseOffsetY + shakeY);
          if (this.shakeTimer <= 0) {
            this.worldContainer.position.set(this.baseOffsetX, this.baseOffsetY);
          }
        }

        // While aiming a move, keep redrawing the overlay each frame so the eased target glides to
        // rest even when the mouse is idle (the selection token already holds ~45fps here).
        if (this.clientState.getSelectedAbility()?.kind === "move" && this.clientState.selectedEntityId) {
          this.renderOverlay(this.lastMouseWorld);
        }

        if (!this.entities.isAnimating()) return;
        const tickState = this.clientState.getState();
        if (!tickState) return;
        this.entities.tick(
          tickState,
          this.clientState.selectedEntityId,
          dt
        );
        this.entities.depthSort();
      });

      window.addEventListener("resize", () => {
        if (!this.outerContainer.visible) return;
        this.layout();
        this.renderOverlay(this.lastMouseWorld);
      });
    }
  }

  exit() {
    this.outerContainer.visible = false;
    if (this.entities) {
      this.entities.destroy();
      this.entities = null;
    }
    this.unregisterPacer?.();
    this.unregisterPacer = null;
  }

  /** FPS this renderer needs this instant — pulled by the pacer every frame. 60 while anything
   *  animates, 45 to keep the move-aim preview easing smooth while a unit is selected, else 0. */
  private desiredFps(): number {
    if (!this.outerContainer.visible || !this.entities) return 0;
    if (this.entities.isAnimating() || this.shakeTimer > 0 || this.screenFlash.active) return 60;
    if (this.clientState.selectedEntityId) return 45;
    return 0;
  }

  getCombatRect(): { x: number; y: number; w: number; h: number } {
    const state = this.clientState.getState();
    if (!state) return { x: 0, y: 0, w: 0, h: 0 };
    const grid = state.grid;
    return {
      x: this.offsetX,
      y: this.offsetY,
      w: grid.width * grid.cellSize * this.scale,
      h: grid.height * grid.cellSize * this.scale,
    };
  }

  screenToWorld(screenPos: Vec2): Vec2 {
    return {
      x: (screenPos.x - this.offsetX) / this.scale,
      y: (screenPos.y - this.offsetY) / this.scale,
    };
  }

  worldToScreen(worldPos: Vec2): Vec2 {
    return {
      x: worldPos.x * this.scale + this.offsetX,
      y: worldPos.y * this.scale + this.offsetY,
    };
  }

  pushEvents(events: readonly GameEvent[]) {
    if (this.entities) this.entities.pushEvents(events);
  }

  isAnimating(): boolean {
    return this.entities?.isAnimating() ?? false;
  }

  /** Multiplies the animation clock — 1 = normal, 2 = twice as fast, etc. */
  setPlaybackSpeed(speed: number) {
    this.playbackSpeed = speed;
  }

  render() {
    if (!this.entities) return;
    const renderState = this.clientState.getState();
    if (!renderState) return;
    this.entities.sync(renderState, this.clientState.selectedEntityId);
    this.zonesGfx.clear();
    drawZones(this.zonesGfx, renderState.zones);
    this.renderOverlay(this.lastMouseWorld);
    this.debugLayer.visible = this.clientState.showDebugWalls;
  }

  renderOverlay(mouseWorld: Vec2) {
    this.lastMouseWorld = mouseWorld;
    this.targetingGfx.clear();
    this.moveGfx.clear();
    this.costLabel.visible = false;
    if (this.entities) this.entities.clearDamagePreview();
    const state = this.clientState.getState();
    if (!state) return;

    const incoming = this.clientState.incomingAttack;
    if (incoming) {
      drawIncomingAttackPreview(
        this.targetingGfx,
        incoming.attackerId,
        incoming.attackerPosition,
        incoming.aimDirection,
        incoming.ability,
        state.entities,
        state.grid,
        0.5,
        0.08,
      );
    }

    const selectedId = this.clientState.selectedEntityId;

    if (!selectedId || state.winner) return;
    const entity = state.entities.get(selectedId);
    if (!entity || entity.dead) return;

    const selectedAbility = this.clientState.getSelectedAbility();
    if (selectedAbility?.kind !== "move") this.movePreviewTarget = null; // drop stale ease state
    if (selectedAbility?.kind === "attack" && entity.energy.red > 0) {
      const atk = selectedAbility as AttackAbility;
      const timingActive = this.clientState.timingPower !== null;
      const mult = timingActive ? powerToMultiplier(this.clientState.timingPower!) : 1;
      const scaledAtk = scaleAttack(atk, mult);
      const aimWorld = timingActive && this.clientState.timingAim
        ? { x: entity.position.x + this.clientState.timingAim.x, y: entity.position.y + this.clientState.timingAim.y }
        : mouseWorld;
      drawTargetingPreview(this.targetingGfx, entity, aimWorld, state, scaledAtk);

      const dir = timingActive && this.clientState.timingAim ? this.clientState.timingAim : sub(mouseWorld, entity.position);
      if (!timingActive && vecLength(dir) >= 1) {
        const preview = resolveAction(state, { type: "ability", entityId: selectedId, abilityId: atk.id, aimDirection: dir });
        const attackEvt = preview.events.find(e => e.type === "attack");
        const hits = attackEvt && attackEvt.type === "attack" ? attackEvt.hits : [];
        this.entities!.setDamagePreview(hits.flatMap(h => {
          const t = state.entities.get(h.targetId);
          return t ? [{ entityId: h.targetId, damage: h.damage, currentHp: t.hp, maxHp: t.maxHp, barrier: t.barrier }] : [];
        }));
        drawEffectPreview(this.targetingGfx, preview.events);
      } else {
        this.entities!.clearDamagePreview();
      }

      const cost = selectedAbility.cost.red ?? 0;
      this.showCostLabel(entity, cost, entity.energy.red, "#c0392b");
    } else if (selectedAbility?.kind === "barrier") {
      const barrier = selectedAbility as BarrierAbility;
      this.entities!.setBarrierPreview(
        selectedId,
        barrier.barrierHp,
        entity.hp,
        entity.maxHp,
        entity.barrier,
      );
      const cost = selectedAbility.cost.blue ?? 0;
      this.showCostLabel(entity, cost, entity.energy.blue, "#2980b9");
    } else if (selectedAbility?.kind === "zone") {
      const za = selectedAbility as ZoneAbility;
      const usesRed = !!za.cost.red;
      const pool = usesRed ? entity.energy.red : entity.energy.blue;
      // Placement-range ring around the caster.
      this.targetingGfx.circle(entity.position.x, entity.position.y, za.range);
      this.targetingGfx.stroke({ color: 0x4a3728, alpha: 0.22, width: 1.2 });
      const dir = sub(mouseWorld, entity.position);
      if (vecLength(dir) >= 1 && pool >= (za.cost.red ?? za.cost.blue ?? 0)) {
        // Dry-run: a placeable zone yields a zoneCreated event, which drawEffectPreview draws
        // at the clamped centre; an illegal spot (wall on a body / existing wall) yields nothing.
        const preview = resolveAction(state, { type: "ability", entityId: selectedId, abilityId: za.id, aimDirection: dir });
        drawEffectPreview(this.targetingGfx, preview.events);
      }
      const cost = za.cost.red ?? za.cost.blue ?? 0;
      this.showCostLabel(entity, cost, pool, usesRed ? "#c0392b" : "#2980b9");
    } else if (
      selectedAbility?.kind === "move" &&
      entity.energy.blue > 0
    ) {
      const budget = getAffordableMoveDistance(entity);
      // Real (snapped) destination a click commits to; ease the displayed target toward it so the
      // line/marker glide rather than snapping in 12px steps.
      const snapped = reachableArea(entity, state.grid, state.entities, budget).flood.pathTo(mouseWorld, budget);
      this.movePreviewTarget = snapped ? easeToward(this.movePreviewTarget, snapped) : null;
      drawMovePreview(this.moveGfx, entity, this.movePreviewTarget, state);
      // Bill the cost for the real path distance to where the click lands (not the eased point).
      const dist = snapped ? playerMovePath(entity, snapped, state.grid, budget).cost : 0;
      const moveCost = getAbilityCost(selectedAbility, { distance: dist });
      const cost = Math.min(moveCost.blue ?? 0, entity.energy.blue);
      this.showCostLabel(entity, cost, entity.energy.blue, "#2980b9");
    }
  }

  private showCostLabel(entity: { position: Vec2 }, cost: number, pool: number, color: string) {
    this.costLabel.text = `${pool}/${cost}`;
    this.costLabel.style.fill = color;
    this.costLabel.anchor.set(0.5);
    this.costLabel.position.set(entity.position.x, entity.position.y - 55);
    this.costLabel.visible = true;
  }

  private layout() {
    const layoutState = this.clientState.getState();
    if (!layoutState) return;
    const grid = layoutState.grid;
    const worldW = grid.width * grid.cellSize;
    const worldH = grid.height * grid.cellSize;
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;

    this.scale = Math.min(
      (screenW - PADDING * 2) / worldW,
      (screenH - PADDING * 2) / worldH
    );
    this.offsetX = (screenW - worldW * this.scale) / 2;
    this.offsetY = (screenH - worldH * this.scale) / 2;

    this.worldContainer.scale.set(this.scale);
    this.baseOffsetX = this.offsetX;
    this.baseOffsetY = this.offsetY;
    this.worldContainer.position.set(this.offsetX, this.offsetY);

    this.dimGfx.clear();
    this.dimGfx.rect(0, 0, screenW, screenH);
    this.dimGfx.fill({ color: DIM_COLOR, alpha: DIM_ALPHA });

    this.screenFlash.resize(screenW, screenH);

    const combatX = this.offsetX;
    const combatY = this.offsetY;
    const combatW = worldW * this.scale;
    const combatH = worldH * this.scale;

    this.frameGfx.clear();
  }

  private rebuildGrid() {
    this.targetingGfx.removeFromParent();
    this.moveGfx.removeFromParent();
    this.zonesGfx.removeFromParent();
    this.costLabel.removeFromParent();
    for (const child of this.worldContainer.children) {
      child.destroy({ children: true });
    }
    this.worldContainer.removeChildren();
    const state = this.clientState.getState();
    if (!state) return;
    const grid = state.grid;

    const mapImage = state.mapDefinition.mapImage;
    this.backgroundLayer = new Container();
    this.backgroundLayer.addChild(createBackground(grid, mapImage ? mapAssetUrl(mapImage) : undefined));
    this.worldContainer.addChild(this.backgroundLayer);

    // Persistent zone discs sit on the ground, under entities.
    this.worldContainer.addChild(this.zonesGfx);

    this.sortableLayer = new Container();
    this.sortableLayer.sortableChildren = true;
    // Single-image maps carry their structures baked in — skip object compositing.
    this.mapObjectSprites = mapImage ? [] : createMapObjects(state.mapDefinition.objects, grid);
    for (const sprite of this.mapObjectSprites) {
      sprite.zIndex = getBottomY(sprite);
      this.sortableLayer.addChild(sprite);
    }
    this.worldContainer.addChild(this.sortableLayer);

    this.overlayLayer = new Container();
    this.overlayLayer.addChild(this.targetingGfx);
    this.overlayLayer.addChild(this.moveGfx);
    this.overlayLayer.addChild(this.costLabel);
    this.worldContainer.addChild(this.overlayLayer);

    this.debugLayer = new Container();
    this.debugLayer.visible = this.debugVisible;
    this.buildDebugWalls(grid);
    this.worldContainer.addChild(this.debugLayer);
  }

  private buildDebugWalls(grid: GridState) {
    const wallGfx = new Graphics();
    const coverGfx = new Graphics();
    const cs = grid.cellSize;
    for (let cy = 0; cy < grid.height; cy++) {
      for (let cx = 0; cx < grid.width; cx++) {
        const v = grid.walls[cy * grid.width + cx];
        if (v === CELL_WALL) {
          wallGfx.rect(cx * cs, cy * cs, cs, cs);
        } else if (v === CELL_COVER) {
          coverGfx.rect(cx * cs, cy * cs, cs, cs);
        }
      }
    }
    wallGfx.fill({ color: 0xff0000, alpha: 0.45 });
    coverGfx.fill({ color: 0xffaa00, alpha: 0.35 });
    this.debugLayer.addChild(wallGfx);
    this.debugLayer.addChild(coverGfx);
  }
}
