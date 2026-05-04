import type { Vec2 } from "shared";
import { distance, sub, normalize, clampToMovementRange } from "shared";
import type { ClientState } from "../state/client-state.js";
import type { GameRenderer } from "../renderer/game-renderer.js";

export class InputManager {
  mouseWorld: Vec2 = { x: 0, y: 0 };
  private onMouseMove: () => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private clientState: ClientState,
    private renderer: GameRenderer,
    onMouseMove: () => void
  ) {
    this.onMouseMove = onMouseMove;
    this.bind();
  }

  private screenToWorld(e: MouseEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return this.renderer.screenToWorld({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }

  private bind() {
    this.canvas.addEventListener("mousemove", (e) => {
      this.mouseWorld = this.screenToWorld(e);
      this.onMouseMove();
    });

    this.canvas.addEventListener("click", (e) => {
      const pos = this.screenToWorld(e);
      const state = this.clientState.getState();
      if (!state) return;

      if (state.winner) return;

      if (
        this.clientState.inputMode === "attack" &&
        this.clientState.selectedEntityId
      ) {
        this.doAttack(pos);
        return;
      }

      const clicked = this.findEntityAt(pos);
      if (clicked && clicked.teamId === state.activeTeam) {
        this.clientState.selectEntity(clicked.id);
      }
    });

    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const state = this.clientState.getState();
      if (!state || state.winner) return;
      if (!this.clientState.selectedEntityId) return;

      const entity = state.entities.get(this.clientState.selectedEntityId);
      if (!entity) return;

      const pos = this.screenToWorld(e);
      const clamped = clampToMovementRange(entity, pos);

      this.clientState.dispatch({
        type: "move",
        entityId: this.clientState.selectedEntityId,
        destination: clamped,
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "e" || e.key === "E") this.clientState.endTurn();
      if (e.key === "a" || e.key === "A") this.clientState.toggleAttackMode();
      if (e.key === "r" || e.key === "R") this.clientState.reset();
      if (e.key === "Escape") this.clientState.selectEntity(null);
      if (e.key === "F3") {
        e.preventDefault();
        this.clientState.toggleDebugWalls();
      }
    });
  }

  private findEntityAt(pos: Vec2) {
    for (const entity of this.clientState.getState().entities.values()) {
      if (distance(pos, entity.position) <= entity.collisionRadius) {
        return entity;
      }
    }
    return undefined;
  }

  private doAttack(mousePos: Vec2) {
    const entityId = this.clientState.selectedEntityId;
    if (!entityId) return;
    const entity = this.clientState.getState().entities.get(entityId);
    if (!entity) return;

    const dir = sub(mousePos, entity.position);
    const aimDirection = normalize(dir);

    this.clientState.dispatch({
      type: "attack",
      entityId,
      aimDirection,
    });

    if (!this.clientState.getState().entities.has(entityId)) {
      this.clientState.selectEntity(null);
    } else {
      this.clientState.selectEntity(entityId);
    }
  }
}
