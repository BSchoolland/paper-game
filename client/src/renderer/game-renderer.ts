import { Application, Container, Graphics, Sprite, Text } from "pixi.js";
import type { AttackAbility, BarrierAbility, GameEvent, GridState, Vec2 } from "shared";
import { CELL_WALL, CELL_COVER, clampToMovementRange, distance, getAbilityCost, resolveAction, sub, length as vecLength } from "shared";
import type { ClientState } from "../state/client-state.js";
import {
  createBackground,
  createMapObjects,
  getBottomY,
} from "./grid-renderer.js";
import { EntityManager } from "./entity-manager.js";
import { drawTargetingPreview, drawEffectPreview } from "./targeting-renderer.js";
import { drawMovePreview } from "./move-preview-renderer.js";
import type { FramePacer, PacerToken } from "./frame-pacer.js";

const PADDING = 75;
const DIM_ALPHA = 0.4;
const DIM_COLOR = 0x1a140e;
const BORDER_COLOR = 0x4a3728;
const BORDER_WIDTH = 2;
const SHADOW_COLOR = 0x1a140e;
const SHADOW_BLUR = 18;
const SHADOW_ALPHA = 0.35;

export class GameRenderer {
  private outerContainer = new Container();
  private dimGfx = new Graphics();
  private frameGfx = new Graphics();
  private worldContainer = new Container();
  private backgroundLayer = new Container();
  private sortableLayer = new Container();
  private overlayLayer = new Container();
  private targetingGfx = new Graphics();
  private moveGfx = new Graphics();
  private costLabel = new Text({ text: "", style: { fontSize: 11, fontFamily: "monospace", fontWeight: "bold", fill: 0x4a3728 } });
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private entities: EntityManager | null = null;
  private mapObjectSprites: Sprite[] = [];
  private debugLayer = new Container();
  private debugVisible = false;
  private tickerActive = false;
  private wasAnimating = false;
  private animToken: PacerToken | null = null;
  private selectionToken: PacerToken | null = null;
  private shakeIntensity = 0;
  private shakeTimer = 0;
  private baseOffsetX = 0;
  private baseOffsetY = 0;
  private lastMouseWorld: Vec2 = { x: 0, y: 0 };

  constructor(
    private app: Application,
    private clientState: ClientState,
    private pacer: FramePacer
  ) {
    this.outerContainer.addChild(this.dimGfx);
    this.outerContainer.addChild(this.frameGfx);
    this.outerContainer.addChild(this.worldContainer);
    this.app.stage.addChild(this.outerContainer);
    this.outerContainer.visible = false;
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
    this.entities = new EntityManager(this.sortableLayer);
    this.entities.onShake = (req) => {
      this.shakeIntensity = req.intensity;
      this.shakeTimer = 0.3;
    };
    this.layout();
    const enterState = this.clientState.getState();
    if (enterState) {
      this.entities.sync(enterState, this.clientState.selectedEntityId);
    }
    this.bringToFront();
    this.outerContainer.visible = true;

    if (!this.tickerActive) {
      this.tickerActive = true;
      this.app.ticker.add((ticker) => {
        if (!this.outerContainer.visible || !this.entities) return;
        const dt = ticker.deltaTime / 60;
        const shaking = this.shakeTimer > 0;
        const animating = this.entities.isAnimating() || shaking;
        if (animating !== this.wasAnimating) {
          if (animating) {
            this.animToken = this.pacer.request(60);
          } else {
            this.pacer.release(this.animToken!);
            this.animToken = null;
          }
          this.wasAnimating = animating;
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
    if (this.selectionToken !== null) {
      this.pacer.release(this.selectionToken);
      this.selectionToken = null;
    }
    if (this.animToken !== null) {
      this.pacer.release(this.animToken);
      this.animToken = null;
      this.wasAnimating = false;
    }
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

  pushEvents(events: readonly GameEvent[]) {
    if (this.entities) this.entities.pushEvents(events);
  }

  isAnimating(): boolean {
    return this.entities?.isAnimating() ?? false;
  }

  render() {
    if (!this.entities) return;
    const renderState = this.clientState.getState();
    if (!renderState) return;
    this.entities.sync(renderState, this.clientState.selectedEntityId);
    this.renderOverlay(this.lastMouseWorld);
    this.debugLayer.visible = this.clientState.showDebugWalls;

    const hasSelection = !!this.clientState.selectedEntityId;
    if (hasSelection && this.selectionToken === null) {
      this.selectionToken = this.pacer.request(45);
    } else if (!hasSelection && this.selectionToken !== null) {
      this.pacer.release(this.selectionToken);
      this.selectionToken = null;
    }
  }

  renderOverlay(mouseWorld: Vec2) {
    this.lastMouseWorld = mouseWorld;
    this.targetingGfx.clear();
    this.moveGfx.clear();
    this.costLabel.visible = false;
    if (this.entities) this.entities.clearDamagePreview();
    const state = this.clientState.getState();
    if (!state) return;
    const selectedId = this.clientState.selectedEntityId;

    if (!selectedId || state.winner) return;
    const entity = state.entities.get(selectedId);
    if (!entity || entity.dead) return;

    const selectedAbility = this.clientState.getSelectedAbility();
    if (selectedAbility?.kind === "attack" && entity.energy.red > 0) {
      const atk = selectedAbility as AttackAbility;
      drawTargetingPreview(this.targetingGfx, entity, mouseWorld, state, atk);

      const dir = sub(mouseWorld, entity.position);
      if (vecLength(dir) >= 1) {
        // Dry-run the real resolver: preview = "what events would this action produce".
        // Damage numbers, knockback, pull, status — all derived from the same code path
        // the server runs, so new mechanics are previewed the moment they emit events.
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
    } else if (
      selectedAbility?.kind === "move" &&
      entity.energy.blue > 0
    ) {
      drawMovePreview(this.moveGfx, entity, mouseWorld, state);
      const clamped = clampToMovementRange(entity, mouseWorld);
      const dist = distance(entity.position, clamped);
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

    const combatX = this.offsetX;
    const combatY = this.offsetY;
    const combatW = worldW * this.scale;
    const combatH = worldH * this.scale;

    this.frameGfx.clear();
  }

  private rebuildGrid() {
    this.targetingGfx.removeFromParent();
    this.moveGfx.removeFromParent();
    this.costLabel.removeFromParent();
    for (const child of this.worldContainer.children) {
      child.destroy({ children: true });
    }
    this.worldContainer.removeChildren();
    const state = this.clientState.getState();
    if (!state) return;
    const grid = state.grid;

    this.backgroundLayer = new Container();
    this.backgroundLayer.addChild(createBackground(grid));
    this.worldContainer.addChild(this.backgroundLayer);

    this.sortableLayer = new Container();
    this.sortableLayer.sortableChildren = true;
    this.mapObjectSprites = createMapObjects(state.mapDefinition.objects, grid);
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
