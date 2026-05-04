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

const PADDING = 60;

export class GameRenderer {
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

  constructor(
    private app: Application,
    private clientState: ClientState
  ) {
    this.entities = new EntityManager(this.sortableLayer);
    this.app.stage.addChild(this.worldContainer);
    this.worldContainer.visible = false;
  }

  enter() {
    this.rebuildGrid();
    this.layout();
    this.entities.sync(
      this.clientState.getState(),
      this.clientState.selectedEntityId
    );
    this.worldContainer.visible = true;

    if (!this.tickerActive) {
      this.tickerActive = true;
      this.app.ticker.add((ticker) => {
        if (!this.worldContainer.visible) return;
        const dt = ticker.deltaTime / 60;
        this.entities.tick(
          this.clientState.getState(),
          this.clientState.selectedEntityId,
          dt
        );
        this.entities.depthSort();
      });

      window.addEventListener("resize", () => {
        if (!this.worldContainer.visible) return;
        this.layout();
        this.renderOverlay({ x: 0, y: 0 });
      });
    }
  }

  exit() {
    this.worldContainer.visible = false;
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
  }

  renderOverlay(mouseWorld: Vec2) {
    this.targetingGfx.clear();
    this.moveGfx.clear();
    const state = this.clientState.getState();
    if (!state) return;
    const selectedId = this.clientState.selectedEntityId;

    if (!selectedId || state.winner) return;
    const entity = state.entities.get(selectedId);
    if (!entity) return;

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
