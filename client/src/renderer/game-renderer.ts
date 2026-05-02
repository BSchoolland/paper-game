import { Application, Container } from "pixi.js";
import type { Vec2 } from "shared";
import type { ClientState } from "../state/client-state.js";
import { createGridGraphics } from "./grid-renderer.js";
import { createEntityGraphics } from "./entity-renderer.js";
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
    this.render();

    window.addEventListener("resize", () => {
      this.layout();
      this.render();
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
    this.entityLayer.removeChildren();
    const state = this.clientState.getState();

    for (const entity of state.entities.values()) {
      const isSelected = entity.id === this.clientState.selectedEntityId;
      const gfx = createEntityGraphics(entity, isSelected);
      this.entityLayer.addChild(gfx);
    }

    this.renderOverlay({ x: 0, y: 0 });
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
