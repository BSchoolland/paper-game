import type { Vec2 } from "shared";
import { distance, sub, clampToMovementRange } from "shared";
import type { ClientState } from "../state/client-state.js";
import type { GameRenderer } from "../renderer/game-renderer.js";
import { TimingBar } from "../renderer/timing-bar.js";

export class InputManager {
  mouseWorld: Vec2 = { x: 0, y: 0 };
  private onMouseMove: () => void;
  private enabled = false;
  private mouseMoveListeners: ((mouseWorld: Vec2) => void)[] = [];
  private timingBar: TimingBar;

  constructor(
    private canvas: HTMLCanvasElement,
    private clientState: ClientState,
    private renderer: GameRenderer,
    onMouseMove: () => void
  ) {
    this.onMouseMove = onMouseMove;
    this.timingBar = new TimingBar(clientState);
    this.timingBar.setRenderer(renderer);
    this.bind();
  }

  setEnabled(val: boolean) {
    this.enabled = val;
  }

  addMouseMoveListener(listener: (mouseWorld: Vec2) => void): () => void {
    this.mouseMoveListeners.push(listener);
    return () => {
      this.mouseMoveListeners = this.mouseMoveListeners.filter(l => l !== listener);
    };
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
      for (const listener of this.mouseMoveListeners) listener(this.mouseWorld);
    });

    this.canvas.addEventListener("click", (e) => {
      if (!this.enabled) return;
      const pos = this.screenToWorld(e);
      const state = this.clientState.getState();
      if (!state || state.winner) return;

      const selectedAbility = this.clientState.getSelectedAbility();
      if (selectedAbility?.kind === "attack" || selectedAbility?.kind === "zone") {
        this.doAimedAbility(pos);
        return;
      }
      if (selectedAbility?.kind === "barrier") {
        this.clientState.confirmAbility();
        return;
      }
      if (selectedAbility?.kind === "move" && this.clientState.selectedEntityId) {
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
      }
    });

    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    this.canvas.addEventListener("wheel", (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      this.cycleAbility(dir);
    }, { passive: false });

    document.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      if (e.key === "r" || e.key === "R") this.clientState.reset();
      if (e.key === "Escape") this.clientState.selectAbility(null);
      if (e.key === "F3") {
        e.preventDefault();
        this.clientState.toggleDebugWalls();
      }

      const numKey = parseInt(e.key);
      if (numKey >= 1 && numKey <= 9) {
        this.selectAbilityByIndex(numKey - 1);
      }
    });
  }

  private getPlayerAbilities() {
    const state = this.clientState.getState();
    if (!state || !this.clientState.selectedEntityId) return [];
    const entity = state.entities.get(this.clientState.selectedEntityId);
    return entity?.abilities ?? [];
  }

  private selectAbilityByIndex(index: number) {
    const abilities = this.getPlayerAbilities();
    if (index < abilities.length) {
      const ability = abilities[index]!;
      this.clientState.selectAbility(ability.id);
    }
  }

  private cycleAbility(dir: number) {
    const abilities = this.getPlayerAbilities();
    if (abilities.length === 0) return;

    const currentId = this.clientState.selectedAbilityId;
    let currentIndex = abilities.findIndex(a => a.id === currentId);
    if (currentIndex === -1) {
      currentIndex = dir > 0 ? 0 : abilities.length - 1;
    } else {
      currentIndex = (currentIndex + dir + abilities.length) % abilities.length;
    }
    this.clientState.selectAbility(abilities[currentIndex]!.id);
  }

  /** Fire the selected aim-at-a-point ability (attack or zone placement) toward `mousePos`. */
  private doAimedAbility(mousePos: Vec2) {
    const entityId = this.clientState.selectedEntityId;
    if (!entityId) return;
    const state = this.clientState.getState();
    if (!state) return;
    const entity = state.entities.get(entityId);
    if (!entity) return;

    const aimDirection = sub(mousePos, entity.position);
    const abilityId = this.clientState.selectedAbilityId ?? entity.abilities.find(a => a.kind === "attack")?.id ?? "punch";
    const ability = entity.abilities.find(a => a.id === abilityId);

    if (ability?.kind === "attack") {
      this.enabled = false;
      this.clientState.timingAim = aimDirection;
      this.timingBar.run().then((power) => {
        this.clientState.dispatch({
          type: "ability",
          entityId,
          abilityId,
          aimDirection,
          power,
        });
        this.enabled = true;
      });
      return;
    }

    this.clientState.dispatch({
      type: "ability",
      entityId,
      abilityId,
      aimDirection,
    });
  }
}
