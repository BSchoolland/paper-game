import type { Vec2 } from "shared";
import { distance, sub, normalize, clampToMovementRange } from "shared";
import type { ClientState } from "../state/client-state.js";
import type { GameRenderer } from "../renderer/game-renderer.js";

export class InputManager {
  mouseWorld: Vec2 = { x: 0, y: 0 };
  private onMouseMove: () => void;
  private enabled = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private clientState: ClientState,
    private renderer: GameRenderer,
    onMouseMove: () => void
  ) {
    this.onMouseMove = onMouseMove;
    this.bind();
  }

  setEnabled(val: boolean) {
    this.enabled = val;
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
      if (!this.enabled) return;
      this.mouseWorld = this.screenToWorld(e);
      this.onMouseMove();
    });

    this.canvas.addEventListener("click", (e) => {
      if (!this.enabled) return;
      const pos = this.screenToWorld(e);
      const state = this.clientState.getState();
      if (!state) return;

      if (state.winner) return;

      if (this.clientState.selectedEntityId) {
        const selectedAbility = this.clientState.getSelectedAbility();
        if (selectedAbility?.kind === "attack") {
          this.doAttack(pos);
          return;
        }
        if (selectedAbility?.kind === "move") {
          const entity = state.entities.get(this.clientState.selectedEntityId);
          if (entity) {
            const clamped = clampToMovementRange(entity, pos);
            this.clientState.dispatch({
              type: "ability",
              entityId: this.clientState.selectedEntityId,
              abilityId: selectedAbility.id,
              destination: clamped,
            });
          }
          return;
        }
      }

      const clicked = this.findEntityAt(pos);
      if (clicked && clicked.teamId === state.activeTeam) {
        this.clientState.selectEntity(clicked.id);
      }
    });

    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!this.enabled) return;
      const state = this.clientState.getState();
      if (!state || state.winner) return;
      if (!this.clientState.selectedEntityId) return;

      const entity = state.entities.get(this.clientState.selectedEntityId);
      if (!entity) return;

      const pos = this.screenToWorld(e);
      const clamped = clampToMovementRange(entity, pos);

      this.clientState.dispatch({
        type: "ability",
        entityId: this.clientState.selectedEntityId,
        abilityId: "move",
        destination: clamped,
      });
    });

    document.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
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
    const state = this.clientState.getState();
    if (!state) return undefined;
    for (const entity of state.entities.values()) {
      if (entity.dead) continue;
      if (distance(pos, entity.position) <= entity.collisionRadius) {
        return entity;
      }
    }
    return undefined;
  }

  private doAttack(mousePos: Vec2) {
    const entityId = this.clientState.selectedEntityId;
    if (!entityId) return;
    const state = this.clientState.getState();
    if (!state) return;
    const entity = state.entities.get(entityId);
    if (!entity) return;

    const dir = sub(mousePos, entity.position);
    const aimDirection = normalize(dir);

    this.clientState.dispatch({
      type: "ability",
      entityId,
      abilityId: this.clientState.selectedAbilityId ?? "punch",
      aimDirection,
    });

    if (!state.entities.has(entityId)) {
      this.clientState.selectEntity(null);
    } else {
      this.clientState.selectEntity(entityId);
    }
  }
}
