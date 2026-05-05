import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Texture,
} from "pixi.js";
import type { HexCoord, HexIconType, HexMapState, HexStatus } from "shared";
import { hexToPixel, hexNeighbors, hexKey, parseHexKey, pixelToHex, isAdjacent, HEX_ICON_TYPES } from "shared";
import { PENCIL, PENCIL_LIGHT } from "./sketch-utils.js";
import { HexCamera } from "./hex-camera.js";
import { HexPathTrail } from "./hex-path-trail.js";
import { HexPlayerTween } from "./hex-player-tween.js";

const HEX_SIZE = 48;

const PLAYER_COLOR = 0x8b6d30;
const HOVER_COLOR = 0xd4a850;

const ICON_SIZE = 72;
const DECORATION_SCALE = 0.6;
const DECORATION_DENSITY = 1 / 3;
const DECORATION_TINT = 0xc6c0ac;

const iconTextures = new Map<HexIconType, Texture>();
const decorationTextures = new Map<string, Texture>();
let decorationNames: string[] = [];

export async function loadMapIconAssets(): Promise<void> {
  const entries = HEX_ICON_TYPES.map((name) => ({
    alias: `map-icon-${name}`,
    src: `sprites/map-icons/${name}.png`,
  }));

  const manifestResponse = await fetch("sprites/map-decorations/manifest.json");
  const loadedDecorationNames = (await manifestResponse.json()) as string[];
  const decorationEntries = loadedDecorationNames.map((name) => ({
    alias: `map-decoration-${name}`,
    src: `sprites/map-decorations/${name}.png`,
  }));

  await Assets.load([...entries, ...decorationEntries]);
  for (const name of HEX_ICON_TYPES) {
    iconTextures.set(name, Assets.get(`map-icon-${name}`));
  }
  decorationNames = loadedDecorationNames;
  for (const name of decorationNames) {
    decorationTextures.set(name, Assets.get(`map-decoration-${name}`));
  }
}

export class HexMapRenderer {
  private worldContainer = new Container();
  private hexContainer = new Container();
  private decorationContainer = new Container();
  private iconContainer = new Container();
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
    this.worldContainer.addChild(this.decorationContainer);
    this.worldContainer.addChild(this.iconContainer);
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
    this.decorationContainer.removeChildren();
    this.iconContainer.removeChildren();

    const { hexes, playerPos, icons } = this.mapState;

    // Only draw hex outlines for the player hex and its neighbors
    const nearPlayer = new Set<string>();
    nearPlayer.add(hexKey(playerPos));
    for (const n of hexNeighbors(playerPos)) {
      nearPlayer.add(hexKey(n));
    }

    for (const [key, status] of Object.entries(hexes)) {
      const coord = parseHexKey(key);
      const px = hexToPixel(coord, HEX_SIZE);
      const isPlayer = coord.q === playerPos.q && coord.r === playerPos.r;
      const isHover =
        this.hoverCoord &&
        this.hoverCoord.q === coord.q &&
        this.hoverCoord.r === coord.r;
      const isClickable = isAdjacent(playerPos, coord);
      const iconType = icons?.[key];
      const showHex = nearPlayer.has(key);

      this.drawHex(px.x, px.y, status, isPlayer, !!isHover && isClickable, coord, iconType, showHex);
    }
  }

  private drawHex(
    x: number,
    y: number,
    status: HexStatus,
    isPlayer: boolean,
    isHover: boolean,
    coord: HexCoord,
    iconType: HexIconType | undefined,
    showHex: boolean
  ) {
    const gfx = new Graphics();
    const size = HEX_SIZE;
    const points = this.exactHexPoints(x, y, size);

    if (showHex) {
      if (isPlayer) {
        gfx.poly(points);
        gfx.fill({ color: PLAYER_COLOR, alpha: 0.12 });
        gfx.stroke({ color: PLAYER_COLOR, alpha: 0.7, width: 1.8 });
      } else if (status === "explored") {
        gfx.poly(points);
        gfx.fill({ color: PENCIL, alpha: 0.05 });
        gfx.stroke({ color: PENCIL, alpha: 0.45, width: 1.2 });
      } else {
        gfx.poly(points);
        gfx.fill({ color: PENCIL, alpha: 0.03 });
        gfx.stroke({ color: PENCIL_LIGHT, alpha: 0.35, width: 1.0 });
      }

      if (isHover) {
        const hoverPoints = this.exactHexPoints(x, y, size + 2);
        gfx.poly(hoverPoints);
        gfx.stroke({ color: HOVER_COLOR, alpha: 0.6, width: 2.0 });
      }
    } else {
      gfx.poly(points);
      gfx.fill({ color: PENCIL, alpha: 0.02 });
      gfx.stroke({ color: PENCIL_LIGHT, alpha: 0.25, width: 0.75 });
    }

    this.hexContainer.addChild(gfx);

    if (!iconType && !isPlayer) {
      this.drawDecoration(x, y, coord, status);
    }

    if (iconType) {
      const tex = iconTextures.get(iconType);
      if (tex) {
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5, 0.5);
        sprite.x = x;
        sprite.y = y;
        const scale = ICON_SIZE / Math.max(tex.width, tex.height);
        sprite.scale.set(scale);
        if (status === "unexplored" || isPlayer) {
          sprite.alpha = 0.4;
        }
        this.iconContainer.addChild(sprite);
      }
    }
  }

  private drawDecoration(x: number, y: number, coord: HexCoord, status: HexStatus) {
    if (decorationNames.length === 0) return;

    const densityRoll = this.seededUnit(coord, 11);
    if (densityRoll > DECORATION_DENSITY) return;

    const index = Math.floor(this.seededUnit(coord, 23) * decorationNames.length);
    const name = decorationNames[index];
    if (!name) return;

    const tex = decorationTextures.get(name);
    if (!tex) return;

    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5, 0.78);
    sprite.x = x + (this.seededUnit(coord, 37) - 0.5) * HEX_SIZE * 0.42;
    sprite.y = y + (this.seededUnit(coord, 41) - 0.5) * HEX_SIZE * 0.34 + HEX_SIZE * 0.16;
    sprite.scale.set(DECORATION_SCALE);
    sprite.tint = DECORATION_TINT;
    sprite.alpha = status === "unexplored" ? 0.38 : 0.62;
    this.decorationContainer.addChild(sprite);
  }

  private seededUnit(coord: HexCoord, salt: number): number {
    let seed = Math.imul(coord.q, 374761393) ^ Math.imul(coord.r, 668265263) ^ Math.imul(salt, 2246822519);
    seed = Math.imul(seed ^ (seed >>> 13), 1274126177);
    return ((seed ^ (seed >>> 16)) >>> 0) / 0xffffffff;
  }

  private exactHexPoints(cx: number, cy: number, size: number): number[] {
    const pts: number[] = [];
    for (let i = 0; i <= 6; i++) {
      const angle = (Math.PI / 180) * (60 * (i % 6) - 30);
      pts.push(cx + Math.cos(angle) * size, cy + Math.sin(angle) * size);
    }
    return pts;
  }
}
