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
import { drawTargetingPreview, drawEffectPreview } from "./targeting-renderer.js";
import { drawZones } from "./zone-renderer.js";
import { drawMovePreview } from "./move-preview-renderer.js";
import { ScreenFlash, type FlashOptions } from "./screen-flash.js";
import { CombatCamera } from "./combat-camera.js";
import type { FrameDriver } from "./frame-driver.js";

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
  private camera: CombatCamera;
  private entities: EntityManager | null = null;
  private mapObjectSprites: Sprite[] = [];
  private debugLayer = new Container();
  private debugVisible = false;
  private listenersBound = false;
  private shakeIntensity = 0;
  private shakeTimer = 0;
  private playbackSpeed = 1;
  private lastMouseWorld: Vec2 = { x: 0, y: 0 };
  private screenFlash: ScreenFlash;

  constructor(
    private app: Application,
    private clientState: ClientState,
    private driver: FrameDriver
  ) {
    this.outerContainer.addChild(this.worldContainer);
    this.screenFlash = new ScreenFlash(this.outerContainer);
    this.app.stage.addChild(this.outerContainer);
    this.outerContainer.visible = false;
    this.camera = new CombatCamera(
      this.app.canvas,
      () => ({ width: this.app.screen.width, height: this.app.screen.height }),
      () => {
        this.worldContainer.scale.set(this.camera.scale);
        this.worldContainer.position.set(this.camera.offsetX, this.camera.offsetY);
        this.driver.invalidate();
      },
    );
  }

  flash(opts?: FlashOptions) {
    this.screenFlash.trigger(opts);
    this.wake();
  }

  /** Start the wind-up → strike performance for a defended incoming attack and return its plan
   *  (the defend prompt scores presses against the plan's contact beat). Null if combat isn't
   *  mounted — the caller falls back to a fixed-window prompt. */
  startIncomingAttackPerformance(attackerId: string, attackerPosition: Vec2, aimDirection: Vec2, ability: AttackAbility, targetId?: string): import("./attack-performance.js").AttackPlan | null {
    const state = this.clientState.getState();
    if (!state || !this.entities) return null;
    const targetPos = targetId ? state.entities.get(targetId)?.position : undefined;
    const plan = this.entities.startDefendedAttackPerformance(attackerId, attackerPosition, aimDirection, ability, state, targetPos);
    this.wake();
    return plan;
  }

  /** Raise the guard pose the instant the block input registers (verdict comes at impact). */
  raiseGuard(defenderIds: readonly string[], attackerPosition: Vec2): void {
    if (!this.entities) return;
    this.entities.raiseGuardPose(defenderIds, attackerPosition);
    this.wake();
  }

  /** Predict + play my hero's complete defended outcome on the impact frame (see EntityManager). */
  predictDefendOutcome(attackerId: string, attackerPosition: Vec2, aimDirection: Vec2, ability: AttackAbility, targetId: string, power: number): void {
    const state = this.clientState.getState();
    if (!state || !this.entities) return;
    this.entities.predictDefendOutcome(attackerId, attackerPosition, aimDirection, ability, targetId, power, state);
    this.wake();
  }

  /** Spawn an impact-feedback floating label (CRIT, PARRY, etc.) at a world position. */
  spawnFloatingText(x: number, y: number, message: string, color: number, opts?: import("./floating-text.js").FloatingTextOptions): void {
    if (!this.entities) return;
    this.entities.spawnFloatingText(x, y, message, color, opts);
    this.wake();
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
    this.camera.setEnabled(true);
    const enterState = this.clientState.getState();
    if (enterState) {
      // Open the fight looking at my hero — the camera clamp keeps the map covering the screen.
      const mySeatId = this.clientState.seat.mySeatId;
      const myHero = mySeatId
        ? [...enterState.entities.values()].find((en) => en.controllerId === mySeatId)
        : null;
      if (myHero) this.camera.centerOn(myHero.position);
      this.entities.sync(enterState, this.clientState.selectedEntityId);
      this.zonesGfx.clear();
      drawZones(this.zonesGfx, enterState.zones);
    }
    this.bringToFront();
    this.outerContainer.visible = true;

    if (!this.listenersBound) {
      this.listenersBound = true;
      window.addEventListener("resize", () => {
        if (!this.outerContainer.visible) return;
        this.layout();
        this.renderOverlay(this.lastMouseWorld);
      });
    }

    this.paintAndAnimate();
  }

  exit() {
    this.outerContainer.visible = false;
    this.camera.setEnabled(false);
    if (this.entities) {
      this.entities.destroy();
      this.entities = null;
    }
    // The animation updater sees visible === false next frame and unregisters itself.
    // Repaint once so the now-hidden combat scene actually clears from the canvas.
    this.driver.invalidate();
  }

  /** Advance one frame of combat animation. Registered with the FrameDriver while there is work to
   *  do; returns whether it still needs frames (self-unregisters when the board is idle). */
  private update = (dtSeconds: number): boolean => {
    if (!this.outerContainer.visible || !this.entities) return false;
    const dt = dtSeconds * this.playbackSpeed;

    if (this.screenFlash.active) this.screenFlash.tick(dt);

    if (this.shakeTimer > 0) {
      this.shakeTimer -= dt;
      const progress = Math.max(0, this.shakeTimer / 0.3);
      const magnitude = this.shakeIntensity * progress * 6;
      // eslint-disable-next-line no-restricted-syntax -- visual-only shake jitter, determinism not required
      const shakeX = (Math.random() - 0.5) * 2 * magnitude;
      // eslint-disable-next-line no-restricted-syntax -- visual-only shake jitter, determinism not required
      const shakeY = (Math.random() - 0.5) * 2 * magnitude;
      this.worldContainer.position.set(this.camera.offsetX + shakeX, this.camera.offsetY + shakeY);
      if (this.shakeTimer <= 0) {
        this.worldContainer.position.set(this.camera.offsetX, this.camera.offsetY);
      }
    }

    // While aiming a move, keep redrawing the overlay each frame so the eased target glides to rest
    // even when the mouse is idle.
    if (this.clientState.getSelectedAbility()?.kind === "move" && this.clientState.selectedEntityId) {
      this.renderOverlay(this.lastMouseWorld);
    }

    if (this.entities.isAnimating()) {
      const tickState = this.clientState.getState();
      if (tickState) {
        this.entities.tick(tickState, this.clientState.selectedEntityId, dt);
        this.entities.depthSort();
      }
    }

    return this.hasFrameWork();
  };

  /** Paint the current frame, and start the animation loop if anything still needs to move. */
  private paintAndAnimate(): void {
    this.driver.invalidate();
    if (this.hasFrameWork()) this.driver.requestFrames(this.update);
  }

  /** Start the animation loop after imperatively kicking off an effect (flash, floating text, a
   *  locally-previewed swing) that isn't driven by a state-change render. Self-stops when done. */
  private wake(): void {
    this.driver.requestFrames(this.update);
  }

  /** Whether the combat scene has ongoing per-frame work: an animation, a lingering shake/flash, or
   *  a selected unit whose move-aim preview keeps easing. */
  private hasFrameWork(): boolean {
    if (!this.outerContainer.visible || !this.entities) return false;
    return (
      this.entities.isAnimating() ||
      this.shakeTimer > 0 ||
      this.screenFlash.active ||
      this.clientState.selectedEntityId !== null
    );
  }

  screenToWorld(screenPos: Vec2): Vec2 {
    return this.camera.screenToWorld(screenPos);
  }

  worldToScreen(worldPos: Vec2): Vec2 {
    return this.camera.worldToScreen(worldPos);
  }

  /** A camera drag that just ended suppresses the click it would otherwise fire. */
  consumeSuppressedClick(): boolean {
    return this.camera.consumeSuppressedClick();
  }

  /** Eased camera pan (auto-follow of acting units / defend attackers). */
  panCameraTo(world: Vec2, ms: number): Promise<void> {
    return this.camera.panTo(world, ms);
  }

  /** True if the user has panned/zoomed since the last call — read-and-clear. */
  consumeCameraUserMoved(): boolean {
    return this.camera.consumeUserMoved();
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
    // sync() drains queued events, which may have started animations — kick the loop if so.
    this.paintAndAnimate();
  }

  renderOverlay(mouseWorld: Vec2) {
    this.lastMouseWorld = mouseWorld;
    this.targetingGfx.clear();
    this.moveGfx.clear();
    this.costLabel.visible = false;
    if (this.entities) this.entities.clearDamagePreview();
    this.driver.invalidate();
    const state = this.clientState.getState();
    if (!state) return;

    // Incoming (defended) attacks draw their own progress-ramped telegraph via the attack
    // performance — nothing to overlay here.

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
    this.camera.setWorld(grid.width * grid.cellSize, grid.height * grid.cellSize);
    this.screenFlash.resize(this.app.screen.width, this.app.screen.height);
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
