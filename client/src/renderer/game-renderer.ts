import { Application, Container, Graphics, Sprite } from "pixi.js";
import type { Entity, GridState, Vec2 } from "shared";
import { CELL_WALL, CELL_COVER } from "shared";
import type { ClientState } from "../state/client-state.js";
import {
  createBackground,
  createMapObjects,
  getBottomY,
} from "./grid-renderer.js";
import {
  type EntityVisual,
  createEntityVisual,
  updateEntityVisual,
  triggerMove,
  triggerAttack,
  triggerHit,
} from "./entity-renderer.js";
import { createTargetingPreview } from "./targeting-renderer.js";
import { createMovePreview } from "./move-preview-renderer.js";

const PADDING = 60;

export class GameRenderer {
  private worldContainer = new Container();
  private backgroundLayer = new Container();
  private sortableLayer = new Container();
  private overlayLayer = new Container();
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private entityVisuals = new Map<string, EntityVisual>();
  private previousEntities = new Map<string, Entity>();
  private mapObjectSprites: Sprite[] = [];
  private debugLayer = new Container();
  private debugVisible = false;

  constructor(
    private app: Application,
    private clientState: ClientState
  ) {}

  init() {
    this.app.stage.addChild(this.worldContainer);
    this.rebuildGrid();
    this.layout();
    this.syncEntities();

    this.app.ticker.add((ticker) => {
      const dt = ticker.deltaTime / 60;
      this.updateAnimations(dt);
      this.depthSort();
    });

    window.addEventListener("resize", () => {
      this.layout();
      this.renderOverlay({ x: 0, y: 0 });
    });
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

  screenToWorld(screenPos: Vec2): Vec2 {
    return {
      x: (screenPos.x - this.offsetX) / this.scale,
      y: (screenPos.y - this.offsetY) / this.scale,
    };
  }

  rebuildGrid() {
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

    this.overlayLayer = new Container();
    this.worldContainer.addChild(this.overlayLayer);

    this.debugLayer = new Container();
    this.debugLayer.visible = this.debugVisible;
    this.buildDebugWalls(grid);
    this.worldContainer.addChild(this.debugLayer);
  }

  render() {
    this.syncEntities();
    this.renderOverlay({ x: 0, y: 0 });
    this.debugLayer.visible = this.clientState.showDebugWalls;
  }

  private syncEntities() {
    const state = this.clientState.getState();
    const currentEntities = state.entities;

    for (const [id, visual] of this.entityVisuals) {
      if (!currentEntities.has(id)) {
        this.sortableLayer.removeChild(visual.container);
        visual.container.destroy({ children: true });
        this.entityVisuals.delete(id);
      }
    }

    for (const [id, entity] of currentEntities) {
      let visual = this.entityVisuals.get(id);

      if (!visual) {
        visual = createEntityVisual(entity);
        this.entityVisuals.set(id, visual);
        this.sortableLayer.addChild(visual.container);
      }

      const prev = this.previousEntities.get(id);
      if (prev) {
        const dx = entity.position.x - prev.position.x;
        const dy = entity.position.y - prev.position.y;
        if (dx * dx + dy * dy > 1) {
          triggerMove(
            visual,
            prev.position.x,
            prev.position.y,
            entity.position.x,
            entity.position.y
          );
        }

        if (entity.hp < prev.hp) {
          triggerHit(visual);
        }

        if (
          entity.actionsRemaining < prev.actionsRemaining &&
          prev.actionsRemaining > 0
        ) {
          const aimX = this.findAttackTarget(entity, currentEntities);
          triggerAttack(visual, aimX);
        }
      }

      const isSelected = entity.id === this.clientState.selectedEntityId;
      updateEntityVisual(visual, entity, isSelected, 0);
    }

    this.previousEntities = new Map(currentEntities);
  }

  private depthSort() {
    const footOffset = 272 * 0.2 * (1 - 0.75);
    for (const visual of this.entityVisuals.values()) {
      visual.container.zIndex = visual.container.position.y + footOffset;
    }
  }

  private findAttackTarget(
    attacker: Entity,
    entities: ReadonlyMap<string, Entity>
  ): number {
    let closestDist = Infinity;
    let closestX = attacker.position.x + 100;
    for (const e of entities.values()) {
      if (e.teamId === attacker.teamId || e.id === attacker.id) continue;
      const dx = e.position.x - attacker.position.x;
      const dy = e.position.y - attacker.position.y;
      const dist = dx * dx + dy * dy;
      if (dist < closestDist) {
        closestDist = dist;
        closestX = e.position.x;
      }
    }
    return closestX;
  }

  private updateAnimations(dt: number) {
    const state = this.clientState.getState();
    for (const [id, visual] of this.entityVisuals) {
      const entity = state.entities.get(id);
      if (!entity) continue;
      const isSelected = id === this.clientState.selectedEntityId;
      updateEntityVisual(visual, entity, isSelected, dt);
    }
  }

  renderOverlay(mouseWorld: Vec2) {
    this.overlayLayer.removeChildren();
    const state = this.clientState.getState();
    const selectedId = this.clientState.selectedEntityId;

    if (!selectedId || state.winner) return;
    const entity = state.entities.get(selectedId);
    if (!entity) return;

    if (
      this.clientState.inputMode === "attack" &&
      entity.actionsRemaining > 0
    ) {
      const preview = createTargetingPreview(entity, mouseWorld, state);
      if (preview) this.overlayLayer.addChild(preview);
    } else if (
      this.clientState.inputMode === "select" &&
      entity.movementRemaining > 1
    ) {
      const preview = createMovePreview(entity, mouseWorld, state);
      this.overlayLayer.addChild(preview);
    }
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
