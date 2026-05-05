import { Application, Container, Graphics, Sprite, Texture, Assets } from "pixi.js";

export class HexCamera {
  private bgSprite: Sprite | null = null;
  private maskGfx = new Graphics();
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor(private app: Application, private worldContainer: Container) {}

  init() {
    const bgTex: Texture = Assets.get("map-background");
    this.bgSprite = new Sprite(bgTex);
    this.bgSprite.anchor.set(0.5);
    this.app.stage.addChild(this.bgSprite);

    this.app.stage.addChild(this.worldContainer);

    this.worldContainer.mask = this.maskGfx;
    this.app.stage.addChild(this.maskGfx);
  }

  show() {
    if (this.bgSprite) this.bgSprite.visible = true;
    this.worldContainer.visible = true;
  }

  hide() {
    if (this.bgSprite) this.bgSprite.visible = false;
    this.worldContainer.visible = false;
  }

  centerOn(worldX: number, worldY: number) {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;

    if (this.bgSprite) {
      this.bgSprite.position.set(screenW / 2, screenH / 2);
    }

    this.scale = 1;
    this.offsetX = screenW / 2 - worldX * this.scale;
    this.offsetY = screenH / 2 - worldY * this.scale;
    this.worldContainer.scale.set(this.scale);
    this.worldContainer.position.set(this.offsetX, this.offsetY);

    this.maskGfx.clear();
    this.maskGfx.rect(0, 0, screenW, screenH);
    this.maskGfx.fill({ color: 0xffffff });
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - this.offsetX) / this.scale,
      y: (sy - rect.top - this.offsetY) / this.scale,
    };
  }
}
