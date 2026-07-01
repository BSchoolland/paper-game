/**
 * Shared presentational kit for the full-screen menu surfaces (home / staging lobby / game over).
 *
 * Pure DOM-creating helpers + design tokens — no game or network logic. Screens wire clicks and
 * connection events themselves. Visual direction: "Modern game-menu polish" — dark slate-and-leather
 * panels over a painted map backdrop behind a warm vignette, crisp gold keylines and corner ornaments,
 * Cinzel display headers over a clean Inter body, generous padding, wide 2-column layouts.
 */

import type { StarterPreset } from "shared";
import { titleById } from "shared";
import { assetUrl, mapAssetUrl } from "../renderer/asset-url.js";

export const THEME = {
  // surfaces
  ink: "#1a1410",
  slate: "#211b16",
  slate2: "#2b231c",
  leather: "#3a2f25",
  deep: "#0b0906",
  // text
  parch: "#f1e7d2",
  parchHi: "#fffaf0",
  muted: "#b8a994",
  faint: "#8a7a68",
  // accents
  gold: "#e8c87a",
  goldDeep: "#b8893a",
  goldLine: "rgba(184,137,58,0.55)",
  green: "#7bb04a",
  greenDeep: "#4c7a2e",
  greenBright: "#4caf50",
  danger: "#c75a4a",
  dangerDeep: "#8b3a3a",

  // spacing (8px rhythm)
  cardPad: "24px",
  gap: "14px",
  sectionGap: "18px",
  tight: "6px",
} as const;

export const FONT = {
  cinzel: '"Cinzel", serif',
  body: '"Inter", "Segoe UI", system-ui, sans-serif',
  /** kept for back-compat; the redesign no longer uses monospace for chrome. */
  mono: '"Inter", "Segoe UI", system-ui, sans-serif',
} as const;

const cinzel = FONT.cinzel;
const body = FONT.body;

const MAP_SCENE: Record<"home" | "lobby" | "gameover", string> = {
  home: "/sprites/maps/dimension-0/gateway-city-0.png",
  lobby: "/sprites/maps/dimension-0/town-0.png",
  gameover: "/sprites/maps/dimension-0/great-ruins-0.png",
};

/** Loads Inter once (Cinzel is loaded by the host page / harness). */
function ensureFonts(): void {
  if (document.getElementById("menu-inter-font")) return;
  const link = document.createElement("link");
  link.id = "menu-inter-font";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
  document.head.appendChild(link);
}

/**
 * Full-bleed atmosphere layer. Insert as the FIRST child of a screen container (container itself
 * should be `background:#0b0906`). A scaled painted map under a warm center-glowing vignette; the
 * panel is pulled in so more painted backdrop shows around the edges. gameover mixes a red tint.
 */
export function boardBackdrop(scene: "home" | "lobby" | "gameover"): HTMLDivElement {
  ensureFonts();
  const layer = document.createElement("div");
  layer.style.cssText = `position:absolute; inset:0; overflow:hidden; pointer-events:none;`;

  const map = document.createElement("div");
  map.style.cssText = `
    position:absolute; inset:0;
    background:url(${mapAssetUrl(MAP_SCENE[scene])}) center/cover no-repeat;
    transform:scale(1.06);
    filter:saturate(0.92) brightness(0.78);
  `;

  const redTint = scene === "gameover" ? ", rgba(40,8,8,.28)" : "";
  const vignette = document.createElement("div");
  vignette.style.cssText = `
    position:absolute; inset:0;
    background:
      radial-gradient(120% 90% at 50% 35%, rgba(11,9,6,0.10) 0%, rgba(11,9,6,0.48) 55%, rgba(7,5,3,0.90) 100%${redTint}),
      linear-gradient(180deg, rgba(7,5,3,0.50) 0%, rgba(7,5,3,0.18) 40%, rgba(7,5,3,0.74) 100%);
  `;

  layer.append(map, vignette);
  return layer;
}

/**
 * A premium dark slate-and-leather panel: layered borders, a gold keyline, deep drop shadow, a warm
 * paper-grain wash, and bright gold corner ornaments. Pass `padded=false` for grid layouts that own
 * their own inner padding (the corner ornaments and inner hairline still render). Caller sets width.
 */
export function panelCard(opts?: { padded?: boolean }): HTMLDivElement {
  const padded = opts?.padded ?? true;
  const card = document.createElement("div");
  card.style.cssText = `
    position:relative; box-sizing:border-box; overflow:hidden;
    background:
      linear-gradient(180deg, ${THEME.slate2} 0%, ${THEME.slate} 60%, ${THEME.ink} 100%);
    border:1px solid ${THEME.goldLine};
    border-radius:14px;
    box-shadow:
      0 30px 80px -20px rgba(0,0,0,0.8),
      0 2px 0 rgba(255,255,255,0.04) inset,
      0 0 0 1px rgba(0,0,0,0.6),
      0 -40px 90px -60px ${THEME.goldDeep} inset;
    ${padded ? `padding:${THEME.cardPad};` : ""}
  `;

  // warm paper-grain wash to relieve the murk (subtle, texture-only)
  const grain = document.createElement("div");
  grain.style.cssText = `
    position:absolute; inset:0; pointer-events:none; opacity:0.05; mix-blend-mode:overlay;
    background:
      radial-gradient(circle at 20% 30%, rgba(241,231,210,0.9), transparent 9%),
      radial-gradient(circle at 70% 60%, rgba(241,231,210,0.7), transparent 11%),
      radial-gradient(circle at 45% 85%, rgba(241,231,210,0.8), transparent 8%),
      radial-gradient(circle at 85% 15%, rgba(241,231,210,0.6), transparent 10%),
      linear-gradient(120deg, rgba(241,231,210,0.04), transparent 60%);
    background-size:140px 140px, 180px 180px, 120px 120px, 160px 160px, 100% 100%;
  `;
  card.appendChild(grain);

  // inner gold hairline
  const hairline = document.createElement("div");
  hairline.style.cssText = `position:absolute; inset:7px; border:1px solid rgba(184,137,58,0.22); border-radius:9px; pointer-events:none;`;
  card.appendChild(hairline);

  // bright gold corner ornaments
  const corners: Array<[string, string]> = [
    ["top:12px;left:12px", "border-top:2px solid;border-left:2px solid"],
    ["top:12px;right:12px", "border-top:2px solid;border-right:2px solid"],
    ["bottom:12px;left:12px", "border-bottom:2px solid;border-left:2px solid"],
    ["bottom:12px;right:12px", "border-bottom:2px solid;border-right:2px solid"],
  ];
  for (const [pos, brd] of corners) {
    const c = document.createElement("div");
    c.style.cssText = `position:absolute; ${pos}; width:18px; height:18px; ${brd}; border-color:${THEME.gold}; opacity:0.95; box-shadow:0 0 8px rgba(232,200,122,0.35); pointer-events:none;`;
    card.appendChild(c);
  }

  return card;
}

/** Gold hairline section divider. */
export function rule(width = "100%"): HTMLDivElement {
  const r = document.createElement("div");
  r.style.cssText = `width:${width}; height:1px; flex:0 0 auto; background:linear-gradient(90deg,transparent,${THEME.goldLine} 18%,${THEME.goldLine} 82%,transparent);`;
  return r;
}

/**
 * Cinzel-labelled button. "primary" = gold fill, "secondary" = dark outline, "danger" = red.
 * Caller attaches the click handler. Hover/press feedback is built in.
 */
export function btn(
  label: string,
  variant: "primary" | "secondary" | "danger" = "secondary",
): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.tabIndex = -1;

  let skin = "";
  if (variant === "primary") {
    skin = `color:#221a0c; background:linear-gradient(180deg, ${THEME.gold} 0%, ${THEME.goldDeep} 100%);
      border:1px solid ${THEME.gold};
      box-shadow:0 8px 22px -8px rgba(184,137,58,0.7), 0 1px 0 rgba(255,255,255,0.4) inset;`;
  } else if (variant === "danger") {
    skin = `color:${THEME.parch}; background:linear-gradient(180deg, ${THEME.danger} 0%, ${THEME.dangerDeep} 100%);
      border:1px solid rgba(199,90,74,0.8); box-shadow:0 8px 22px -10px rgba(139,58,58,0.8);`;
  } else {
    skin = `color:${THEME.parch}; background:linear-gradient(180deg, rgba(58,47,37,0.9), rgba(33,27,22,0.9));
      border:1px solid ${THEME.goldLine}; box-shadow:0 1px 0 rgba(255,255,255,0.05) inset;`;
  }

  b.style.cssText = `
    display:inline-flex; align-items:center; justify-content:center; gap:10px;
    font:600 16px ${cinzel}; letter-spacing:0.06em;
    padding:14px 26px; border-radius:9px; cursor:pointer; user-select:none;
    transition:filter .12s, transform .05s;
    ${skin}
  `;

  b.addEventListener("mouseenter", () => {
    b.style.filter = "brightness(1.08)";
    b.style.transform = "translateY(-1px)";
  });
  b.addEventListener("mouseleave", () => {
    b.style.filter = "";
    b.style.transform = "";
  });
  b.addEventListener("mousedown", () => {
    b.style.transform = "translateY(1px)";
  });
  b.addEventListener("mouseup", () => {
    b.style.transform = "translateY(-1px)";
  });

  return b;
}

/** Small uppercase Cinzel/Inter kicker label above a heading (gold). */
export function eyebrow(text: string): HTMLDivElement {
  const e = document.createElement("div");
  e.textContent = text;
  e.style.cssText = `
    font:600 12px ${body};
    text-transform:uppercase; letter-spacing:0.42em;
    color:${THEME.goldDeep};
  `;
  return e;
}

/** Cinzel display title. "hero" 46/800, "section" 20/600. */
export function heading(text: string, size: "hero" | "section" = "section"): HTMLDivElement {
  const h = document.createElement("div");
  h.textContent = text;
  if (size === "hero") {
    h.style.cssText = `
      font:800 46px ${cinzel}; line-height:1.02; letter-spacing:0.02em; color:${THEME.parch};
      text-shadow:0 2px 0 rgba(0,0,0,0.5), 0 0 28px rgba(184,137,58,0.18);
    `;
  } else {
    h.style.cssText = `font:600 20px ${cinzel}; letter-spacing:0.04em; color:${THEME.parch};`;
  }
  return h;
}

/** Dark form input (the join-code field's skin, generalized): deep fill, gold keyline, gold focus ring. */
export function textInput(placeholder: string): HTMLInputElement {
  const input = document.createElement("input");
  input.placeholder = placeholder;
  input.style.cssText = `
    box-sizing:border-box; min-width:0;
    padding:11px 13px; border-radius:8px;
    font:14px ${body}; color:${THEME.parch};
    background:rgba(11,9,6,0.5); border:1px solid ${THEME.goldLine};
    box-shadow:inset 0 2px 6px rgba(0,0,0,0.4); outline:none;
  `;
  input.addEventListener("focus", () => {
    input.style.borderColor = THEME.gold;
  });
  input.addEventListener("blur", () => {
    input.style.borderColor = THEME.goldLine;
  });
  return input;
}

/** Danger-tinted inline error note (✕ + message). */
export function errorNote(text: string): HTMLDivElement {
  const err = document.createElement("div");
  err.style.cssText = `
    display:flex; align-items:center; gap:8px;
    padding:10px 14px; border-radius:8px; box-sizing:border-box;
    background:rgba(139,58,58,.18); border:1px solid rgba(199,90,74,.4);
    color:#f0c0b8; font:13px ${body};
  `;
  const x = document.createElement("span");
  x.textContent = "✕";
  x.style.cssText = `font-weight:700; flex:0 0 auto; color:${THEME.danger};`;
  const msg = document.createElement("span");
  msg.textContent = text;
  err.append(x, msg);
  return err;
}

/** "LV n" account-level pill. */
export function levelChip(level: number): HTMLDivElement {
  const chip = document.createElement("div");
  chip.textContent = `LV ${level}`;
  chip.style.cssText = `
    flex:0 0 auto; font:700 11px ${cinzel}; letter-spacing:0.08em; color:${THEME.gold};
    border:1px solid ${THEME.goldLine}; border-radius:5px; padding:1px 6px;
  `;
  return chip;
}

/** Equipped-title tag; resolves the display name via the shared catalog. Throws on an unknown id. */
export function titleTag(titleId: string): HTMLDivElement {
  const tag = document.createElement("div");
  tag.textContent = titleById(titleId).name;
  tag.style.cssText = `flex:0 0 auto; font:italic 12px ${body}; color:${THEME.goldDeep};`;
  return tag;
}

/** 6px XP progress bar; `pct` is clamped to [0, 1]. */
export function xpBar(pct: number): HTMLDivElement {
  const track = document.createElement("div");
  track.style.cssText = `
    width:100%; height:6px; border-radius:3px; overflow:hidden; box-sizing:border-box;
    background:rgba(11,9,6,0.5); border:1px solid rgba(184,137,58,0.25);
  `;
  const fill = document.createElement("div");
  const clamped = Math.max(0, Math.min(1, pct));
  fill.style.cssText = `
    width:${(clamped * 100).toFixed(1)}%; height:100%;
    background:linear-gradient(90deg, ${THEME.gold}, ${THEME.goldDeep});
  `;
  track.appendChild(fill);
  return track;
}

const CLASS_ART: Record<string, string> = {
  vanguard: "/sprites/char1/sword-idle.webp",
  ranger: "/sprites/char1/bow-idle.webp",
  mystic: "/sprites/char1/staff-idle.webp",
};

/** Idle pose art for a starter preset. Throws loud on an unknown id (no silent fallback). */
export function classArt(presetId: string, sizePx: number): HTMLImageElement {
  const src = CLASS_ART[presetId];
  if (!src) throw new Error(`classArt: unknown presetId "${presetId}"`);
  const img = document.createElement("img");
  img.src = assetUrl(src);
  img.style.cssText = `
    height:${sizePx}px; object-fit:contain;
    filter:drop-shadow(0 8px 14px rgba(0,0,0,0.6));
  `;
  return img;
}

/** A 30px item webp on a 40px dark gold-keyline chip. `dimmed` (bag items) → opacity .82. */
export function itemIcon(id: string, opts?: { dimmed?: boolean }): HTMLDivElement {
  const chip = document.createElement("div");
  chip.style.cssText = `
    width:40px; height:40px; box-sizing:border-box; flex:0 0 auto;
    display:flex; align-items:center; justify-content:center;
    border-radius:8px;
    background:radial-gradient(circle at 50% 35%, rgba(184,137,58,0.18), rgba(11,9,6,0.5));
    border:1px solid ${THEME.goldLine};
    box-shadow:0 2px 6px rgba(0,0,0,0.4) inset;
    opacity:${opts?.dimmed ? ".82" : "1"};
  `;
  const img = document.createElement("img");
  img.src = assetUrl(`/sprites/items/${id}.webp`);
  img.title = id;
  img.style.cssText = `width:30px; height:30px; object-fit:contain;`;
  chip.appendChild(img);
  return chip;
}

/** `total` 9px dots; first `filled` solid green with glow, the rest hollow faint rings. */
export function seatPips(total: number, filled: number): HTMLDivElement {
  const row = document.createElement("div");
  row.style.cssText = `display:flex; gap:4px; align-items:center;`;
  for (let i = 0; i < total; i++) {
    const dot = document.createElement("div");
    const isFilled = i < filled;
    dot.style.cssText = `
      width:9px; height:9px; border-radius:50%; box-sizing:border-box;
      ${isFilled
        ? `background:${THEME.green}; box-shadow:0 0 6px rgba(123,176,74,0.6);`
        : `background:transparent; border:1px solid ${THEME.faint};`}
    `;
    row.appendChild(dot);
  }
  return row;
}

/** A small map-icon glyph on a dark gold-keyline tile. Used for room-row prefixes and the code glyph. */
export function mapIconDot(icon: string, sizePx = 44): HTMLDivElement {
  const dot = document.createElement("div");
  const inner = Math.round(sizePx * 0.66);
  dot.style.cssText = `
    width:${sizePx}px; height:${sizePx}px; box-sizing:border-box; flex:0 0 auto;
    display:flex; align-items:center; justify-content:center;
    border-radius:9px;
    background:radial-gradient(circle at 50% 40%, rgba(184,137,58,0.22), rgba(11,9,6,0.4));
    border:1px solid ${THEME.goldLine};
  `;
  const img = document.createElement("img");
  img.src = assetUrl(`/sprites/map-icons/${icon}.png`);
  img.style.cssText = `width:${inner}px; height:${inner}px; object-fit:contain;`;
  dot.appendChild(img);
  return dot;
}

/**
 * The showpiece: a vertical illuminated character plate for the lobby preset picker. A portrait well
 * with a pedestal glow over name/description/horizontal kit-icon row. `selected` brightens the gold
 * border, lifts the pedestal glow, and stamps a "SELECTED" badge. Caller wires the click
 * (sends `{type:"choosePreset",presetId:preset.id}`).
 */
export function presetPlate(preset: StarterPreset, selected: boolean): HTMLButtonElement {
  const plate = document.createElement("button");
  plate.tabIndex = -1;
  plate.style.cssText = `
    position:relative; display:flex; flex-direction:column; text-align:left;
    box-sizing:border-box; cursor:pointer; overflow:hidden;
    border-radius:13px;
    background:linear-gradient(180deg, rgba(43,35,28,0.85), rgba(17,13,9,0.92));
    border:1px solid ${selected ? THEME.gold : "rgba(184,137,58,0.28)"};
    box-shadow:${selected
      ? `0 0 0 1px ${THEME.gold}, 0 14px 36px -14px rgba(232,200,122,0.6)`
      : "0 8px 22px -14px rgba(0,0,0,0.7)"};
    transition:border-color .12s, box-shadow .12s, transform .08s;
  `;
  if (!selected) {
    plate.addEventListener("mouseenter", () => {
      plate.style.transform = "translateY(-2px)";
      plate.style.borderColor = THEME.goldLine;
    });
    plate.addEventListener("mouseleave", () => {
      plate.style.transform = "";
      plate.style.borderColor = "rgba(184,137,58,0.28)";
    });
  }

  // portrait well with pedestal glow
  const well = document.createElement("div");
  well.style.cssText = `
    position:relative; height:150px; display:flex; align-items:flex-end; justify-content:center;
    background:radial-gradient(120% 80% at 50% 25%, rgba(184,137,58,0.18), rgba(11,9,6,0.1) 70%);
  `;
  const pedestal = document.createElement("div");
  pedestal.style.cssText = `
    position:absolute; bottom:8px; left:50%; transform:translateX(-50%);
    width:140px; height:30px; border-radius:50%; filter:blur(5px);
    background:radial-gradient(ellipse, rgba(232,200,122,${selected ? "0.5" : "0.22"}), transparent 70%);
  `;
  well.appendChild(pedestal);
  const art = classArt(preset.id, 142);
  art.style.transform = "translateY(2px)";
  if (selected) art.style.filter += " drop-shadow(0 0 14px rgba(232,200,122,0.4))";
  well.appendChild(art);

  if (selected) {
    const badge = document.createElement("div");
    badge.textContent = "SELECTED";
    badge.style.cssText = `
      position:absolute; top:10px; right:10px;
      font:700 10px ${body}; letter-spacing:0.1em; color:#221a0c;
      background:linear-gradient(180deg,${THEME.gold},${THEME.goldDeep});
      padding:3px 9px; border-radius:6px;
    `;
    well.appendChild(badge);
  }
  plate.appendChild(well);

  // body
  const cbody = document.createElement("div");
  cbody.style.cssText = `padding:14px 16px 18px; display:flex; flex-direction:column; flex:1;`;

  const name = document.createElement("div");
  name.textContent = preset.name;
  name.style.cssText = `font:700 21px ${cinzel}; letter-spacing:0.04em; color:${selected ? THEME.gold : THEME.parch};`;

  const desc = document.createElement("div");
  desc.textContent = preset.description;
  desc.style.cssText = `font:13px/1.5 ${body}; color:${THEME.muted}; margin:8px 0 14px; flex:1;`;

  const kit = document.createElement("div");
  kit.style.cssText = `display:flex; gap:8px;`;
  for (const id of preset.equippedIds) kit.appendChild(itemIcon(id));
  for (const id of preset.bagIds) kit.appendChild(itemIcon(id, { dimmed: true }));

  cbody.append(name, desc, kit);
  plate.appendChild(cbody);

  return plate;
}
