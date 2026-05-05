import { Application, Container, Graphics, Sprite } from "pixi.js";
import type { GameEvent, GridState, Vec2 } from "shared";
import { CELL_WALL, CELL_COVER } from "shared";
import type { ClientState } from "../state/client-state.js";
import {
  createBackground,
  createMapObjects,
  getBottomY,
} from "./grid-renderer.js";
import { EntityManager } from "./entity-manager.js";
import { drawTargetingPreview } from "./targeting-renderer.js";
import { drawMovePreview } from "./move-preview-renderer.js";
import type { FramePacer, PacerToken } from "./frame-pacer.js";

const PADDING = 15;
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
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private entities: EntityManager;
  private mapObjectSprites: Sprite[] = [];
  private debugLayer = new Container();
  private debugVisible = false;
  private tickerActive = false;
  private wasAnimating = false;
  private animToken: PacerToken | null = null;
  private selectionToken: PacerToken | null = null;

  constructor(
    private app: Application,
    private clientState: ClientState,
    private pacer: FramePacer
  ) {
    this.entities = new EntityManager(this.sortableLayer);
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
    this.rebuildGrid();
    this.layout();
    this.entities.sync(
      this.clientState.getState(),
      this.clientState.selectedEntityId
    );
    this.bringToFront();
    this.outerContainer.visible = true;

    if (!this.tickerActive) {
      this.tickerActive = true;
      this.app.ticker.add((ticker) => {
        if (!this.outerContainer.visible) return;
        const animating = this.entities.isAnimating();
        if (animating !== this.wasAnimating) {
          if (animating) {
            this.animToken = this.pacer.request(60);
          } else {
            this.pacer.release(this.animToken!);
            this.animToken = null;
          }
          this.wasAnimating = animating;
        }
        if (!animating) return;
        const dt = ticker.deltaTime / 60;
        this.entities.tick(
          this.clientState.getState(),
          this.clientState.selectedEntityId,
          dt
        );
        this.entities.depthSort();
      });

      window.addEventListener("resize", () => {
        if (!this.outerContainer.visible) return;
        this.layout();
        this.renderOverlay({ x: 0, y: 0 });
      });
    }
  }

  exit() {
    this.outerContainer.visible = false;
    if (this.selectionToken !== null) {
      this.pacer.release(this.selectionToken);
      this.selectionToken = null;
    }
  }

  screenToWorld(screenPos: Vec2): Vec2 {
    return {
      x: (screenPos.x - this.offsetX) / this.scale,
      y: (screenPos.y - this.offsetY) / this.scale,
    };
  }

  pushEvents(events: readonly GameEvent[]) {
    this.entities.pushEvents(events);
  }

  isAnimating(): boolean {
    return this.entities.isAnimating();
  }

  render() {
    this.entities.sync(
      this.clientState.getState(),
      this.clientState.selectedEntityId
    );
    this.renderOverlay({ x: 0, y: 0 });
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
    this.targetingGfx.clear();
    this.moveGfx.clear();
    const state = this.clientState.getState();
    if (!state) return;
    const selectedId = this.clientState.selectedEntityId;

    if (!selectedId || state.winner) return;
    const entity = state.entities.get(selectedId);
    if (!entity || entity.dead) return;

    if (
      this.clientState.inputMode === "attack" &&
      entity.actionsRemaining > 0
    ) {
      drawTargetingPreview(this.targetingGfx, entity, mouseWorld, state);
    } else if (
      this.clientState.inputMode === "select" &&
      entity.movementRemaining > 1
    ) {
      drawMovePreview(this.moveGfx, entity, mouseWorld, state);
    }
  }

  private layout() {
    const grid = this.clientState.getState().grid;
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
    this.worldContainer.position.set(this.offsetX, this.offsetY);

    this.dimGfx.clear();
    this.dimGfx.rect(0, 0, screenW, screenH);
    this.dimGfx.fill({ color: DIM_COLOR, alpha: DIM_ALPHA });

    const combatX = this.offsetX;
    const combatY = this.offsetY;
    const combatW = worldW * this.scale;
    const combatH = worldH * this.scale;

    this.frameGfx.clear();
    for (let i = 3; i >= 1; i--) {
      const spread = i * (SHADOW_BLUR / 3);
      const alpha = SHADOW_ALPHA * (1 - i / 4);
      this.frameGfx.roundRect(
        combatX - spread, combatY - spread,
        combatW + spread * 2, combatH + spread * 2,
        4
      );
      this.frameGfx.fill({ color: SHADOW_COLOR, alpha });
    }
    this.frameGfx.roundRect(combatX, combatY, combatW, combatH, 2);
    this.frameGfx.stroke({ color: BORDER_COLOR, alpha: 0.6, width: BORDER_WIDTH });
  }

  private rebuildGrid() {
    this.targetingGfx.removeFromParent();
    this.moveGfx.removeFromParent();
    for (const child of this.worldContainer.children) {
      child.destroy({ children: true });
    }
    this.worldContainer.removeChildren();
    const state = this.clientState.getState();
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
    this.entities.setLayer(this.sortableLayer);

    this.overlayLayer = new Container();
    this.overlayLayer.addChild(this.targetingGfx);
    this.overlayLayer.addChild(this.moveGfx);
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
