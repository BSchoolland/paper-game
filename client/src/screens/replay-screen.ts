import type { Screen } from "./screen-manager.js";
import type { GameRenderer } from "../renderer/game-renderer.js";

/** Minimal screen for battle-log playback: just brings up the combat renderer, no HUD or input. */
export class ReplayScreen implements Screen {
  constructor(private renderer: GameRenderer) {}
  enter() { this.renderer.enter(); }
  exit() { this.renderer.exit(); }
}
