import type { Screen } from "./screen-manager.js";
import type { GameRenderer } from "../renderer/game-renderer.js";
import type { ClientState } from "../state/client-state.js";
import type { CombatStore } from "../state/combat-store.js";

export class CombatScreen implements Screen {
  constructor(
    private combatRenderer: GameRenderer,
    private clientState: ClientState,
    private combatStore: CombatStore
  ) {}

  enter() {
    this.clientState.resetSelection();
    this.combatStore.resetDisplayState();
    this.combatStore.waitForState().then(() => {
      this.combatRenderer.enter();
    });
  }

  exit() {
    this.combatRenderer.exit();
  }
}
