import { Application, Container } from "pixi.js";
import type { Vec2 } from "shared";
import type { ClientState } from "../state/client-state.js";
import { createGridGraphics } from "./grid-renderer.js";
import { createEntityGraphics } from "./entity-renderer.js";
import { createTargetingArc } from "./targeting-renderer.js";
import { createMovePreview } from "./move-preview-renderer.js";

export class GameRenderer {
  private worldContainer = new Container();
  private entityLayer = new Container();
  private overlayLayer = new Container();

  constructor(
    private app: Application,
    private clientState: ClientState
  ) {}

  init() {
    this.app.stage.addChild(this.worldContainer);
    this.rebuildGrid();
    this.worldContainer.addChild(this.entityLayer);
    this.worldContainer.addChild(this.overlayLayer);
    this.render();
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
      const arc = createTargetingArc(entity, mouseWorld);
      if (arc) this.overlayLayer.addChild(arc);
    } else if (
      this.clientState.inputMode === "select" &&
      entity.movementRemaining > 1
    ) {
      const preview = createMovePreview(entity, mouseWorld);
      this.overlayLayer.addChild(preview);
    }
  }
}
