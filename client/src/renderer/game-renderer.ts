import { Application, Container } from "pixi.js";
import type { Entity, Vec2 } from "shared";
import type { ClientState } from "../state/client-state.js";
import { createGridGraphics } from "./grid-renderer.js";
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
  private entityLayer = new Container();
  private overlayLayer = new Container();
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private entityVisuals = new Map<string, EntityVisual>();
  private previousEntities = new Map<string, Entity>();

  constructor(
    private app: Application,
    private clientState: ClientState
  ) {}

  init() {
    this.app.stage.addChild(this.worldContainer);
    this.rebuildGrid();
    this.worldContainer.addChild(this.entityLayer);
    this.worldContainer.addChild(this.overlayLayer);
    this.layout();
    this.syncEntities();

    this.app.ticker.add((ticker) => {
      const dt = ticker.deltaTime / 60;
      this.updateAnimations(dt);
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
    const gridGraphics = createGridGraphics(this.clientState.getState().grid);
    this.worldContainer.addChild(gridGraphics);
    this.entityLayer = new Container();
    this.overlayLayer = new Container();
    this.worldContainer.addChild(this.entityLayer);
    this.worldContainer.addChild(this.overlayLayer);
  }

  render() {
    this.syncEntities();
    this.renderOverlay({ x: 0, y: 0 });
  }

  private syncEntities() {
    const state = this.clientState.getState();
    const currentEntities = state.entities;

    for (const [id, visual] of this.entityVisuals) {
      if (!currentEntities.has(id)) {
        this.entityLayer.removeChild(visual.container);
        visual.container.destroy({ children: true });
        this.entityVisuals.delete(id);
      }
    }

    for (const [id, entity] of currentEntities) {
      let visual = this.entityVisuals.get(id);

      if (!visual) {
        visual = createEntityVisual(entity);
        this.entityVisuals.set(id, visual);
        this.entityLayer.addChild(visual.container);
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
}
