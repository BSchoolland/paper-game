import type { HexMapState } from "shared";
import type { Screen } from "./screen-manager.js";
import type { HexMapRenderer } from "../renderer/hex-map-renderer.js";

export class MapScreen implements Screen {
  constructor(
    private hexRenderer: HexMapRenderer,
    private getHexMapState: () => HexMapState | null
  ) {}

  enter() {
    this.hexRenderer.setInputEnabled(true);
    this.hexRenderer.show();
    const state = this.getHexMapState();
    if (state) this.hexRenderer.render(state);
  }

  exit() {
    this.hexRenderer.hideControls();
    this.hexRenderer.setInputEnabled(false);
    this.hexRenderer.hide();
  }

  suspend() {
    this.hexRenderer.hideControls();
    this.hexRenderer.setInputEnabled(false);
  }

  resume() {
    this.hexRenderer.setInputEnabled(true);
    const state = this.getHexMapState();
    if (state) this.hexRenderer.render(state);
  }
}
