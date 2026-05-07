import type { Screen } from "./screen-manager.js";
import type { GameRenderer } from "../renderer/game-renderer.js";
import type { ClientState } from "../state/client-state.js";
import type { CombatStore } from "../state/combat-store.js";
import type { InputManager } from "../input/input-manager.js";

export class CombatScreen implements Screen {
  constructor(
    private combatRenderer: GameRenderer,
    private clientState: ClientState,
    private combatStore: CombatStore,
    private inputManager: InputManager
  ) {}

  enter() {
    this.clientState.resetSelection();
    this.combatStore.waitForState().then(() => {
      this.combatRenderer.enter();
      this.inputManager.setEnabled(true);
    });
  }

  exit() {
    this.inputManager.setEnabled(false);
    this.combatRenderer.exit();
    this.combatStore.resetDisplayState();
  }
}
