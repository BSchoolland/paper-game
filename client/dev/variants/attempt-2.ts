/**
 * DESIGN ATTEMPT 2 — "Parchment Tome, done right."
 *
 * A cozy fantasy-ledger UI for the co-op menu. The panel is built ENTIRELY in CSS: warm layered
 * parchment gradients, a double inset rule, a burnished/torn edge via stacked box-shadows, and small
 * corner flourishes drawn from /sprites/map-icons. The painted map backdrop is framed (vignette +
 * inset), never buried. Class presets are large illuminated character plates with class art and a
 * horizontal item-kit row so everything breathes.
 *
 * Visual-only: no networking. Covers home | home-rooms | lobby | gameover.
 */
import { STARTER_PRESETS } from "shared";
import { mockRooms, lobbyRoom, type MenuScreen } from "../mock-data.js";

const BACKDROPS: Record<MenuScreen, string> = {
  home: "/sprites/maps/dimension-0/gateway-city-0.png",
  "home-rooms": "/sprites/maps/dimension-0/gateway-city-0.png",
  lobby: "/sprites/maps/dimension-0/town-0.png",
  gameover: "/sprites/maps/dimension-0/great-ruins-0.png",
};

const CLASS_ART: Record<string, string> = {
  vanguard: "/sprites/char1/sword-idle.webp",
  ranger: "/sprites/char1/bow-idle.webp",
  mystic: "/sprites/char1/staff-idle.webp",
};

const PRESET_TAG: Record<string, string> = {
  vanguard: "Frontline",
  ranger: "Skirmisher",
  mystic: "Caster",
};

const ITEM_LABEL: Record<string, string> = {
  "short-sword": "Short Sword",
  "round-shield": "Round Shield",
  bow: "Longbow",
  quiver: "Quiver",
  staff: "Oak Staff",
  spellbook: "Spellbook",
  potion: "Potion",
  bomb: "Bomb",
};

// ---- palette ---------------------------------------------------------------
const C = {
  parchHi: "#fffaf0",
  parch: "#f5ebd7",
  parchLo: "#e9dabd",
  ink: "#3a2b1d",
  inkSoft: "#5e4a36",
  muted: "#8a7a68",
  leather: "#6b5b4a",
  gold: "#b8893a",
  goldHi: "#e8c87a",
  green: "#5a7a3a",
  greenBright: "#6fae3d",
  danger: "#8b3a3a",
  deep: "#0f0c08",
};

// ---- shared CSS injected once ---------------------------------------------
function injectStyle(): void {
  if (document.getElementById("a2-style")) return;
  const s = document.createElement("style");
  s.id = "a2-style";
  s.textContent = `
  .a2-root{position:fixed;inset:0;overflow:hidden;font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;color:${C.ink};}
  .a2-bg{position:absolute;inset:0;background-size:cover;background-position:center;transform:scale(1.06);filter:saturate(.92) brightness(.9);}
  .a2-bg-tint{position:absolute;inset:0;background:
     radial-gradient(120% 90% at 50% 35%, rgba(15,12,8,0) 38%, rgba(15,12,8,.55) 78%, rgba(15,12,8,.82) 100%),
     linear-gradient(180deg, rgba(20,14,8,.35), rgba(10,7,4,.55));}
  .a2-stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:34px;}

  /* the parchment tome panel — pure CSS */
  .a2-panel{position:relative;border-radius:7px;
    background:
      radial-gradient(140% 120% at 50% 0%, ${C.parchHi} 0%, ${C.parch} 46%, ${C.parchLo} 100%);
    box-shadow:
      0 0 0 1px rgba(60,40,20,.55),
      0 0 0 7px ${C.parch},
      0 0 0 8px rgba(80,55,30,.7),
      0 0 0 9px rgba(184,137,58,.55),
      inset 0 0 0 2px rgba(120,90,50,.30),
      inset 0 0 60px rgba(120,85,45,.18),
      inset 0 2px 0 rgba(255,255,255,.6),
      0 26px 60px rgba(0,0,0,.6),
      0 6px 18px rgba(0,0,0,.45);
  }
  /* speckle/grain + a soft burnished torn edge */
  .a2-panel::before{content:"";position:absolute;inset:0;border-radius:7px;pointer-events:none;
    background:
      radial-gradient(1px 1px at 20% 30%, rgba(90,60,30,.10), transparent 60%),
      radial-gradient(1px 1px at 70% 60%, rgba(90,60,30,.08), transparent 60%),
      radial-gradient(1px 1px at 40% 80%, rgba(90,60,30,.07), transparent 60%);
    box-shadow:inset 0 0 30px rgba(110,80,40,.22), inset 0 0 90px rgba(150,110,60,.10);}
  .a2-inner{position:relative;margin:18px;border-radius:3px;padding:34px 40px;
    box-shadow:inset 0 0 0 1px rgba(120,90,50,.45), inset 0 0 0 4px ${C.parch}, inset 0 0 0 5px rgba(150,115,65,.40);}

  .a2-corner{position:absolute;width:30px;height:30px;opacity:.7;filter:sepia(.5) saturate(.7) brightness(.85);pointer-events:none;}
  .a2-corner.tl{top:8px;left:8px;}
  .a2-corner.tr{top:8px;right:8px;transform:scaleX(-1);}
  .a2-corner.bl{bottom:8px;left:8px;transform:scaleY(-1);}
  .a2-corner.br{bottom:8px;right:8px;transform:scale(-1,-1);}

  .a2-cinzel{font-family:"Cinzel",serif;}
  .a2-h1{font-family:"Cinzel",serif;font-weight:800;color:${C.ink};letter-spacing:.06em;line-height:1.05;
    text-shadow:0 1px 0 rgba(255,255,255,.5);}
  .a2-kicker{font-family:"Cinzel",serif;font-weight:600;letter-spacing:.42em;text-transform:uppercase;color:${C.gold};font-size:12px;}
  .a2-sub{color:${C.inkSoft};font-size:15.5px;line-height:1.55;}

  .a2-rule{height:0;border:0;border-top:1px solid rgba(120,90,50,.45);
    box-shadow:0 2px 0 rgba(255,250,240,.6);position:relative;}
  .a2-rule-d{position:relative;height:14px;display:flex;align-items:center;justify-content:center;gap:14px;color:${C.gold};}
  .a2-rule-d::before,.a2-rule-d::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(120,90,50,.55),transparent);}
  .a2-diamond{width:7px;height:7px;background:${C.gold};transform:rotate(45deg);box-shadow:0 0 0 3px rgba(184,137,58,.18);}

  /* buttons */
  .a2-btn{font-family:"Cinzel",serif;font-weight:600;letter-spacing:.06em;cursor:pointer;border:0;border-radius:5px;
    padding:15px 26px;font-size:15px;position:relative;transition:transform .08s;}
  .a2-btn-primary{color:#241a0d;
    background:linear-gradient(180deg,${C.goldHi},${C.gold} 65%,#9c7430);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.7), inset 0 -2px 4px rgba(90,60,20,.4),
      0 4px 0 #7e5e26, 0 8px 14px rgba(0,0,0,.32);text-shadow:0 1px 0 rgba(255,245,220,.5);}
  .a2-btn-ghost{color:${C.inkSoft};background:linear-gradient(180deg,#f3e8d0,#e3d2b1);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.6), inset 0 0 0 1px rgba(120,90,50,.4), 0 3px 0 #c2ac84, 0 6px 12px rgba(0,0,0,.2);}
  .a2-btn-danger{color:#fff;background:linear-gradient(180deg,#a85050,${C.danger} 70%,#6e2a2a);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.35), 0 4px 0 #5a2424, 0 8px 14px rgba(0,0,0,.3);text-shadow:0 1px 0 rgba(0,0,0,.3);}

  /* room rows */
  .a2-room{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:18px;
    padding:14px 18px;border-radius:6px;background:linear-gradient(180deg,rgba(255,250,240,.7),rgba(233,218,189,.5));
    box-shadow:inset 0 0 0 1px rgba(120,90,50,.32), inset 0 1px 0 rgba(255,255,255,.5);}
  .a2-room-code{font-family:"Cinzel",serif;font-weight:800;font-size:19px;letter-spacing:.08em;color:${C.ink};}
  .a2-pill{font-family:"Cinzel",serif;font-weight:600;font-size:12px;letter-spacing:.05em;padding:6px 12px;border-radius:999px;
    color:${C.leather};background:rgba(184,137,58,.16);box-shadow:inset 0 0 0 1px rgba(184,137,58,.45);}

  /* preset plates */
  .a2-plate{position:relative;border-radius:8px;padding:18px 18px 16px;
    background:radial-gradient(120% 90% at 50% 0%, #fffdf6, #f0e3c6 70%, #e4d2ad 100%);
    box-shadow:inset 0 0 0 1px rgba(120,90,50,.4), inset 0 0 0 4px rgba(255,250,240,.5),
      inset 0 0 0 5px rgba(150,115,65,.35), 0 8px 18px rgba(0,0,0,.28);}
  .a2-plate.sel{box-shadow:inset 0 0 0 1px rgba(184,137,58,.9), inset 0 0 0 4px rgba(255,250,240,.6),
      inset 0 0 0 5px rgba(184,137,58,.6), inset 0 0 36px rgba(184,137,58,.18), 0 10px 22px rgba(0,0,0,.32);}
  .a2-art-niche{position:relative;height:150px;border-radius:6px;display:flex;align-items:flex-end;justify-content:center;overflow:hidden;
    background:radial-gradient(80% 75% at 50% 30%, rgba(255,248,228,.95), rgba(214,193,150,.85) 70%, rgba(120,95,55,.65));
    box-shadow:inset 0 0 0 1px rgba(120,90,50,.4), inset 0 -10px 24px rgba(90,65,35,.3), inset 0 8px 20px rgba(255,255,255,.4);}
  .a2-art-niche img{height:138px;image-rendering:auto;filter:drop-shadow(0 6px 6px rgba(40,28,15,.45));margin-bottom:-2px;}
  .a2-kit{display:flex;gap:8px;}
  .a2-slot{width:42px;height:42px;border-radius:6px;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(70% 70% at 50% 35%, #fffaf0, #e6d4b2);
    box-shadow:inset 0 0 0 1px rgba(120,90,50,.45), inset 0 2px 4px rgba(255,255,255,.5), 0 2px 4px rgba(0,0,0,.18);}
  .a2-slot img{width:30px;height:30px;object-fit:contain;filter:drop-shadow(0 1px 1px rgba(0,0,0,.3));}
  .a2-slot.bag{background:radial-gradient(70% 70% at 50% 35%, #efe2c6, #dcc8a2);}

  /* seats */
  .a2-seat{display:flex;align-items:center;gap:14px;padding:12px 16px;border-radius:7px;
    background:linear-gradient(180deg,rgba(255,250,240,.72),rgba(233,218,189,.5));
    box-shadow:inset 0 0 0 1px rgba(120,90,50,.32), inset 0 1px 0 rgba(255,255,255,.5);}
  .a2-seat.open{background:repeating-linear-gradient(135deg,rgba(160,140,110,.10) 0 10px,rgba(160,140,110,.04) 10px 20px);
    box-shadow:inset 0 0 0 1px rgba(120,90,50,.28);}
  .a2-token{width:46px;height:46px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;
    background:radial-gradient(70% 70% at 50% 30%, #fffaf0, #e0cda8);box-shadow:inset 0 0 0 1px rgba(120,90,50,.45), 0 2px 4px rgba(0,0,0,.2);}
  .a2-token img{width:40px;height:40px;object-fit:contain;}
  .a2-badge{font-family:"Cinzel",serif;font-weight:600;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;
    padding:4px 9px;border-radius:999px;}
  .a2-badge.ready{color:#274d12;background:rgba(111,174,61,.28);box-shadow:inset 0 0 0 1px rgba(90,122,58,.6);}
  .a2-badge.wait{color:${C.leather};background:rgba(184,137,58,.16);box-shadow:inset 0 0 0 1px rgba(184,137,58,.45);}
  .a2-badge.host{color:#7a5410;background:rgba(232,200,122,.4);box-shadow:inset 0 0 0 1px rgba(184,137,58,.6);}
  `;
  document.head.appendChild(s);
}

// ---- helpers ---------------------------------------------------------------
function el(tag: string, cls?: string, html?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function corners(panel: HTMLElement): void {
  const icon = "/sprites/map-icons/gateway.png";
  for (const pos of ["tl", "tr", "bl", "br"]) {
    const c = el("img", `a2-corner ${pos}`);
    (c as HTMLImageElement).src = icon;
    panel.appendChild(c);
  }
}

function dividerD(label?: string): HTMLElement {
  const d = el("div", "a2-rule-d");
  d.appendChild(el("span", "a2-diamond"));
  if (label) {
    const t = el("span", "a2-cinzel", label);
    t.style.cssText = "font-size:11px;font-weight:600;letter-spacing:.32em;text-transform:uppercase;color:#9c7430;";
    d.appendChild(t);
  }
  d.appendChild(el("span", "a2-diamond"));
  return d;
}

function panelShell(screen: MenuScreen, width: number): { stage: HTMLElement; inner: HTMLElement } {
  const stage = el("div", "a2-stage");
  const panel = el("div", "a2-panel");
  panel.style.width = `${width}px`;
  panel.style.maxWidth = "calc(100vw - 60px)";
  corners(panel);
  const inner = el("div", "a2-inner");
  panel.appendChild(inner);
  stage.appendChild(panel);
  void screen;
  return { stage, inner };
}

// ---- screens ---------------------------------------------------------------
function renderHome(inner: HTMLElement, withRooms: boolean): void {
  const head = el("div");
  head.style.textAlign = "center";
  head.appendChild(el("div", "a2-kicker", "Cooperative Expedition"));
  const h1 = el("h1", "a2-h1");
  h1.style.cssText = "font-size:46px;margin:12px 0 6px;white-space:nowrap;";
  h1.textContent = "Gather the Fellowship";
  head.appendChild(h1);
  const sub = el("p", "a2-sub", "Bind your fates and march into the dimensions together. Forge a warband of up to four heroes.");
  sub.style.cssText += "max-width:560px;margin:0 auto;text-align:center;";
  head.appendChild(sub);
  inner.appendChild(head);

  const d = el("div");
  d.style.margin = "26px 0 24px";
  d.appendChild(dividerD());
  inner.appendChild(d);

  // action trio
  const actions = el("div");
  actions.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;";
  const cards: Array<[string, string, string, string]> = [
    ["/sprites/map-icons/gateway.png", "Quick Match", "Drop into the next open warband instantly.", "Find a Game"],
    ["/sprites/map-icons/gateway-city.png", "Create Room", "Raise your own banner and host a run.", "Host"],
    ["/sprites/map-icons/city.png", "Join by Code", "Enter a six-letter sigil from a friend.", "Enter Code"],
  ];
  cards.forEach(([icon, title, desc, btn], idx) => {
    const c = el("div", "a2-plate" + (idx === 0 ? " sel" : ""));
    c.style.cssText += "padding:24px 20px 22px;text-align:center;display:flex;flex-direction:column;";
    const niche = el("div");
    niche.style.cssText = "width:64px;height:64px;margin:0 auto 14px;border-radius:50%;display:flex;align-items:center;justify-content:center;" +
      "background:radial-gradient(70% 70% at 50% 35%,#fffaf0,#e3d0aa);box-shadow:inset 0 0 0 1px rgba(184,137,58,.55), inset 0 0 0 4px rgba(255,250,240,.5), 0 3px 6px rgba(0,0,0,.2);";
    const im = el("img") as HTMLImageElement;
    im.src = icon; im.style.cssText = "width:36px;height:36px;object-fit:contain;";
    niche.appendChild(im);
    c.appendChild(niche);
    const t = el("div", "a2-cinzel", title);
    t.style.cssText = "font-weight:800;font-size:18px;letter-spacing:.04em;color:#3a2b1d;margin-bottom:6px;";
    c.appendChild(t);
    const ds = el("p", "a2-sub", desc);
    ds.style.cssText += "font-size:13.5px;flex:1;margin-bottom:16px;";
    c.appendChild(ds);
    const b = el("button", `a2-btn ${idx === 0 ? "a2-btn-primary" : "a2-btn-ghost"}`, btn);
    b.style.cssText += "width:100%;padding:12px;font-size:13.5px;";
    c.appendChild(b);
    actions.appendChild(c);
  });
  inner.appendChild(actions);

  if (withRooms) {
    const rd = el("div");
    rd.style.margin = "30px 0 18px";
    rd.appendChild(dividerD("Open Warbands"));
    inner.appendChild(rd);

    const list = el("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:11px;";
    for (const r of mockRooms) {
      const row = el("div", "a2-room");
      const sigil = el("div");
      sigil.style.cssText = "width:42px;height:42px;border-radius:8px;display:flex;align-items:center;justify-content:center;" +
        "background:radial-gradient(70% 70% at 50% 30%,#fffaf0,#e0cda8);box-shadow:inset 0 0 0 1px rgba(120,90,50,.45);";
      const si = el("img") as HTMLImageElement;
      si.src = r.dimensionId >= 2 ? "/sprites/map-icons/ruins.png" : "/sprites/map-icons/town.png";
      si.style.cssText = "width:28px;height:28px;object-fit:contain;";
      sigil.appendChild(si);
      row.appendChild(sigil);

      const mid = el("div");
      mid.appendChild(el("div", "a2-room-code", r.code));
      const host = el("div", "a2-sub", `Hosted by <b style="color:${C.inkSoft}">${r.hostDisplayName}</b> · Dimension ${r.dimensionId}`);
      host.style.cssText += "font-size:13px;margin-top:2px;";
      mid.appendChild(host);
      row.appendChild(mid);

      const full = r.openSeats === 0;
      const seats = el("div", "a2-pill", `${r.totalSeats - r.openSeats}/${r.totalSeats} seated`);
      row.appendChild(seats);

      const join = el("button", `a2-btn ${full ? "a2-btn-ghost" : "a2-btn-primary"}`, full ? "Full" : "Join");
      join.style.cssText += "padding:11px 22px;font-size:13.5px;";
      if (full) join.style.opacity = ".55";
      row.appendChild(join);
      list.appendChild(row);
    }
    inner.appendChild(list);
  }
}

function renderLobby(inner: HTMLElement): void {
  const room = lobbyRoom();

  // header
  const head = el("div");
  head.style.cssText = "display:flex;align-items:flex-end;justify-content:space-between;gap:24px;";
  const left = el("div");
  left.appendChild(el("div", "a2-kicker", "The Warband Assembles"));
  const h1 = el("h1", "a2-h1");
  h1.style.cssText = "font-size:34px;margin:8px 0 0;";
  h1.textContent = "Warband Lobby";
  left.appendChild(h1);
  head.appendChild(left);

  const codeChip = el("div");
  codeChip.style.cssText = "text-align:right;";
  const cl = el("div", "a2-cinzel", "Share Sigil");
  cl.style.cssText = "font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:#9c7430;margin-bottom:6px;";
  codeChip.appendChild(cl);
  const cc = el("div", "a2-cinzel", room.code);
  cc.style.cssText = "font-weight:800;font-size:24px;letter-spacing:.22em;color:#3a2b1d;padding:8px 16px;border-radius:7px;" +
    "background:radial-gradient(80% 80% at 50% 30%,#fffaf0,#e6d4b2);box-shadow:inset 0 0 0 1px rgba(184,137,58,.6), inset 0 0 0 4px rgba(255,250,240,.5);";
  codeChip.appendChild(cc);
  head.appendChild(codeChip);
  inner.appendChild(head);

  const d1 = el("div");
  d1.style.margin = "22px 0 18px";
  d1.appendChild(dividerD("Choose Your Calling"));
  inner.appendChild(d1);

  // preset plates — horizontal
  const grid = el("div");
  grid.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:18px;";
  STARTER_PRESETS.forEach((p, i) => {
    const plate = el("div", `a2-plate${i === 0 ? " sel" : ""}`);
    // banner head
    const ph = el("div");
    ph.style.cssText = "display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px;";
    const pn = el("div", "a2-cinzel", p.name);
    pn.style.cssText = "font-weight:800;font-size:21px;letter-spacing:.04em;color:#3a2b1d;";
    ph.appendChild(pn);
    const tag = el("div", "a2-cinzel", PRESET_TAG[p.id] ?? "");
    tag.style.cssText = "font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#9c7430;";
    ph.appendChild(tag);
    plate.appendChild(ph);

    const niche = el("div", "a2-art-niche");
    const art = el("img") as HTMLImageElement;
    art.src = CLASS_ART[p.id] ?? CLASS_ART.vanguard!;
    niche.appendChild(art);
    plate.appendChild(niche);

    const desc = el("p", "a2-sub", p.description);
    desc.style.cssText = "font-size:13.5px;margin:13px 0 14px;min-height:42px;";
    plate.appendChild(desc);

    const kitLabel = el("div", "a2-cinzel", "Starting Kit");
    kitLabel.style.cssText = "font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:#9c7430;margin-bottom:8px;";
    plate.appendChild(kitLabel);

    const kit = el("div", "a2-kit");
    for (const id of p.equippedIds) kit.appendChild(itemSlot(id, false));
    for (const id of p.bagIds) kit.appendChild(itemSlot(id, true));
    plate.appendChild(kit);

    if (i === 0) {
      const chosen = el("div", "a2-cinzel", "✦ Your Choice");
      chosen.style.cssText = "margin-top:14px;text-align:center;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#7a5410;" +
        "padding:7px;border-radius:5px;background:rgba(232,200,122,.3);box-shadow:inset 0 0 0 1px rgba(184,137,58,.5);";
      plate.appendChild(chosen);
    }
    grid.appendChild(plate);
  });
  inner.appendChild(grid);

  const d2 = el("div");
  d2.style.margin = "24px 0 16px";
  d2.appendChild(dividerD("The Roster"));
  inner.appendChild(d2);

  // roster
  const roster = el("div");
  roster.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:12px;";
  for (const seat of room.seats) {
    const row = el("div", `a2-seat${seat.state === "open" ? " open" : ""}`);
    const token = el("div", "a2-token");
    if (seat.state === "open") {
      token.innerHTML = `<span style="font-size:22px;color:${C.muted};font-family:Cinzel,serif">+</span>`;
    } else {
      const ti = el("img") as HTMLImageElement;
      ti.src = seat.isHost ? "/sprites/player/blue-player-idle.webp" : "/sprites/player/red-player-idle.webp";
      token.appendChild(ti);
    }
    row.appendChild(token);

    const mid = el("div");
    mid.style.cssText = "flex:1;min-width:0;";
    if (seat.state === "open") {
      const nm = el("div", "a2-cinzel", "Open Seat");
      nm.style.cssText = "font-weight:600;font-size:16px;color:#8a7a68;";
      mid.appendChild(nm);
      const w = el("div", "a2-sub", "Awaiting a hero…");
      w.style.cssText += "font-size:12.5px;";
      mid.appendChild(w);
    } else {
      const nameRow = el("div");
      nameRow.style.cssText = "display:flex;align-items:center;gap:8px;";
      const nm = el("div", "a2-cinzel", seat.displayName);
      nm.style.cssText = "font-weight:800;font-size:16px;color:#3a2b1d;";
      nameRow.appendChild(nm);
      if (seat.isHost) nameRow.appendChild(el("span", "a2-badge host", "Host"));
      if (seat.state === "bot") {
        const b = el("span", "a2-badge wait", "AI");
        nameRow.appendChild(b);
      }
      mid.appendChild(nameRow);
      const presetName = STARTER_PRESETS.find((p) => p.id === seat.presetId)?.name ?? "Choosing…";
      const cls = el("div", "a2-sub", presetName);
      cls.style.cssText += "font-size:12.5px;color:#6b5b4a;";
      mid.appendChild(cls);
    }
    row.appendChild(mid);

    if (seat.state !== "open") {
      const badge = el("span", `a2-badge ${seat.ready ? "ready" : "wait"}`, seat.ready ? "Ready" : "Choosing");
      row.appendChild(badge);
    }
    roster.appendChild(row);
  }
  inner.appendChild(roster);

  // footer actions
  const foot = el("div");
  foot.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-top:24px;gap:16px;";
  const status = el("div", "a2-sub", "2 of 3 heroes ready · waiting on the host to begin");
  status.style.cssText += "font-size:13.5px;";
  foot.appendChild(status);
  const btns = el("div");
  btns.style.cssText = "display:flex;gap:12px;";
  btns.appendChild(el("button", "a2-btn a2-btn-ghost", "Leave"));
  btns.appendChild(el("button", "a2-btn a2-btn-primary", "Begin Expedition"));
  foot.appendChild(btns);
  inner.appendChild(foot);
}

function itemSlot(id: string, bag: boolean): HTMLElement {
  const slot = el("div", `a2-slot${bag ? " bag" : ""}`);
  slot.title = ITEM_LABEL[id] ?? id;
  const im = el("img") as HTMLImageElement;
  im.src = `/sprites/items/${id}.webp`;
  slot.appendChild(im);
  return slot;
}

function renderGameOver(inner: HTMLElement): void {
  const wrap = el("div");
  wrap.style.textAlign = "center";
  wrap.appendChild(el("div", "a2-kicker", "The Run Has Ended"));
  const h1 = el("h1", "a2-h1");
  h1.style.cssText = "font-size:46px;margin:14px 0 8px;color:#6e2a2a;text-shadow:0 1px 0 rgba(255,255,255,.4);white-space:nowrap;";
  h1.textContent = "Your Party Has Fallen";
  wrap.appendChild(h1);
  const sub = el("p", "a2-sub", "The dimension claims another warband. Their deeds are inked into the great ledger — yet the gateway still glows for those brave enough to return.");
  sub.style.cssText += "max-width:540px;margin:0 auto;text-align:center;";
  wrap.appendChild(sub);

  const d = el("div");
  d.style.margin = "26px auto 24px";
  d.style.maxWidth = "320px";
  d.appendChild(dividerD());
  wrap.appendChild(d);

  // run epitaph stats
  const stats = el("div");
  stats.style.cssText = "display:flex;gap:14px;justify-content:center;margin-bottom:28px;";
  const data: Array<[string, string, string]> = [
    ["/sprites/map-icons/treasure.png", "Depth Reached", "Dimension 1 · 4 nodes"],
    ["/sprites/map-icons/boss.png", "Foes Vanquished", "37 enemies"],
    ["/sprites/map-icons/ruins.png", "Heroes Lost", "3 of 3"],
  ];
  for (const [icon, label, val] of data) {
    const c = el("div", "a2-plate");
    c.style.cssText += "padding:18px 22px;text-align:center;min-width:180px;";
    const im = el("img") as HTMLImageElement;
    im.src = icon; im.style.cssText = "width:34px;height:34px;object-fit:contain;margin-bottom:8px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.25));";
    c.appendChild(im);
    const l = el("div", "a2-cinzel", label);
    l.style.cssText = "font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#9c7430;margin-bottom:5px;";
    c.appendChild(l);
    const v = el("div", "a2-cinzel", val);
    v.style.cssText = "font-weight:800;font-size:15px;color:#3a2b1d;";
    c.appendChild(v);
    stats.appendChild(c);
  }
  wrap.appendChild(stats);

  const cta = el("div");
  cta.style.cssText = "display:flex;gap:14px;justify-content:center;";
  cta.appendChild(el("button", "a2-btn a2-btn-primary", "Venture Forth Again"));
  cta.appendChild(el("button", "a2-btn a2-btn-ghost", "Return to Gateway"));
  wrap.appendChild(cta);

  inner.appendChild(wrap);
}

// ---- entry -----------------------------------------------------------------
export function renderVariant(screen: MenuScreen, root: HTMLElement): void {
  injectStyle();
  root.innerHTML = "";
  const r = el("div", "a2-root");

  const bg = el("div", "a2-bg");
  bg.style.backgroundImage = `url("${BACKDROPS[screen]}")`;
  r.appendChild(bg);
  r.appendChild(el("div", "a2-bg-tint"));

  let width = 760;
  if (screen === "home-rooms") width = 820;
  if (screen === "lobby") width = 1060;
  if (screen === "gameover") width = 760;

  const { stage, inner } = panelShell(screen, width);

  if (screen === "home") renderHome(inner, false);
  else if (screen === "home-rooms") renderHome(inner, true);
  else if (screen === "lobby") renderLobby(inner);
  else renderGameOver(inner);

  r.appendChild(stage);
  root.appendChild(r);
}
