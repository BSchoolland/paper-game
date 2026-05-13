import type { Screen } from "./screen-manager.js";
import type { GameRenderer } from "../renderer/game-renderer.js";
import type { ClientState } from "../state/client-state.js";
import type { CombatStore } from "../state/combat-store.js";
import type { InputManager } from "../input/input-manager.js";
import { AbilityBar } from "../renderer/ability-bar.js";

export class CombatScreen implements Screen {
  private abilityBar: AbilityBar;
  private removeMouseListener: (() => void) | null = null;

  constructor(
    private combatRenderer: GameRenderer,
    private clientState: ClientState,
    private combatStore: CombatStore,
    private inputManager: InputManager
  ) {
    this.abilityBar = new AbilityBar(clientState);
  }

  enter() {
    this.combatStore.waitForState().then(() => {
      this.clientState.autoSelectPlayer();
      this.combatRenderer.enter();
      this.inputManager.setEnabled(true);
      this.abilityBar.show();
      this.removeMouseListener = this.inputManager.addMouseMoveListener(
        (mouseWorld) => this.abilityBar.updateMouse(mouseWorld)
      );
    });
  }

  exit() {
    this.inputManager.setEnabled(false);
    if (this.removeMouseListener) {
      this.removeMouseListener();
      this.removeMouseListener = null;
    }
    this.abilityBar.hide();
    this.combatRenderer.exit();
    this.combatStore.resetDisplayState();
  }
}
