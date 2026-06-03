import { Assets } from "pixi.js";
import type { Screen } from "./screen-manager.js";
import type { GameRenderer } from "../renderer/game-renderer.js";
import type { ClientState } from "../state/client-state.js";
import type { CombatStore } from "../state/combat-store.js";
import type { InputManager } from "../input/input-manager.js";
import { AbilityBar } from "../renderer/ability-bar.js";
import { assetUrl } from "../renderer/asset-url.js";

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
    this.combatStore.waitForState().then(async () => {
      this.clientState.autoSelectPlayer();
      // Preload the per-encounter map image so the background is ready on the first frame.
      const mapImage = this.clientState.getState()?.mapDefinition.mapImage;
      if (mapImage) {
        try { await Assets.load(assetUrl(mapImage)); } catch { /* createBackground falls back to async load */ }
      }
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
