/**
 * DESIGN ATTEMPT 1 — "Modern game-menu polish".
 * Dark slate-and-leather panels, crisp gold keylines, Cinzel display headers, a calm readable
 * body font, painted map backdrop behind a dark vignette. Visual-only; no networking.
 */
import { STARTER_PRESETS } from "shared";
import { mockRooms, lobbyRoom, type MenuScreen } from "../mock-data.js";

const BACKDROP: Record<MenuScreen, string> = {
  home: "/sprites/maps/dimension-0/gateway-city-0.png",
  "home-rooms": "/sprites/maps/dimension-0/gateway-city-0.png",
  lobby: "/sprites/maps/dimension-0/town-0.png",
  gameover: "/sprites/maps/dimension-0/great-ruins-0.png",
};

const PRESET_ART: Record<string, string> = {
  vanguard: "/sprites/char1/sword-idle.webp",
  ranger: "/sprites/char1/bow-idle.webp",
  mystic: "/sprites/char1/staff-idle.webp",
};

const ITEM_ICON: Record<string, string> = {
  "short-sword": "/sprites/items/short-sword.webp",
  "round-shield": "/sprites/items/round-shield.webp",
  bow: "/sprites/items/bow.webp",
  quiver: "/sprites/items/quiver.webp",
  staff: "/sprites/items/staff.webp",
  spellbook: "/sprites/items/spellbook.webp",
  potion: "/sprites/items/potion.webp",
  bomb: "/sprites/items/bomb.webp",
};

const FONT_BODY = "'Inter','Segoe UI',system-ui,sans-serif";
const FONT_DISPLAY = "'Cinzel',serif";

// palette
const C = {
  ink: "#1a1410",
  slate: "#211b16",
  slate2: "#2b231c",
  leather: "#3a2f25",
  gold: "#e8c87a",
  goldDeep: "#b8893a",
  goldLine: "rgba(184,137,58,0.55)",
  parch: "#f1e7d2",
  muted: "#b8a994",
  faint: "#8a7a68",
  green: "#7bb04a",
  greenDeep: "#4c7a2e",
  danger: "#c75a4a",
  dangerDeep: "#8b3a3a",
};

function el(tag: string, css: string, html?: string): HTMLElement {
  const n = document.createElement(tag);
  n.style.cssText = css;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

function stage(screen: MenuScreen): { stage: HTMLElement } {
  const s = el(
    "div",
    `position:fixed; inset:0; overflow:hidden; font-family:${FONT_BODY}; color:${C.parch};
     background:#0b0906; display:flex; align-items:center; justify-content:center;`,
  );
  // painted backdrop
  s.appendChild(
    el(
      "div",
      `position:absolute; inset:0; background:url('${BACKDROP[screen]}') center/cover no-repeat;
       transform:scale(1.06); filter:saturate(0.92) brightness(0.78);`,
    ),
  );
  // dark vignette + tone
  s.appendChild(
    el(
      "div",
      `position:absolute; inset:0; background:
        radial-gradient(120% 90% at 50% 35%, rgba(11,9,6,0.15) 0%, rgba(11,9,6,0.55) 55%, rgba(7,5,3,0.92) 100%),
        linear-gradient(180deg, rgba(7,5,3,0.55) 0%, rgba(7,5,3,0.25) 40%, rgba(7,5,3,0.78) 100%);`,
    ),
  );
  return { stage: s };
}

/** A premium dark panel: layered borders, gold keyline, inset shadow, corner ticks. */
function panel(width: string, extra = ""): HTMLElement {
  const p = el(
    "div",
    `position:relative; width:${width}; max-width:94vw; background:
      linear-gradient(180deg, ${C.slate2} 0%, ${C.slate} 60%, ${C.ink} 100%);
     border:1px solid ${C.goldLine}; border-radius:14px;
     box-shadow:0 30px 80px -20px rgba(0,0,0,0.8), 0 2px 0 rgba(255,255,255,0.04) inset,
       0 0 0 1px rgba(0,0,0,0.6), 0 -40px 90px -60px ${C.goldDeep} inset;
     ${extra}`,
  );
  // inner gold hairline
  p.appendChild(
    el(
      "div",
      `position:absolute; inset:7px; border:1px solid rgba(184,137,58,0.22); border-radius:9px; pointer-events:none;`,
    ),
  );
  // corner ticks
  for (const [pos, brd] of [
    ["top:12px;left:12px", "border-top:2px solid;border-left:2px solid"],
    ["top:12px;right:12px", "border-top:2px solid;border-right:2px solid"],
    ["bottom:12px;left:12px", "border-bottom:2px solid;border-left:2px solid"],
    ["bottom:12px;right:12px", "border-bottom:2px solid;border-right:2px solid"],
  ] as const) {
    p.appendChild(
      el("div", `position:absolute; ${pos}; width:16px; height:16px; ${brd}; border-color:${C.gold}; opacity:0.7; pointer-events:none;`),
    );
  }
  return p;
}

function kicker(text: string): HTMLElement {
  return el(
    "div",
    `font-family:${FONT_BODY}; letter-spacing:0.42em; text-transform:uppercase; font-size:12px;
     font-weight:600; color:${C.goldDeep}; margin-bottom:10px;`,
    text,
  );
}

function title(text: string, size = 46): HTMLElement {
  return el(
    "h1",
    `font-family:${FONT_DISPLAY}; font-weight:800; font-size:${size}px; line-height:1.02; margin:0;
     color:${C.parch}; letter-spacing:0.02em; text-shadow:0 2px 0 rgba(0,0,0,0.5), 0 0 28px rgba(184,137,58,0.18);`,
    text,
  );
}

function goldRule(width = "100%"): HTMLElement {
  return el(
    "div",
    `width:${width}; height:1px; background:linear-gradient(90deg, transparent, ${C.goldLine} 18%, ${C.goldLine} 82%, transparent);
     margin:0;`,
  );
}

function btn(label: string, kind: "primary" | "ghost" | "danger" = "ghost", full = false): HTMLElement {
  const base = `display:inline-flex; align-items:center; justify-content:center; gap:10px;
    font-family:${FONT_DISPLAY}; font-weight:600; font-size:16px; letter-spacing:0.06em;
    padding:14px 26px; border-radius:9px; cursor:pointer; user-select:none; ${full ? "width:100%;" : ""}`;
  if (kind === "primary") {
    return el(
      "div",
      `${base} color:#221a0c; background:linear-gradient(180deg, ${C.gold} 0%, ${C.goldDeep} 100%);
       border:1px solid ${C.gold}; box-shadow:0 8px 22px -8px rgba(184,137,58,0.7), 0 1px 0 rgba(255,255,255,0.4) inset;`,
      label,
    );
  }
  if (kind === "danger") {
    return el(
      "div",
      `${base} color:${C.parch}; background:linear-gradient(180deg, ${C.danger} 0%, ${C.dangerDeep} 100%);
       border:1px solid rgba(199,90,74,0.8); box-shadow:0 8px 22px -10px rgba(139,58,58,0.8);`,
      label,
    );
  }
  return el(
    "div",
    `${base} color:${C.parch}; background:linear-gradient(180deg, rgba(58,47,37,0.9), rgba(33,27,22,0.9));
     border:1px solid ${C.goldLine}; box-shadow:0 1px 0 rgba(255,255,255,0.05) inset;`,
    label,
  );
}

function itemChip(id: string): HTMLElement {
  const c = el(
    "div",
    `width:40px; height:40px; border-radius:8px; background:radial-gradient(circle at 50% 35%, rgba(184,137,58,0.18), rgba(11,9,6,0.5));
     border:1px solid ${C.goldLine}; display:flex; align-items:center; justify-content:center;
     box-shadow:0 2px 6px rgba(0,0,0,0.4) inset;`,
  );
  const icon = ITEM_ICON[id];
  if (icon) {
    const img = el("img", `width:30px; height:30px; object-fit:contain; image-rendering:auto;`) as HTMLImageElement;
    (img as HTMLImageElement).src = icon;
    c.appendChild(img);
  }
  return c;
}

// ─────────────────────────────────────────────────────────────────────────────
// HOME
// ─────────────────────────────────────────────────────────────────────────────
function renderHome(stageEl: HTMLElement, withRooms: boolean): void {
  const p = panel(withRooms ? "1080px" : "1000px", "padding:0; overflow:hidden;");
  const grid = el(
    "div",
    `position:relative; display:grid; grid-template-columns:${withRooms ? "1fr 440px" : "1fr 420px"}; min-height:560px;`,
  );

  // LEFT — hero / actions
  const left = el("div", `padding:56px 52px 48px; display:flex; flex-direction:column; justify-content:center;`);
  left.appendChild(kicker("Cooperative Expedition"));
  left.appendChild(title("Gather Your<br/>Warband", 54));
  left.appendChild(
    el(
      "p",
      `margin:20px 0 34px; max-width:440px; font-size:16px; line-height:1.6; color:${C.muted};`,
      "Brave the gateway city together. Form a party of up to four, choose your kits, and march into the painted wilds.",
    ),
  );

  const actions = el("div", `display:flex; flex-direction:column; gap:14px; max-width:380px;`);
  const quick = btn("Quick Match", "primary", true);
  quick.style.fontSize = "18px";
  quick.style.padding = "17px 26px";
  actions.appendChild(quick);
  const row = el("div", `display:grid; grid-template-columns:1fr 1fr; gap:14px;`);
  row.appendChild(btn("Create Room", "ghost", true));
  row.appendChild(btn("Join by Code", "ghost", true));
  actions.appendChild(row);
  left.appendChild(actions);

  grid.appendChild(left);

  // RIGHT (no rooms) — hero splash
  if (!withRooms) {
    const splash = el(
      "div",
      `position:relative; border-left:1px solid ${C.goldLine}; overflow:hidden;
       background:linear-gradient(180deg, rgba(11,9,6,0.35), rgba(11,9,6,0.8)),
         url('/sprites/maps/dimension-0/town-0.png') center/cover no-repeat;`,
    );
    splash.appendChild(
      el(
        "div",
        `position:absolute; inset:0; background:radial-gradient(80% 60% at 50% 30%, rgba(184,137,58,0.16), transparent 70%);`,
      ),
    );
    const heroImg = el(
      "img",
      `position:absolute; bottom:-6px; left:50%; transform:translateX(-50%); height:330px; object-fit:contain;
       filter:drop-shadow(0 18px 26px rgba(0,0,0,0.7));`,
    ) as HTMLImageElement;
    heroImg.src = PRESET_ART.vanguard!;
    splash.appendChild(heroImg);
    splash.appendChild(
      el(
        "div",
        `position:absolute; left:0; right:0; bottom:0; padding:18px 24px; text-align:center;
         background:linear-gradient(180deg, transparent, rgba(11,9,6,0.85));`,
        `<div style="display:inline-flex;align-items:center;gap:9px;color:${C.faint};font-size:13px">
           <span style="width:8px;height:8px;border-radius:50%;background:${C.green};box-shadow:0 0 8px ${C.green}"></span>
           Connected · <b style="color:${C.muted}">3</b> open rooms in the realm</div>`,
      ),
    );
    grid.appendChild(splash);
  }

  // RIGHT — open rooms list (only on home-rooms)
  if (withRooms) {
    const right = el(
      "div",
      `padding:36px 32px; background:linear-gradient(180deg, rgba(11,9,6,0.55), rgba(11,9,6,0.85));
       border-left:1px solid ${C.goldLine}; display:flex; flex-direction:column;`,
    );
    const head = el("div", `display:flex; align-items:baseline; justify-content:space-between; margin-bottom:6px;`);
    head.appendChild(el("div", `font-family:${FONT_DISPLAY}; font-weight:600; font-size:20px; color:${C.parch}; letter-spacing:0.04em;`, "Open Rooms"));
    head.appendChild(el("div", `font-size:12px; color:${C.faint}; letter-spacing:0.1em;`, `${mockRooms.length} ACTIVE`));
    right.appendChild(head);
    right.appendChild(goldRule());

    const list = el("div", `display:flex; flex-direction:column; gap:12px; margin-top:18px; flex:1;`);
    for (const r of mockRooms) {
      const card = el(
        "div",
        `display:flex; align-items:center; gap:14px; padding:14px 16px; border-radius:10px;
         background:linear-gradient(180deg, rgba(58,47,37,0.5), rgba(33,27,22,0.6));
         border:1px solid rgba(184,137,58,0.28); box-shadow:0 4px 14px -8px rgba(0,0,0,0.7);`,
      );
      const av = el(
        "div",
        `width:44px; height:44px; border-radius:9px; flex:none; background:url('/sprites/map-icons/gateway-city.png') center/70% no-repeat,
         radial-gradient(circle, rgba(184,137,58,0.22), rgba(11,9,6,0.4)); border:1px solid ${C.goldLine};`,
      );
      card.appendChild(av);
      const info = el("div", `flex:1; min-width:0;`);
      info.appendChild(
        el(
          "div",
          `font-family:${FONT_DISPLAY}; font-weight:600; font-size:17px; color:${C.gold}; letter-spacing:0.08em;`,
          r.code,
        ),
      );
      info.appendChild(el("div", `font-size:13px; color:${C.muted}; margin-top:2px;`, `Host · ${r.hostDisplayName}`));
      card.appendChild(info);
      const seatsWrap = el("div", `display:flex; flex-direction:column; align-items:flex-end; gap:6px;`);
      const filled = r.totalSeats - r.openSeats;
      const pips = el("div", `display:flex; gap:4px;`);
      for (let i = 0; i < r.totalSeats; i++) {
        pips.appendChild(
          el(
            "div",
            `width:9px; height:9px; border-radius:50%; ${
              i < filled
                ? `background:${C.green}; box-shadow:0 0 6px rgba(123,176,74,0.6);`
                : `background:transparent; border:1px solid ${C.faint};`
            }`,
          ),
        );
      }
      seatsWrap.appendChild(pips);
      const join = btn("Join", "ghost");
      join.style.padding = "7px 18px";
      join.style.fontSize = "13px";
      seatsWrap.appendChild(join);
      card.appendChild(seatsWrap);
      list.appendChild(card);
    }
    right.appendChild(list);
    grid.appendChild(right);
  }

  p.appendChild(grid);
  stageEl.appendChild(p);
}

// ─────────────────────────────────────────────────────────────────────────────
// LOBBY
// ─────────────────────────────────────────────────────────────────────────────
function renderLobby(stageEl: HTMLElement): void {
  const room = lobbyRoom();
  const p = panel("1140px", "padding:0; overflow:hidden;");

  // header bar
  const header = el(
    "div",
    `display:flex; align-items:center; justify-content:space-between; padding:30px 44px 24px;`,
  );
  const hl = el("div", "");
  hl.appendChild(kicker("Party Lobby"));
  const codeRow = el("div", `display:flex; align-items:baseline; gap:16px;`);
  codeRow.appendChild(title("War Council", 38));
  codeRow.appendChild(
    el(
      "div",
      `font-family:${FONT_DISPLAY}; font-weight:600; font-size:18px; letter-spacing:0.22em; color:${C.gold};
       padding:5px 14px; border:1px solid ${C.goldLine}; border-radius:8px; background:rgba(11,9,6,0.4);`,
      room.code,
    ),
  );
  hl.appendChild(codeRow);
  header.appendChild(hl);
  header.appendChild(
    el(
      "div",
      `text-align:right; font-size:13px; color:${C.muted}; line-height:1.7;`,
      `Dimension <b style="color:${C.gold}">${room.dimensionId}</b> · Gateway City<br/>
       <span style="color:${C.faint}">Waiting on the host to begin</span>`,
    ),
  );
  p.appendChild(header);
  const ruleWrap = el("div", `padding:0 44px;`);
  ruleWrap.appendChild(goldRule());
  p.appendChild(ruleWrap);

  // two-column body: roster | presets
  const body = el("div", `display:grid; grid-template-columns:380px 1fr; gap:0; padding:0;`);

  // LEFT roster
  const roster = el("div", `padding:28px 36px 32px; border-right:1px solid ${C.goldLine};`);
  roster.appendChild(
    el("div", `font-family:${FONT_DISPLAY}; font-weight:600; font-size:18px; color:${C.parch}; letter-spacing:0.05em; margin-bottom:16px;`, "Roster"),
  );
  const seatList = el("div", `display:flex; flex-direction:column; gap:12px;`);
  const presetName: Record<string, string> = Object.fromEntries(STARTER_PRESETS.map((x) => [x.id, x.name]));
  for (const s of room.seats) {
    const open = s.state === "open";
    const isBot = s.state === "bot";
    const seat = el(
      "div",
      `display:flex; align-items:center; gap:13px; padding:13px 15px; border-radius:11px;
       background:${open ? "rgba(11,9,6,0.35)" : "linear-gradient(180deg, rgba(58,47,37,0.5), rgba(33,27,22,0.6))"};
       border:1px dashed ${open ? "rgba(138,122,104,0.5)" : "transparent"};
       ${open ? "" : `border:1px solid rgba(184,137,58,0.3);`}`,
    );
    // avatar
    const avatar = el(
      "div",
      `width:46px; height:46px; flex:none; border-radius:50%; border:1px solid ${C.goldLine};
       background:radial-gradient(circle, rgba(184,137,58,0.2), rgba(11,9,6,0.5));
       display:flex; align-items:center; justify-content:center; overflow:hidden;`,
    );
    if (!open) {
      const tok = el("img", `width:54px; height:54px; object-fit:contain; transform:translateY(4px);`) as HTMLImageElement;
      tok.src = s.isHost ? "/sprites/player/blue-player-idle.webp" : "/sprites/player/red-player-idle.webp";
      avatar.appendChild(tok);
    } else {
      avatar.innerHTML = `<span style="font-size:22px;color:${C.faint};font-family:${FONT_DISPLAY}">+</span>`;
    }
    seat.appendChild(avatar);

    const info = el("div", `flex:1; min-width:0;`);
    const nameRow = el("div", `display:flex; align-items:center; gap:8px;`);
    nameRow.appendChild(
      el(
        "div",
        `font-weight:600; font-size:16px; color:${open ? C.faint : C.parch};`,
        open ? "Open Seat" : s.displayName,
      ),
    );
    if (s.isHost) nameRow.appendChild(el("div", `font-size:10px; letter-spacing:0.12em; color:${C.goldDeep}; border:1px solid ${C.goldLine}; padding:1px 6px; border-radius:5px;`, "HOST"));
    if (isBot) nameRow.appendChild(el("div", `font-size:10px; letter-spacing:0.12em; color:${C.muted}; border:1px solid ${C.faint}; padding:1px 6px; border-radius:5px;`, "BOT"));
    info.appendChild(nameRow);
    info.appendChild(
      el(
        "div",
        `font-size:12.5px; color:${C.muted}; margin-top:3px;`,
        open ? "Invite a friend or add a bot" : (s.presetId ? presetName[s.presetId] : "Choosing kit…"),
      ),
    );
    seat.appendChild(info);

    // ready state
    if (!open) {
      seat.appendChild(
        s.ready
          ? el(
              "div",
              `font-size:12px; font-weight:700; letter-spacing:0.08em; color:${C.green};
               display:flex; align-items:center; gap:6px;`,
              `<span style="width:8px;height:8px;border-radius:50%;background:${C.green};box-shadow:0 0 8px ${C.green}"></span>READY`,
            )
          : el("div", `font-size:12px; font-weight:600; letter-spacing:0.06em; color:${C.faint};`, "waiting"),
      );
    }
    seatList.appendChild(seat);
  }
  roster.appendChild(seatList);
  body.appendChild(roster);

  // RIGHT presets
  const right = el("div", `padding:28px 40px 30px;`);
  right.appendChild(
    el(
      "div",
      `display:flex; align-items:baseline; justify-content:space-between; margin-bottom:18px;`,
      `<div style="font-family:${FONT_DISPLAY};font-weight:600;font-size:18px;color:${C.parch};letter-spacing:0.05em">Choose Your Kit</div>
       <div style="font-size:12px;color:${C.faint};letter-spacing:0.1em">YOUR SELECTION · VANGUARD</div>`,
    ),
  );

  const cards = el("div", `display:grid; grid-template-columns:repeat(3,1fr); gap:16px;`);
  const selected = "vanguard";
  for (const preset of STARTER_PRESETS) {
    const sel = preset.id === selected;
    const card = el(
      "div",
      `position:relative; display:flex; flex-direction:column; border-radius:13px; overflow:hidden;
       background:linear-gradient(180deg, rgba(43,35,28,0.85), rgba(17,13,9,0.92));
       border:1px solid ${sel ? C.gold : "rgba(184,137,58,0.28)"};
       box-shadow:${sel ? `0 0 0 1px ${C.gold}, 0 14px 36px -14px rgba(184,137,58,0.55)` : "0 8px 22px -14px rgba(0,0,0,0.7)"};`,
    );
    // art well
    const art = el(
      "div",
      `position:relative; height:148px; display:flex; align-items:flex-end; justify-content:center;
       background:radial-gradient(120% 80% at 50% 25%, rgba(184,137,58,0.18), rgba(11,9,6,0.1) 70%);`,
    );
    const img = el("img", `height:142px; object-fit:contain; filter:drop-shadow(0 8px 14px rgba(0,0,0,0.6)); transform:translateY(2px);`) as HTMLImageElement;
    img.src = PRESET_ART[preset.id]!;
    art.appendChild(img);
    if (sel)
      art.appendChild(
        el(
          "div",
          `position:absolute; top:10px; right:10px; font-size:10px; font-weight:700; letter-spacing:0.1em;
           color:#221a0c; background:linear-gradient(180deg,${C.gold},${C.goldDeep}); padding:3px 9px; border-radius:6px;`,
          "SELECTED",
        ),
      );
    card.appendChild(art);

    const cbody = el("div", `padding:14px 16px 18px; display:flex; flex-direction:column; flex:1;`);
    cbody.appendChild(
      el("div", `font-family:${FONT_DISPLAY}; font-weight:700; font-size:21px; color:${sel ? C.gold : C.parch}; letter-spacing:0.04em;`, preset.name),
    );
    cbody.appendChild(
      el("div", `font-size:13px; line-height:1.5; color:${C.muted}; margin:8px 0 14px; flex:1;`, preset.description),
    );
    const icons = el("div", `display:flex; gap:8px;`);
    for (const id of [...preset.equippedIds, ...preset.bagIds]) icons.appendChild(itemChip(id));
    cbody.appendChild(icons);
    card.appendChild(cbody);
    cards.appendChild(card);
  }
  right.appendChild(cards);
  body.appendChild(right);
  p.appendChild(body);

  // footer
  const footer = el(
    "div",
    `display:flex; align-items:center; justify-content:space-between; padding:22px 44px 30px;
     border-top:1px solid ${C.goldLine}; background:linear-gradient(180deg, transparent, rgba(11,9,6,0.5));`,
  );
  footer.appendChild(
    el(
      "div",
      `font-size:13px; color:${C.muted};`,
      `<b style="color:${C.green}">2 of 3</b> warriors ready · 1 open seat`,
    ),
  );
  const fbtns = el("div", `display:flex; gap:14px;`);
  fbtns.appendChild(btn("Leave", "ghost"));
  const ready = btn("I'm Ready", "primary");
  ready.style.minWidth = "180px";
  fbtns.appendChild(ready);
  footer.appendChild(fbtns);
  p.appendChild(footer);

  stageEl.appendChild(p);
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME OVER
// ─────────────────────────────────────────────────────────────────────────────
function renderGameOver(stageEl: HTMLElement): void {
  const p = panel("620px", "padding:52px 56px 46px; text-align:center;");
  p.style.background = `linear-gradient(180deg, ${C.slate2} 0%, ${C.slate} 55%, ${C.ink} 100%)`;

  // crest
  p.appendChild(
    el(
      "div",
      `width:74px; height:74px; margin:0 auto 22px; border-radius:50%;
       background:radial-gradient(circle, rgba(199,90,74,0.28), rgba(11,9,6,0.5)); border:1px solid rgba(199,90,74,0.6);
       display:flex; align-items:center; justify-content:center;
       box-shadow:0 0 36px -8px rgba(199,90,74,0.5);`,
      `<img src="/sprites/map-icons/boss.png" style="width:42px;height:42px;object-fit:contain;opacity:0.92"/>`,
    ),
  );
  p.appendChild(
    el("div", `font-family:${FONT_BODY}; letter-spacing:0.42em; text-transform:uppercase; font-size:12px; font-weight:600; color:${C.danger}; margin-bottom:12px;`, "Defeat"),
  );
  p.appendChild(title("Your Warband<br/>Has Fallen", 46));
  p.appendChild(
    el(
      "p",
      `margin:18px auto 30px; max-width:420px; font-size:15.5px; line-height:1.6; color:${C.muted};`,
      "The great ruins claim another party. Your deeds will be remembered in song — rally again, and carve a different ending.",
    ),
  );

  // run stats
  const stats = el("div", `display:flex; justify-content:center; gap:14px; margin-bottom:30px;`);
  for (const [v, k] of [
    ["7", "Rooms Cleared"],
    ["23", "Foes Slain"],
    ["Lvl 4", "Depth"],
  ] as const) {
    const box = el(
      "div",
      `flex:1; max-width:150px; padding:14px 10px; border-radius:11px; border:1px solid ${C.goldLine};
       background:linear-gradient(180deg, rgba(43,35,28,0.6), rgba(17,13,9,0.7));`,
    );
    box.appendChild(el("div", `font-family:${FONT_DISPLAY}; font-weight:700; font-size:26px; color:${C.gold};`, v));
    box.appendChild(el("div", `font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:${C.faint}; margin-top:4px;`, k));
    stats.appendChild(box);
  }
  p.appendChild(stats);
  p.appendChild(goldRule("70%"));

  const actions = el("div", `display:flex; gap:14px; justify-content:center; margin-top:28px;`);
  const again = btn("Play Again", "primary");
  again.style.minWidth = "180px";
  actions.appendChild(again);
  actions.appendChild(btn("Return Home", "ghost"));
  p.appendChild(actions);

  // center the rule helper - it returns block, fine
  stageEl.appendChild(p);
}

export function renderVariant(screen: MenuScreen, root: HTMLElement): void {
  root.innerHTML = "";
  // load fonts defensively (harness loads Cinzel; ensure Inter)
  if (!document.getElementById("attempt1-fonts")) {
    const link = document.createElement("link");
    link.id = "attempt1-fonts";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }
  const { stage: s } = stage(screen);
  if (screen === "home") renderHome(s, false);
  else if (screen === "home-rooms") renderHome(s, true);
  else if (screen === "lobby") renderLobby(s);
  else renderGameOver(s);
  root.appendChild(s);
}
