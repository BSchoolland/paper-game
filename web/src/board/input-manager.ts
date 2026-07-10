import type { AttackAbility, Vec2 } from "shared";
import { distance, sub, planMove } from "shared";
import type { ClientState } from "./client-state.svelte.js";
import { isSelfCastAbility } from "./combat-ui-state.js";
import type { GameRenderer } from "./render/game-renderer.js";
import { TimingBar } from "./timing-bar.js";
import { attackPowerLabel, PERFECT_ATTACK_THRESHOLD } from "./render/impact-labels.js";

export class InputManager {
  mouseWorld: Vec2 = { x: 0, y: 0 };
  private onMouseMove: () => void;
  private enabled = false;
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
      if (this.renderer.consumeSuppressedClick()) return;
      const pos = this.screenToWorld(e);
      const state = this.clientState.getState();
      if (!state || state.winner || !this.clientState.canAcceptPlayerInput()) return;

      const selectedAbility = this.clientState.getSelectedAbility();
      if (
        selectedAbility?.kind === "attack" ||
        selectedAbility?.kind === "zone" ||
        selectedAbility?.kind === "summon"
      ) {
        this.doAimedAbility(pos);
        return;
      }
      if (selectedAbility && isSelfCastAbility(selectedAbility)) {
        this.clientState.confirmAbility();
        return;
      }
      if (selectedAbility?.kind === "move" && this.clientState.selectedEntityId) {
        const entity = state.entities.get(this.clientState.selectedEntityId);
        if (entity && this.clientState.canSelectAbility(selectedAbility.id)) {
          // Snap the click to the nearest reachable stop within move range — the same shared ruler
          // the server validates against — so dense maps don't require pixel-perfect clicks.
          // Ignore the click only when nothing is reachable near it.
          const plan = planMove(entity, pos, state.grid, state.entities);
          if (!plan) return;
          this.clientState.submitAction({
            type: "ability",
            entityId: this.clientState.selectedEntityId,
            abilityId: selectedAbility.id,
            destination: plan.dest,
          });
        }
      }
    });

    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    document.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      // Reset aborts the whole encounter for the party — host-only, and only when it's my turn to
      // act (so a stray keypress during the enemy phase / another player's animation does nothing).
      if ((e.key === "r" || e.key === "R") && this.clientState.seat.isHost() && this.clientState.canAcceptPlayerInput()) {
        this.clientState.resetEncounter();
      }
      if (e.key === "Escape") this.clientState.selectAbility(null);
      if (e.key === "F3") {
        e.preventDefault();
        this.clientState.toggleDebugWalls();
      }

      if (!this.clientState.canAcceptPlayerInput()) return;

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
    if (index >= abilities.length) return;
    const ability = abilities[index]!;
    // Second press on a self-cast commits it; second press on anything else deselects
    // (mirrors the dock slot). selectAbility itself owns the self-cast confirm path.
    if (this.clientState.selectedAbilityId === ability.id && !isSelfCastAbility(ability)) {
      this.clientState.selectAbility(null);
      return;
    }
    this.clientState.selectAbility(ability.id);
  }

  /** Fire the selected aim-at-a-point ability (attack, zone, or summon) toward `mousePos`. */
  private doAimedAbility(mousePos: Vec2) {
    const entityId = this.clientState.selectedEntityId;
    if (!entityId) return;
    const state = this.clientState.getState();
    if (!state) return;
    const entity = state.entities.get(entityId);
    if (!entity || !this.clientState.canAcceptPlayerInput()) return;

    const aimDirection = sub(mousePos, entity.position);
    const abilityId = this.clientState.selectedAbilityId ?? entity.abilities.find(a => a.kind === "attack")?.id ?? "punch";
    const ability = entity.abilities.find(a => a.id === abilityId);

    if (ability?.kind === "attack") {
      if (!this.clientState.beginAttackTiming(entityId, abilityId, aimDirection)) return;
      this.enabled = false;
      this.timingBar.run((ability as AttackAbility).shape.kind).then((power) => {
        if (this.clientState.ui.tag !== "attackTiming") {
          this.enabled = true;
          return;
        }
        const label = attackPowerLabel(power);
        if (label) {
          this.renderer.spawnFloatingText(entity.position.x, entity.position.y - 55, label.text, label.color, {
            fontSize: label.fontSize,
            lifetime: label.lifetime,
            strokeColor: label.strokeColor,
            strokeWidth: label.strokeWidth,
            fontWeight: label.fontWeight,
            fontFamily: label.fontFamily,
          });
        }
        if (power >= PERFECT_ATTACK_THRESHOLD) {
          // Warm amber tint to differentiate the offensive perfect from the cream perfect-block.
          this.renderer.flash({ intensity: 0.55, duration: 0.2, color: 0xffd080 });
        }
        this.clientState.finishAttackTiming(power);
        this.enabled = true;
      });
      return;
    }

    if (!this.clientState.canSelectAbility(abilityId)) return;
    this.clientState.submitAction({
      type: "ability",
      entityId,
      abilityId,
      aimDirection,
    });
  }
}
