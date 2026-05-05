import { Application, Container, Graphics } from "pixi.js";
import type { HexCoord, HexMapState, HexStatus } from "shared";
import { hexToPixel, parseHexKey, pixelToHex, isAdjacent } from "shared";
import { PENCIL, PENCIL_LIGHT, seededRand } from "./sketch-utils.js";
import { HexCamera } from "./hex-camera.js";
import { HexPathTrail } from "./hex-path-trail.js";
import { HexPlayerTween } from "./hex-player-tween.js";

const HEX_SIZE = 48;

const PLAYER_COLOR = 0x8b6d30;
const HOVER_COLOR = 0xd4a850;

function coordSeed(q: number, r: number): number {
  return ((q * 7919 + r * 104729 + 31) & 0xffffffff) >>> 0;
}

export class HexMapRenderer {
  private worldContainer = new Container();
  private hexContainer = new Container();
  private hoverCoord: HexCoord | null = null;
  private mapState: HexMapState | null = null;
  private onHexClickCallback: ((coord: HexCoord) => void) | null = null;

  private camera: HexCamera;
  private pathTrail = new HexPathTrail();
  private playerTween = new HexPlayerTween(HEX_SIZE);

  constructor(private app: Application) {
    this.camera = new HexCamera(app, this.worldContainer);
  }

  init() {
    this.camera.init();

    this.worldContainer.addChild(this.pathTrail.layer);
    this.worldContainer.addChild(this.hexContainer);
    this.worldContainer.addChild(this.playerTween.idleSprite);
    this.worldContainer.addChild(this.playerTween.moveSprite);

    this.app.ticker.add((ticker) => {
      if (!this.playerTween.animating) return;
      const dt = ticker.deltaTime / 60;
      const pos = this.playerTween.tick(dt);
      if (pos) this.pathTrail.drawLive(pos.x, pos.y);
    });

    this.app.canvas.addEventListener("mousemove", (e) => {
      const world = this.camera.screenToWorld(e.clientX, e.clientY);
      const coord = pixelToHex(world.x, world.y, HEX_SIZE);
      const prev = this.hoverCoord;
      if (!prev || prev.q !== coord.q || prev.r !== coord.r) {
        this.hoverCoord = coord;
        if (this.mapState && !this.playerTween.animating) this.drawHexes();
      }
    });

    this.app.canvas.addEventListener("click", (e) => {
      if (!this.mapState || !this.onHexClickCallback || this.playerTween.animating) return;
      const world = this.camera.screenToWorld(e.clientX, e.clientY);
      const coord = pixelToHex(world.x, world.y, HEX_SIZE);
      this.onHexClickCallback(coord);
    });
  }

  onHexClick(cb: (coord: HexCoord) => void) {
    this.onHexClickCallback = cb;
  }

  show() {
    this.camera.show();
  }

  hide() {
    this.camera.hide();
  }

  isMoving(): boolean {
    return this.playerTween.animating;
  }

  onMoveComplete(cb: () => void) {
    this.playerTween.onComplete(cb);
  }

  animateMoveTo(target: HexCoord) {
    if (!this.mapState) return;
    const to = hexToPixel(target, HEX_SIZE);
    this.pathTrail.addPoint(to);
    this.playerTween.startMove(this.mapState.playerPos, target);
  }

  render(state: HexMapState) {
    this.mapState = state;

    const px = hexToPixel(state.playerPos, HEX_SIZE);
    this.camera.centerOn(px.x, px.y);
    this.pathTrail.initIfEmpty(px);

    this.drawHexes();
    this.pathTrail.draw();
    if (!this.playerTween.animating) {
      this.playerTween.placeIdle(px.x, px.y);
    }
  }

  private drawHexes() {
    if (!this.mapState) return;
    this.hexContainer.removeChildren();

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
  }

  private drawHex(
    x: number,
    y: number,
    status: HexStatus,
    isPlayer: boolean,
    isHover: boolean,
    coord: HexCoord
  ) {
    const gfx = new Graphics();
    const seed = coordSeed(coord.q, coord.r);
    const size = HEX_SIZE - 3;

    const points = this.sketchHexPoints(x, y, size, seed);

    if (isPlayer) {
      gfx.poly(points);
      gfx.fill({ color: PLAYER_COLOR, alpha: 0.12 });
      gfx.stroke({ color: PLAYER_COLOR, alpha: 0.7, width: 1.8 });

      this.drawSecondPass(gfx, x, y, size, seed + 1, PLAYER_COLOR, 0.3);
    } else if (status === "explored") {
      gfx.poly(points);
      gfx.fill({ color: PENCIL, alpha: 0.05 });
      gfx.stroke({ color: PENCIL, alpha: 0.45, width: 1.2 });

      this.drawSecondPass(gfx, x, y, size, seed + 1, PENCIL, 0.15);
    } else {
      gfx.poly(points);
      gfx.fill({ color: PENCIL, alpha: 0.03 });
      gfx.stroke({ color: PENCIL_LIGHT, alpha: 0.35, width: 1.0 });
    }

    if (isHover) {
      const hoverPoints = this.sketchHexPoints(x, y, size + 2, seed + 7);
      gfx.poly(hoverPoints);
      gfx.stroke({ color: HOVER_COLOR, alpha: 0.6, width: 2.0 });
    }

    this.hexContainer.addChild(gfx);

    if (status === "unexplored" && !isPlayer) {
      this.drawQuestionMark(x, y, seed);
    }
  }

  private drawSecondPass(
    gfx: Graphics,
    x: number,
    y: number,
    size: number,
    seed: number,
    color: number,
    alpha: number
  ) {
    const points2 = this.sketchHexPoints(x, y, size, seed);
    gfx.poly(points2);
    gfx.stroke({ color, alpha, width: 0.8 });
  }

  private drawQuestionMark(cx: number, cy: number, seed: number) {
    const gfx = new Graphics();
    const rand = seededRand(seed + 500);
    const wobble = 0.6;

    const topY = cy - 10;
    const segments = 12;
    for (let i = 0; i <= segments; i++) {
      const angle = Math.PI + (i / segments) * Math.PI;
      const r = 6 + rand() * wobble;
      const x = cx + Math.cos(angle) * r + rand() * wobble;
      const y = topY + Math.sin(angle) * r + rand() * wobble;
      if (i === 0) gfx.moveTo(x, y);
      else gfx.lineTo(x, y);
    }
    gfx.lineTo(cx + rand() * wobble, cy - 1 + rand() * wobble);
    gfx.lineTo(cx + rand() * wobble, cy + 5 + rand() * wobble);
    gfx.stroke({ color: PENCIL_LIGHT, alpha: 0.5, width: 1.2 });

    gfx.circle(cx + rand() * 0.4, cy + 10 + rand() * 0.4, 1.3);
    gfx.fill({ color: PENCIL_LIGHT, alpha: 0.5 });

    this.hexContainer.addChild(gfx);
  }

  private sketchHexPoints(cx: number, cy: number, size: number, seed: number): number[] {
    const rand = seededRand(seed);
    const wobble = 1.8;
    const pts: number[] = [];
    for (let i = 0; i <= 6; i++) {
      const angle = (Math.PI / 180) * (60 * (i % 6) - 30);
      const vx = cx + Math.cos(angle) * size;
      const vy = cy + Math.sin(angle) * size;
      pts.push(vx + rand() * wobble, vy + rand() * wobble);
    }
    return pts;
  }
}
