import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import type { HexCoord, HexMapState, HexStatus } from "shared";
import { hexToPixel, parseHexKey, pixelToHex, hexKey, isAdjacent } from "shared";

const HEX_SIZE = 48;
const SQRT3 = Math.sqrt(3);

const COLORS = {
  explored: 0x3a5a3a,
  exploredFill: 0x2a3a2a,
  unexplored: 0x6b5a48,
  unexploredFill: 0x3a3028,
  player: 0xd4a850,
  playerFill: 0x8b6d30,
  background: 0x1a140e,
  hoverStroke: 0xf0d890,
} as const;

const labelStyle = new TextStyle({
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontSize: 14,
  fill: 0xf5ebcc,
});

const questionStyle = new TextStyle({
  fontFamily: "Georgia, serif",
  fontSize: 20,
  fill: 0x8a7a60,
});

export class HexMapRenderer {
  private worldContainer = new Container();
  private hexContainer = new Container();
  private playerGfx = new Graphics();
  private hoverCoord: HexCoord | null = null;
  private mapState: HexMapState | null = null;
  private onHexClickCallback: ((coord: HexCoord) => void) | null = null;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor(private app: Application) {}

  init() {
    this.worldContainer.addChild(this.hexContainer);
    this.worldContainer.addChild(this.playerGfx);
    this.app.stage.addChild(this.worldContainer);

    this.app.canvas.addEventListener("mousemove", (e) => {
      const world = this.screenToWorld(e.clientX, e.clientY);
      const coord = pixelToHex(world.x, world.y, HEX_SIZE);
      const prev = this.hoverCoord;
      if (!prev || prev.q !== coord.q || prev.r !== coord.r) {
        this.hoverCoord = coord;
        if (this.mapState) this.draw();
      }
    });

    this.app.canvas.addEventListener("click", (e) => {
      if (!this.mapState || !this.onHexClickCallback) return;
      const world = this.screenToWorld(e.clientX, e.clientY);
      const coord = pixelToHex(world.x, world.y, HEX_SIZE);
      this.onHexClickCallback(coord);
    });
  }

  onHexClick(cb: (coord: HexCoord) => void) {
    this.onHexClickCallback = cb;
  }

  show() {
    this.worldContainer.visible = true;
  }

  hide() {
    this.worldContainer.visible = false;
  }

  render(state: HexMapState) {
    this.mapState = state;
    this.layout();
    this.draw();
  }

  private layout() {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    this.scale = 1;
    this.offsetX = screenW / 2;
    this.offsetY = screenH / 2;
    this.worldContainer.scale.set(this.scale);
    this.worldContainer.position.set(this.offsetX, this.offsetY);
  }

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - this.offsetX) / this.scale,
      y: (sy - rect.top - this.offsetY) / this.scale,
    };
  }

  private draw() {
    if (!this.mapState) return;
    this.hexContainer.removeChildren();
    this.playerGfx.clear();

    const { hexes, playerPos } = this.mapState;

    for (const [key, status] of Object.entries(hexes)) {
      const coord = parseHexKey(key);
      const px = hexToPixel(coord, HEX_SIZE);
      const isPlayer = coord.q === playerPos.q && coord.r === playerPos.r;
      const isHover =
        this.hoverCoord &&
        this.hoverCoord.q === coord.q &&
        this.hoverCoord.r === coord.r;
      const isClickable = isAdjacent(playerPos, coord);

      this.drawHex(px.x, px.y, status, isPlayer, !!isHover && isClickable, coord);
    }

    const playerPx = hexToPixel(playerPos, HEX_SIZE);
    this.drawPlayerToken(playerPx.x, playerPx.y);
  }

  private drawHex(
    x: number,
    y: number,
    status: HexStatus,
    isPlayer: boolean,
    isHover: boolean,
    _coord: HexCoord
  ) {
    const gfx = new Graphics();
    const points = this.hexPoints(x, y, HEX_SIZE - 2);

    let fillColor: number;
    let strokeColor: number;
    let alpha = 1;

    if (isPlayer) {
      fillColor = COLORS.playerFill;
      strokeColor = COLORS.player;
    } else if (status === "explored") {
      fillColor = COLORS.exploredFill;
      strokeColor = COLORS.explored;
    } else {
      fillColor = COLORS.unexploredFill;
      strokeColor = COLORS.unexplored;
      alpha = 0.7;
    }

    gfx.poly(points);
    gfx.fill({ color: fillColor, alpha });
    gfx.stroke({ color: isHover ? COLORS.hoverStroke : strokeColor, width: isHover ? 3 : 2 });

    this.hexContainer.addChild(gfx);

    if (status === "unexplored") {
      const text = new Text({ text: "?", style: questionStyle });
      text.anchor.set(0.5);
      text.position.set(x, y);
      this.hexContainer.addChild(text);
    }
  }

  private drawPlayerToken(x: number, y: number) {
    this.playerGfx.circle(x, y, 12);
    this.playerGfx.fill({ color: COLORS.player });
    this.playerGfx.stroke({ color: 0xf5ebcc, width: 2 });
  }

  private hexPoints(cx: number, cy: number, size: number): number[] {
    const pts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i - 30);
      pts.push(cx + size * Math.cos(angle), cy + size * Math.sin(angle));
    }
    return pts;
  }
}
