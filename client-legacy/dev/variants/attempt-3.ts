/**
 * DESIGN ATTEMPT 3 — CINEMATIC FULL-BLEED.
 * No floating card. The painted scene fills the screen under a strong focal vignette; UI is composed
 * directly on it — large Cinzel title, content grouped in translucent dark "glass" panels
 * (backdrop-blur + gold edge), characters shown LARGE (lobby preset hero portraits, gameover hero-shot).
 *
 * Visual-only. No networking.
 */
import { STARTER_PRESETS } from "shared";
import { mockRooms, lobbyRoom, type MenuScreen } from "../mock-data.js";

const BACKDROP = "/sprites/maps/dimension-0/gateway-city-0.png";
const BACKDROP_RUINS = "/sprites/maps/dimension-0/great-ruins-0.png";

const PRESET_ART: Record<string, string> = {
  vanguard: "/sprites/char1/sword-idle.webp",
  ranger: "/sprites/char1/bow-idle.webp",
  mystic: "/sprites/char1/staff-idle.webp",
};
const PRESET_ITEMS: Record<string, string[]> = {
  vanguard: ["short-sword", "round-shield", "potion"],
  ranger: ["bow", "quiver", "potion"],
  mystic: ["staff", "spellbook", "potion"],
};
const PRESET_TAG: Record<string, string> = {
  vanguard: "FRONTLINE",
  ranger: "MARKSMAN",
  mystic: "ARCANE",
};

const C = {
  gold: "#e8c87a",
  goldDeep: "#b8893a",
  parchment: "#f5ebd7",
  cream: "#fffaf0",
  muted: "#bdab92",
  ink: "#1c140c",
  green: "#7ec24a",
  greenDeep: "#4caf50",
  danger: "#c75450",
  deep: "#0f0c08",
};

// ---- low-level builders -------------------------------------------------------------------------

function el(tag: string, css: string, html?: string): HTMLElement {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const FONT_DISPLAY = `"Cinzel", Georgia, serif`;
const FONT_BODY = `"Inter", "Segoe UI", system-ui, sans-serif`;

/** Translucent dark glass panel with blur + layered gold edge. */
function glass(css = ""): HTMLElement {
  return el(
    "div",
    `position:relative; background:linear-gradient(150deg, rgba(28,20,12,0.78), rgba(12,9,6,0.88)); ` +
      `backdrop-filter:blur(14px) saturate(1.1); -webkit-backdrop-filter:blur(14px) saturate(1.1); ` +
      `border:1px solid rgba(232,200,122,0.32); border-radius:14px; ` +
      `box-shadow:0 24px 60px -18px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,250,240,0.07), ` +
      `inset 0 0 0 1px rgba(0,0,0,0.4); ` +
      css,
  );
}

/** A small gold corner ornament on a glass panel. */
function cornerOrnaments(panel: HTMLElement): void {
  const corners: Array<[string, string]> = [
    ["top:8px;left:8px;", "border-top:2px solid; border-left:2px solid;"],
    ["top:8px;right:8px;", "border-top:2px solid; border-right:2px solid;"],
    ["bottom:8px;left:8px;", "border-bottom:2px solid; border-left:2px solid;"],
    ["bottom:8px;right:8px;", "border-bottom:2px solid; border-right:2px solid;"],
  ];
  for (const [pos, border] of corners) {
    panel.appendChild(
      el(
        "div",
        `position:absolute; width:16px; height:16px; ${pos} ${border} ` +
          `border-color:rgba(232,200,122,0.55); border-radius:2px; pointer-events:none;`,
      ),
    );
  }
}

function goldRule(width = "100%"): HTMLElement {
  return el(
    "div",
    `width:${width}; height:1px; margin:0 auto; ` +
      `background:linear-gradient(90deg, transparent, rgba(232,200,122,0.55), transparent);`,
  );
}

function btn(label: string, kind: "primary" | "ghost" | "danger" = "ghost"): HTMLElement {
  const styles: Record<string, string> = {
    primary:
      `background:linear-gradient(180deg, ${C.gold}, ${C.goldDeep}); color:#2a1c0a; ` +
      `border:1px solid rgba(255,240,200,0.6); box-shadow:0 8px 22px -8px rgba(184,137,58,0.8), inset 0 1px 0 rgba(255,255,255,0.5);`,
    ghost:
      `background:rgba(20,14,9,0.55); color:${C.parchment}; ` +
      `border:1px solid rgba(232,200,122,0.4); box-shadow:inset 0 1px 0 rgba(255,250,240,0.06);`,
    danger:
      `background:linear-gradient(180deg, #d96460, #8b3a3a); color:#fff0ee; ` +
      `border:1px solid rgba(255,200,195,0.4); box-shadow:0 8px 22px -8px rgba(139,58,58,0.8);`,
  };
  return el(
    "button",
    `font-family:${FONT_DISPLAY}; font-weight:600; font-size:15px; letter-spacing:1.4px; ` +
      `text-transform:uppercase; padding:13px 26px; border-radius:9px; cursor:pointer; ` +
      `transition:transform .1s; ${styles[kind]}`,
    label,
  );
}

function pill(text: string, color: string, bg: string): HTMLElement {
  return el(
    "span",
    `display:inline-flex; align-items:center; gap:6px; font-family:${FONT_BODY}; font-weight:700; ` +
      `font-size:11px; letter-spacing:1.2px; text-transform:uppercase; padding:4px 11px; ` +
      `border-radius:999px; color:${color}; background:${bg}; border:1px solid ${color}40;`,
    text,
  );
}

function itemIcon(id: string, size = 34): HTMLElement {
  const wrap = el(
    "div",
    `width:${size}px; height:${size}px; border-radius:8px; display:flex; align-items:center; ` +
      `justify-content:center; background:radial-gradient(circle at 40% 30%, rgba(60,46,30,0.9), rgba(18,13,8,0.95)); ` +
      `border:1px solid rgba(232,200,122,0.3); box-shadow:inset 0 0 8px rgba(0,0,0,0.6);`,
  );
  const img = document.createElement("img");
  img.src = `/sprites/items/${id}.webp`;
  img.style.cssText = `width:${size - 10}px; height:${size - 10}px; object-fit:contain; ` +
    `filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));`;
  wrap.appendChild(img);
  return wrap;
}

// ---- scaffold -----------------------------------------------------------------------------------

/** Full-bleed painted scene + focal vignette + content layer. Returns the centered content host. */
function scaffold(root: HTMLElement, backdrop: string, focusY = "38%"): HTMLElement {
  const stage = el(
    "div",
    `position:fixed; inset:0; overflow:hidden; font-family:${FONT_BODY}; color:${C.parchment}; ` +
      `background:${C.deep};`,
  );

  // painted scene
  stage.appendChild(
    el(
      "div",
      `position:absolute; inset:0; background:url('${backdrop}') center 40%/cover no-repeat; ` +
        `transform:scale(1.06); filter:saturate(1.05);`,
    ),
  );
  // atmospheric grade + focal vignette toward focusY
  stage.appendChild(
    el(
      "div",
      `position:absolute; inset:0; background:` +
        `radial-gradient(120% 90% at 50% ${focusY}, rgba(15,12,8,0.18) 0%, rgba(15,12,8,0.55) 45%, rgba(10,8,5,0.9) 100%),` +
        `linear-gradient(180deg, rgba(10,8,5,0.65) 0%, rgba(10,8,5,0.1) 30%, rgba(10,8,5,0.55) 75%, rgba(8,6,4,0.95) 100%);`,
    ),
  );
  // subtle gold top haze for warmth
  stage.appendChild(
    el(
      "div",
      `position:absolute; inset:0; background:radial-gradient(80% 50% at 50% 0%, rgba(232,200,122,0.08), transparent 60%); ` +
        `mix-blend-mode:screen; pointer-events:none;`,
    ),
  );

  const content = el(
    "div",
    `position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; ` +
      `padding:46px 56px;`,
  );
  stage.appendChild(content);
  root.appendChild(stage);
  return content;
}

/** The cinematic masthead used on every screen. */
function masthead(eyebrow: string, title: string, sub?: string): HTMLElement {
  const head = el("div", `text-align:center; margin-bottom:30px; flex:0 0 auto;`);
  head.appendChild(
    el(
      "div",
      `font-family:${FONT_DISPLAY}; font-weight:600; font-size:13px; letter-spacing:6px; ` +
        `text-transform:uppercase; color:${C.gold}; margin-bottom:10px; opacity:0.92;`,
      eyebrow,
    ),
  );
  head.appendChild(
    el(
      "h1",
      `font-family:${FONT_DISPLAY}; font-weight:800; font-size:64px; line-height:0.98; letter-spacing:2px; ` +
        `color:${C.cream}; margin:0; text-shadow:0 2px 1px rgba(0,0,0,0.5), 0 14px 40px rgba(0,0,0,0.85);`,
      title,
    ),
  );
  // gold underline flourish
  const flo = el("div", `display:flex; align-items:center; justify-content:center; gap:12px; margin-top:14px;`);
  flo.appendChild(el("div", `width:90px; height:1px; background:linear-gradient(90deg, transparent, ${C.gold});`));
  flo.appendChild(el("div", `width:7px; height:7px; transform:rotate(45deg); background:${C.gold}; box-shadow:0 0 10px ${C.gold};`));
  flo.appendChild(el("div", `width:90px; height:1px; background:linear-gradient(90deg, ${C.gold}, transparent);`));
  head.appendChild(flo);
  if (sub) {
    head.appendChild(
      el(
        "div",
        `font-family:${FONT_BODY}; font-size:15px; letter-spacing:0.5px; color:${C.muted}; margin-top:14px;`,
        sub,
      ),
    );
  }
  return head;
}

// ---- screen: HOME -------------------------------------------------------------------------------

function renderHome(content: HTMLElement): void {
  content.style.justifyContent = "center";
  content.appendChild(masthead("Paper & Steel · Co-op", "EXPEDITION", "Band together. Cross the gateway. Survive the ruins."));

  const panel = glass(`width:520px; padding:34px 38px; display:flex; flex-direction:column; gap:14px; margin-top:6px;`);
  cornerOrnaments(panel);

  const quick = btn("Quick Match", "primary");
  quick.style.fontSize = "17px";
  quick.style.padding = "16px";
  quick.style.width = "100%";
  panel.appendChild(quick);

  const rule = el("div", `display:flex; align-items:center; gap:14px; margin:6px 0;`);
  rule.appendChild(goldRule());
  rule.appendChild(el("span", `font-size:11px; letter-spacing:3px; color:${C.muted}; white-space:nowrap;`, "OR"));
  rule.appendChild(goldRule());
  panel.appendChild(rule);

  const row = el("div", `display:flex; gap:12px;`);
  const create = btn("Create Room");
  create.style.flex = "1";
  const browse = btn("Browse Rooms");
  browse.style.flex = "1";
  row.appendChild(create);
  row.appendChild(browse);
  panel.appendChild(row);

  // join-by-code field
  const join = el("div", `display:flex; gap:10px; margin-top:4px;`);
  const input = el(
    "div",
    `flex:1; display:flex; align-items:center; padding:13px 16px; border-radius:9px; ` +
      `background:rgba(8,6,4,0.6); border:1px solid rgba(232,200,122,0.28); ` +
      `font-family:${FONT_DISPLAY}; letter-spacing:5px; font-size:17px; color:${C.muted};`,
    "ENTER CODE",
  );
  join.appendChild(input);
  const go = btn("Join");
  join.appendChild(go);
  panel.appendChild(join);

  content.appendChild(panel);

  // footer credit
  content.appendChild(
    el(
      "div",
      `position:absolute; bottom:26px; left:0; right:0; text-align:center; font-size:12px; ` +
        `letter-spacing:2px; color:rgba(189,171,146,0.55);`,
      "GATEWAY CITY · DIMENSION 0",
    ),
  );
}

// ---- screen: HOME-ROOMS -------------------------------------------------------------------------

function renderHomeRooms(content: HTMLElement): void {
  content.appendChild(masthead("Paper & Steel · Co-op", "OPEN ROOMS", "Join a warband forming at the gateway."));

  const panel = glass(`width:760px; padding:24px; display:flex; flex-direction:column; gap:12px;`);
  cornerOrnaments(panel);

  // header bar
  const bar = el("div", `display:flex; align-items:center; justify-content:space-between; padding:0 8px 4px;`);
  bar.appendChild(el("div", `font-family:${FONT_DISPLAY}; font-size:15px; letter-spacing:2px; color:${C.gold};`, `${mockRooms.length} WARBANDS RECRUITING`));
  const refresh = btn("Refresh");
  refresh.style.padding = "8px 16px";
  refresh.style.fontSize = "12px";
  bar.appendChild(refresh);
  panel.appendChild(bar);
  panel.appendChild(goldRule("100%"));

  for (const r of mockRooms) {
    const dimName = r.dimensionId === 2 ? "The Deep Ruins" : "Gateway Reach";
    const full = r.openSeats === 0;
    const card = el(
      "div",
      `display:flex; align-items:center; gap:18px; padding:16px 18px; border-radius:11px; ` +
        `background:linear-gradient(120deg, rgba(40,30,20,0.5), rgba(20,14,9,0.55)); ` +
        `border:1px solid rgba(232,200,122,0.18); transition:transform .1s;`,
    );

    // map glyph
    const glyph = el(
      "div",
      `width:54px; height:54px; flex:0 0 auto; border-radius:10px; display:flex; align-items:center; justify-content:center; ` +
        `background:radial-gradient(circle at 40% 30%, rgba(70,52,34,0.9), rgba(16,11,7,0.95)); ` +
        `border:1px solid rgba(232,200,122,0.3);`,
    );
    const gi = document.createElement("img");
    gi.src = `/sprites/map-icons/${r.dimensionId === 2 ? "ruins" : "gateway-city"}.png`;
    gi.style.cssText = `width:34px; height:34px; object-fit:contain; filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));`;
    glyph.appendChild(gi);
    card.appendChild(glyph);

    // code + meta
    const meta = el("div", `flex:1; min-width:0;`);
    meta.appendChild(
      el("div", `font-family:${FONT_DISPLAY}; font-weight:800; font-size:24px; letter-spacing:3px; color:${C.cream};`, r.code),
    );
    meta.appendChild(
      el(
        "div",
        `font-family:${FONT_BODY}; font-size:13px; color:${C.muted}; margin-top:2px;`,
        `Hosted by <span style="color:${C.parchment};">${r.hostDisplayName}</span> · ${dimName}`,
      ),
    );
    card.appendChild(meta);

    // seat dots
    const seats = el("div", `display:flex; gap:5px; align-items:center;`);
    const filled = r.totalSeats - r.openSeats;
    for (let i = 0; i < r.totalSeats; i++) {
      const on = i < filled;
      seats.appendChild(
        el(
          "div",
          `width:13px; height:13px; border-radius:50%; ` +
            (on
              ? `background:${C.gold}; box-shadow:0 0 8px rgba(232,200,122,0.5);`
              : `background:transparent; border:1.5px solid rgba(232,200,122,0.4);`),
        ),
      );
    }
    card.appendChild(seats);

    const seatLabel = el(
      "div",
      `font-family:${FONT_BODY}; font-size:12px; letter-spacing:1px; color:${C.muted}; width:74px; text-align:right;`,
      full ? "FULL" : `${r.openSeats} open`,
    );
    card.appendChild(seatLabel);

    const join = btn(full ? "Watch" : "Join", full ? "ghost" : "primary");
    join.style.padding = "11px 22px";
    join.style.width = "118px";
    if (full) join.style.opacity = "0.6";
    card.appendChild(join);

    panel.appendChild(card);
  }

  content.appendChild(panel);

  const back = btn("← Back");
  back.style.marginTop = "22px";
  content.appendChild(back);
}

// ---- screen: LOBBY ------------------------------------------------------------------------------

function renderLobby(content: HTMLElement): void {
  content.style.padding = "38px 56px";
  const room = lobbyRoom();

  content.appendChild(masthead(`Room ${room.code} · Gateway Reach`, "ASSEMBLE YOUR PARTY", undefined));

  const body = el("div", `display:flex; gap:26px; width:100%; max-width:1180px; flex:1 1 auto; min-height:0; align-items:stretch;`);

  // LEFT: roster
  const roster = glass(`width:330px; flex:0 0 auto; padding:22px; display:flex; flex-direction:column; gap:12px;`);
  cornerOrnaments(roster);
  roster.appendChild(el("div", `font-family:${FONT_DISPLAY}; font-size:15px; letter-spacing:2px; color:${C.gold};`, "WARBAND"));
  roster.appendChild(goldRule());

  for (const s of room.seats) {
    if (s.state === "open") {
      roster.appendChild(
        el(
          "div",
          `display:flex; align-items:center; gap:12px; padding:13px 14px; border-radius:10px; ` +
            `border:1.5px dashed rgba(232,200,122,0.28); color:${C.muted}; font-style:italic; ` +
            `font-size:14px; background:rgba(8,6,4,0.25);`,
          `<span style="font-size:20px; opacity:0.5;">+</span> Open seat — awaiting hero`,
        ),
      );
      continue;
    }
    const isBot = s.state === "bot";
    const accent = s.isHost ? C.gold : isBot ? "#9a86c8" : "#6fa8d6";
    const seat = el(
      "div",
      `display:flex; align-items:center; gap:13px; padding:12px 14px; border-radius:10px; ` +
        `background:linear-gradient(120deg, rgba(40,30,20,0.45), rgba(18,13,8,0.5)); ` +
        `border:1px solid rgba(232,200,122,0.16); border-left:3px solid ${accent};`,
    );
    // token / avatar
    const av = el(
      "div",
      `width:42px; height:42px; flex:0 0 auto; border-radius:9px; overflow:hidden; ` +
        `background:radial-gradient(circle at 50% 35%, rgba(70,52,34,0.8), rgba(14,10,6,0.9)); ` +
        `border:1px solid ${accent}55; display:flex; align-items:flex-end; justify-content:center;`,
    );
    const ai = document.createElement("img");
    const presetArt = s.presetId ? PRESET_ART[s.presetId] : undefined;
    ai.src = presetArt ?? "/sprites/player/blue-player-idle.webp";
    ai.style.cssText = `width:48px; height:48px; object-fit:contain; object-position:bottom; filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));`;
    av.appendChild(ai);
    seat.appendChild(av);

    const info = el("div", `flex:1; min-width:0;`);
    const nameRow = el("div", `display:flex; align-items:center; gap:8px;`);
    nameRow.appendChild(
      el("span", `font-family:${FONT_DISPLAY}; font-weight:600; font-size:16px; color:${C.cream};`, s.displayName),
    );
    if (s.isHost) nameRow.appendChild(el("span", `font-size:10px; letter-spacing:1.5px; color:${C.gold};`, "HOST"));
    if (isBot) nameRow.appendChild(el("span", `font-size:10px; letter-spacing:1.5px; color:#9a86c8;`, "BOT"));
    info.appendChild(nameRow);
    const presetName = s.presetId ? STARTER_PRESETS.find((p) => p.id === s.presetId)?.name : "Choosing…";
    info.appendChild(el("div", `font-size:13px; color:${C.muted}; margin-top:1px;`, presetName ?? "Choosing…"));
    seat.appendChild(info);

    // ready indicator
    seat.appendChild(
      s.ready
        ? pill("Ready", "#cdeeb0", "rgba(90,122,58,0.35)")
        : pill("Waiting", C.muted, "rgba(40,30,20,0.5)"),
    );
    roster.appendChild(seat);
  }

  // host controls at bottom of roster
  roster.appendChild(el("div", `flex:1 1 auto;`));
  const addBot = btn("+ Add Bot", "ghost");
  addBot.style.width = "100%";
  addBot.style.fontSize = "13px";
  addBot.style.padding = "11px";
  roster.appendChild(addBot);

  body.appendChild(roster);

  // RIGHT: preset selection — big hero portraits
  const right = el("div", `flex:1 1 auto; display:flex; flex-direction:column; gap:16px; min-width:0;`);
  const presetHead = el("div", `display:flex; align-items:baseline; justify-content:space-between;`);
  presetHead.appendChild(el("div", `font-family:${FONT_DISPLAY}; font-size:18px; letter-spacing:2px; color:${C.gold};`, "CHOOSE YOUR CALLING"));
  presetHead.appendChild(el("div", `font-size:13px; color:${C.muted};`, "Your loadout for the run"));
  right.appendChild(presetHead);

  const cards = el("div", `display:flex; gap:16px; flex:1 1 auto; min-height:0;`);
  const yourPreset = room.seats.find((s) => s.seatId === room.yourSeatId)?.presetId;

  for (const p of STARTER_PRESETS) {
    const selected = p.id === yourPreset;
    const card = glass(
      `flex:1 1 0; min-width:0; display:flex; flex-direction:column; align-items:center; ` +
        `padding:20px 16px 18px; cursor:pointer; ` +
        (selected
          ? `border:1.5px solid ${C.gold}; box-shadow:0 24px 60px -18px rgba(0,0,0,0.85), 0 0 0 1px ${C.gold}, 0 0 30px -4px rgba(232,200,122,0.4);`
          : ``),
    );

    if (selected) {
      const badge = el(
        "div",
        `position:absolute; top:-11px; left:50%; transform:translateX(-50%); z-index:2; ` +
          `font-family:${FONT_DISPLAY}; font-weight:600; font-size:11px; letter-spacing:2px; ` +
          `padding:4px 14px; border-radius:999px; color:#2a1c0a; ` +
          `background:linear-gradient(180deg, ${C.gold}, ${C.goldDeep}); box-shadow:0 6px 16px -4px rgba(184,137,58,0.8);`,
        "SELECTED",
      );
      card.appendChild(badge);
    }

    card.appendChild(
      el(
        "div",
        `font-size:10px; letter-spacing:2.5px; color:${C.goldDeep}; font-weight:700; margin-bottom:2px;`,
        PRESET_TAG[p.id] ?? "",
      ),
    );
    card.appendChild(
      el("div", `font-family:${FONT_DISPLAY}; font-weight:800; font-size:26px; color:${C.cream}; letter-spacing:1px;`, p.name),
    );

    // big hero portrait on a pedestal glow
    const stage = el(
      "div",
      `position:relative; width:100%; flex:1 1 auto; min-height:210px; display:flex; ` +
        `align-items:flex-end; justify-content:center; margin:8px 0 6px;`,
    );
    stage.appendChild(
      el(
        "div",
        `position:absolute; bottom:6px; left:50%; transform:translateX(-50%); width:150px; height:34px; ` +
          `border-radius:50%; background:radial-gradient(ellipse, rgba(232,200,122,0.35), transparent 70%); filter:blur(4px);`,
      ),
    );
    const hero = document.createElement("img");
    hero.src = PRESET_ART[p.id] ?? "";
    hero.style.cssText =
      `position:relative; max-height:230px; max-width:96%; transform:scale(1.22); transform-origin:bottom center; object-fit:contain; ` +
      `filter:drop-shadow(0 10px 18px rgba(0,0,0,0.7)) ${selected ? "drop-shadow(0 0 14px rgba(232,200,122,0.4))" : ""};`;
    stage.appendChild(hero);
    card.appendChild(stage);

    card.appendChild(
      el(
        "div",
        `font-family:${FONT_BODY}; font-size:13px; line-height:1.45; color:${C.muted}; ` +
          `text-align:center; min-height:38px; padding:0 4px;`,
        p.description,
      ),
    );

    // item loadout row
    const items = el("div", `display:flex; gap:8px; justify-content:center; margin-top:12px;`);
    for (const id of PRESET_ITEMS[p.id] ?? []) items.appendChild(itemIcon(id, 36));
    card.appendChild(items);

    cards.appendChild(card);
  }
  right.appendChild(cards);

  body.appendChild(right);
  content.appendChild(body);

  // bottom action bar
  const actions = el(
    "div",
    `display:flex; align-items:center; justify-content:space-between; width:100%; max-width:1180px; ` +
      `margin-top:22px; flex:0 0 auto;`,
  );
  const leave = btn("← Leave Room");
  actions.appendChild(leave);

  const right2 = el("div", `display:flex; align-items:center; gap:18px;`);
  const readyCount = room.seats.filter((s) => s.ready && s.state !== "open").length;
  const filled = room.seats.filter((s) => s.state !== "open").length;
  right2.appendChild(
    el(
      "div",
      `font-family:${FONT_BODY}; font-size:14px; color:${C.muted};`,
      `<span style="color:${C.green}; font-weight:700;">${readyCount}/${filled}</span> heroes ready`,
    ),
  );
  const ready = btn("I'm Ready", "primary");
  ready.style.padding = "16px 40px";
  ready.style.fontSize = "16px";
  right2.appendChild(ready);
  const start = el(
    "button",
    `font-family:${FONT_DISPLAY}; font-weight:800; font-size:16px; letter-spacing:2px; text-transform:uppercase; ` +
      `padding:16px 44px; border-radius:10px; cursor:pointer; color:#15240c; ` +
      `background:linear-gradient(180deg, ${C.green}, ${C.greenDeep}); ` +
      `border:1px solid rgba(220,255,200,0.5); box-shadow:0 10px 26px -8px rgba(76,175,80,0.7), inset 0 1px 0 rgba(255,255,255,0.4);`,
    "Begin Expedition",
  );
  right2.appendChild(start);
  actions.appendChild(right2);
  content.appendChild(actions);
}

// ---- screen: GAMEOVER ---------------------------------------------------------------------------

function renderGameover(content: HTMLElement): void {
  content.style.justifyContent = "center";

  // fallen-hero hero-shot: large, upright, desaturated and lit from a dim ember glow below
  const stage = el(
    "div",
    `position:relative; width:300px; height:270px; display:flex; align-items:flex-end; justify-content:center; margin-bottom:10px;`,
  );
  // ember ground glow
  stage.appendChild(
    el(
      "div",
      `position:absolute; bottom:6px; left:50%; transform:translateX(-50%); width:210px; height:44px; ` +
        `border-radius:50%; background:radial-gradient(ellipse, rgba(199,84,80,0.55), rgba(139,58,58,0.15) 55%, transparent 75%); filter:blur(5px);`,
    ),
  );
  const hero = document.createElement("img");
  hero.src = "/sprites/char1/sword-idle.webp";
  hero.style.cssText =
    `position:relative; max-height:270px; transform:scale(1.3); transform-origin:bottom center; object-fit:contain; ` +
    `filter:grayscale(0.85) brightness(0.5) contrast(1.05) ` +
    `drop-shadow(0 0 18px rgba(199,84,80,0.35)) drop-shadow(0 14px 24px rgba(0,0,0,0.85));`;
  stage.appendChild(hero);
  content.appendChild(stage);

  content.appendChild(
    el(
      "div",
      `font-family:${FONT_DISPLAY}; font-weight:600; font-size:14px; letter-spacing:6px; ` +
        `text-transform:uppercase; color:${C.danger}; margin-bottom:6px;`,
      "The Expedition Ends",
    ),
  );
  content.appendChild(
    el(
      "h1",
      `font-family:${FONT_DISPLAY}; font-weight:800; font-size:72px; line-height:0.95; letter-spacing:2px; ` +
        `color:${C.cream}; margin:0; text-align:center; ` +
        `text-shadow:0 2px 1px rgba(0,0,0,0.5), 0 16px 44px rgba(139,58,58,0.5);`,
      "YOUR PARTY<br/>HAS FALLEN",
    ),
  );

  const flo = el("div", `display:flex; align-items:center; justify-content:center; gap:12px; margin:20px 0 22px;`);
  flo.appendChild(el("div", `width:110px; height:1px; background:linear-gradient(90deg, transparent, ${C.danger});`));
  flo.appendChild(el("div", `width:7px; height:7px; transform:rotate(45deg); background:${C.danger}; box-shadow:0 0 10px ${C.danger};`));
  flo.appendChild(el("div", `width:110px; height:1px; background:linear-gradient(90deg, ${C.danger}, transparent);`));
  content.appendChild(flo);

  // run summary stats in a glass strip
  const stats = glass(`display:flex; gap:0; padding:0; overflow:hidden; margin-bottom:30px;`);
  const statDefs: Array<[string, string]> = [
    ["DEPTH REACHED", "The Deep Ruins"],
    ["FOES SLAIN", "47"],
    ["TURNS SURVIVED", "112"],
    ["GOLD GATHERED", "318"],
  ];
  statDefs.forEach(([label, val], i) => {
    const cell = el(
      "div",
      `padding:18px 30px; text-align:center; ` +
        (i > 0 ? `border-left:1px solid rgba(232,200,122,0.18);` : ``),
    );
    cell.appendChild(el("div", `font-family:${FONT_DISPLAY}; font-weight:800; font-size:26px; color:${C.gold};`, val));
    cell.appendChild(el("div", `font-family:${FONT_BODY}; font-size:11px; letter-spacing:2px; color:${C.muted}; margin-top:4px;`, label));
    stats.appendChild(cell);
  });
  content.appendChild(stats);

  const row = el("div", `display:flex; gap:16px;`);
  const again = btn("Play Again", "primary");
  again.style.padding = "16px 38px";
  again.style.fontSize = "16px";
  const home = btn("Return Home");
  home.style.padding = "16px 38px";
  home.style.fontSize = "16px";
  row.appendChild(again);
  row.appendChild(home);
  content.appendChild(row);
}

// ---- entry --------------------------------------------------------------------------------------

export function renderVariant(screen: MenuScreen, root: HTMLElement): void {
  root.innerHTML = "";
  if (screen === "gameover") {
    const content = scaffold(root, BACKDROP_RUINS, "42%");
    renderGameover(content);
    return;
  }
  const content = scaffold(root, BACKDROP, screen === "lobby" ? "30%" : "38%");
  if (screen === "home") renderHome(content);
  else if (screen === "home-rooms") renderHomeRooms(content);
  else if (screen === "lobby") renderLobby(content);
}
