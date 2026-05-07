import type { Screen } from "./screen-manager.js";
import type { HexMapRenderer } from "../renderer/hex-map-renderer.js";

export class MapScreen implements Screen {
  constructor(private hexRenderer: HexMapRenderer) {}

  enter() {
    this.hexRenderer.setInputEnabled(true);
    this.hexRenderer.show();
  }

  exit() {
    this.hexRenderer.hideControls();
    this.hexRenderer.setInputEnabled(false);
    this.hexRenderer.hide();
  }
}
