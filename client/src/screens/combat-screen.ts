import type { Screen } from "./screen-manager.js";
import type { GameRenderer } from "../renderer/game-renderer.js";
import type { ClientState } from "../state/client-state.js";
import type { CombatStore } from "../state/combat-store.js";
import type { InputManager } from "../input/input-manager.js";
import { AbilityBar } from "../renderer/ability-bar.js";
import { CharacterDisplay } from "../renderer/character-display.js";

export class CombatScreen implements Screen {
  private abilityBar: AbilityBar;
  private characterDisplay: CharacterDisplay;

  constructor(
    private combatRenderer: GameRenderer,
    private clientState: ClientState,
    private combatStore: CombatStore,
    private inputManager: InputManager
  ) {
    this.abilityBar = new AbilityBar(clientState);
    this.characterDisplay = new CharacterDisplay(clientState, combatRenderer);
  }

  enter() {
    this.clientState.resetSelection();
    this.combatStore.waitForState().then(() => {
      this.combatRenderer.enter();
      this.inputManager.setEnabled(true);
      this.abilityBar.show();
      this.characterDisplay.show();
    });
  }

  exit() {
    this.inputManager.setEnabled(false);
    this.abilityBar.hide();
    this.characterDisplay.hide();
    this.combatRenderer.exit();
    this.combatStore.resetDisplayState();
  }
}
