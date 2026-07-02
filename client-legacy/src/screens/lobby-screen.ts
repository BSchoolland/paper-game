import type { Screen } from "./screen-manager.js";
import type { RoomConnection } from "../net/connection.js";
import type { SeatContext } from "../state/seat-context.js";
import type { AccountStore } from "../state/account-store.js";
import type { CodexStore } from "../state/codex-store.js";
import type { CodexEntryPayload, ContractOffer, DimensionOption, RoomStatePayload, SeatInfo } from "shared";
import { STARTER_PRESETS, contractById, effectiveStartingTier, expeditionSlots, isManifestable } from "shared";
import { assetUrl } from "../renderer/asset-url.js";
import {
  THEME,
  FONT,
  boardBackdrop,
  panelCard,
  rule,
  btn,
  eyebrow,
  heading,
  presetPlate,
  levelChip,
  titleTag,
  designChip,
  errorNote,
  RARITY_COLOR,
} from "./ui-kit.js";

const PRESET_NAME: Record<string, string> = Object.fromEntries(
  STARTER_PRESETS.map((p) => [p.id, p.name]),
);

/**
 * The in-room STAGING screen (RoomPhase "lobby"): room code, seat roster, a per-seat ready toggle,
 * a loadout button (opens the inventory in loadout mode pre-Start), a host-only Start that bot-fills
 * empty seats server-side, and Leave. The out-of-room entry + matchmaking lives in HomeScreen. All
 * roster data comes from `roomState` via the SeatContext; readiness/start are server-authoritative.
 *
 * Layout: a wide dark slate panel — a header (room-code chip), a 2-column body (roster rail left,
 * preset plates right), and a footer action bar.
 */
export class LobbyScreen implements Screen {
  private container: HTMLDivElement;
  private unsub: (() => void) | null = null;
  private offers: readonly ContractOffer[] = [];
  private dimOptions: readonly DimensionOption[] = [];
  /** Manifest picker popover open/closed (survives the full-innerHTML re-renders). */
  private pickerOpen = false;
  /** Own manifest ids as last rendered — a server-side shrink without a local send means the
   *  dimension-change re-validation dropped picks (§4.6) and the notice must show. */
  private renderedManifestIds: readonly string[] | null = null;
  private manifestInteracted = false;
  private droppedNotice = false;
  private manifestSection: HTMLDivElement | null = null;
  private onOutsideClick = (e: MouseEvent): void => {
    if (this.manifestSection && !this.manifestSection.contains(e.target as Node)) this.closePicker();
  };

  constructor(
    private conn: RoomConnection,
    private seat: SeatContext,
    private account: AccountStore,
    private codex: CodexStore,
    private onOpenLoadout: () => void,
  ) {
    this.container = document.createElement("div");
    this.container.id = "lobby-screen";
    this.container.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 90;
      display: none;
      align-items: center;
      justify-content: center;
      font-family: ${FONT.body};
      color: ${THEME.parch};
      background: ${THEME.deep};
    `;
    document.body.appendChild(this.container);

    // Offers arrive once per seat-landing in a lobby-phase room (server-pushed, per-map;
    // re-sent when the lobby's dimension changes).
    this.conn.on("contractOffers", (msg) => {
      this.offers = msg.offers;
      this.render();
    });

    // Startable dimensions (tier-0 + party-charted union); re-broadcast when the seated-account
    // union changes.
    this.conn.on("dimensionOptions", (msg) => {
      this.dimOptions = msg.options;
      this.render();
    });

    // Codex designs feed the manifest picker (fetched on enter, held in the shared store).
    this.codex.subscribe(() => this.render());
  }

  enter() {
    this.container.style.display = "flex";
    this.pickerOpen = false;
    this.renderedManifestIds = null;
    this.manifestInteracted = false;
    this.droppedNotice = false;
    this.conn.send({ type: "getCodex" });
    this.unsub = this.seat.subscribe(() => this.render());
    this.render();
  }

  exit() {
    this.container.style.display = "none";
    this.closePicker();
    this.unsub?.();
    this.unsub = null;
  }

  private render() {
    const room = this.seat.room;
    if (room && room.phase === "lobby") this.renderRoster(room);
    else this.container.innerHTML = ""; // room-less / past-lobby: the screen manager switches away
  }

  private renderRoster(room: RoomStatePayload) {
    this.container.innerHTML = "";
    this.container.appendChild(boardBackdrop("lobby"));

    const card = panelCard({ padded: false });
    card.style.width = "1140px";
    card.style.maxWidth = "94vw";
    card.style.maxHeight = "92vh";
    card.style.display = "flex";
    card.style.flexDirection = "column";

    card.appendChild(this.header(room));
    card.appendChild(this.body(room));
    card.appendChild(this.destinationBoard(room));
    card.appendChild(this.contractBoard(room));
    card.appendChild(this.manifestBoard(room));
    card.appendChild(this.footer(room));

    this.container.appendChild(card);
  }

  /** Header: eyebrow + "War Council" title flanked by the room-code chip, plus a context line. */
  private header(room: RoomStatePayload): HTMLDivElement {
    const header = document.createElement("div");
    header.style.cssText = "display:flex; align-items:center; justify-content:space-between; padding:28px 44px 20px; flex:0 0 auto;";

    const left = document.createElement("div");
    left.appendChild(eyebrow("Party Lobby"));

    const codeRow = document.createElement("div");
    codeRow.style.cssText = "display:flex; align-items:baseline; gap:16px; margin-top:8px;";
    const title = heading("War Council", "section");
    title.style.font = `800 38px ${FONT.cinzel}`;
    title.style.color = THEME.parch;

    const chip = document.createElement("div");
    chip.textContent = room.code;
    chip.style.cssText = `
      font:600 18px ${FONT.cinzel}; letter-spacing:0.22em; color:${THEME.gold};
      padding:6px 14px; border:1px solid ${THEME.gold}; border-radius:8px;
      background:rgba(11,9,6,0.55); box-shadow:0 0 14px -4px rgba(232,200,122,0.5);
    `;
    codeRow.append(title, chip);
    left.appendChild(codeRow);
    header.appendChild(left);

    const ctx = document.createElement("div");
    ctx.style.cssText = `text-align:right; font:13px/1.7 ${FONT.body}; color:${THEME.muted};`;
    ctx.innerHTML = `Dimension <b style="color:${THEME.gold}">${room.dimensionName}</b> · Tier ${room.dimensionTier ?? "—"}<br/>
      <span style="color:${THEME.faint}">${this.seat.isHost() ? "Begin when your warband is ready" : "Waiting on the host to begin"}</span>`;
    header.appendChild(ctx);

    return header;
  }

  /** Two-column body: roster rail (left) + preset picker (right). */
  private body(room: RoomStatePayload): HTMLDivElement {
    const ruleWrap = document.createElement("div");
    ruleWrap.style.cssText = "padding:0 44px; flex:0 0 auto;";
    ruleWrap.appendChild(rule());

    const body = document.createElement("div");
    body.style.cssText = "display:grid; grid-template-columns:380px 1fr; flex:1 1 auto; min-height:0;";

    body.appendChild(this.rosterRail(room));
    body.appendChild(this.presetPicker(room));

    const outer = document.createElement("div");
    outer.style.cssText = "display:flex; flex-direction:column; flex:1 1 auto; min-height:0;";
    outer.append(ruleWrap, body);
    return outer;
  }

  /**
   * Full-width destination picker: the server's startable dimensions (tier-0 + party-charted)
   * as mini-cards. The host clicks to re-point the expedition (`chooseDimension`); everyone sees
   * the live pick via `roomState.dimensionId`.
   */
  private destinationBoard(room: RoomStatePayload): HTMLDivElement {
    const amHost = this.seat.isHost();

    const section = document.createElement("div");
    section.style.cssText = "padding:0 44px 22px; flex:0 0 auto; display:flex; flex-direction:column;";
    section.appendChild(rule());

    const head = document.createElement("div");
    head.style.cssText = "display:flex; align-items:baseline; gap:14px; margin:16px 0 12px;";
    head.appendChild(heading("Destination", "section"));
    const hint = document.createElement("div");
    hint.textContent = amHost ? "Choose where the expedition begins" : "The host chooses the destination";
    hint.style.cssText = `font:13px ${FONT.body}; color:${THEME.faint};`;
    head.appendChild(hint);
    section.appendChild(head);

    const row = document.createElement("div");
    row.style.cssText = `display:flex; flex-wrap:wrap; gap:${THEME.gap};`;
    for (const option of this.dimOptions) {
      row.appendChild(this.dimensionCard(option, option.id === room.dimensionId, amHost));
    }
    section.appendChild(row);

    return section;
  }

  private dimensionCard(option: DimensionOption, selected: boolean, amHost: boolean): HTMLDivElement {
    const card = document.createElement("div");
    card.style.cssText = `
      position:relative; flex:1; min-width:150px; box-sizing:border-box; padding:14px 16px; border-radius:10px;
      background:rgba(11,9,6,0.45);
      border:1px solid ${selected ? THEME.gold : THEME.goldLine};
      ${selected ? `box-shadow:0 0 14px -6px ${THEME.gold};` : ""}
      ${amHost ? "cursor:pointer;" : ""}
    `;
    if (amHost) {
      card.addEventListener("click", () => this.conn.send({ type: "chooseDimension", dimensionId: option.id }));
    }

    const name = document.createElement("div");
    name.textContent = option.name;
    name.style.cssText = `font:700 14px ${FONT.cinzel}; color:${THEME.gold};`;
    card.appendChild(name);

    const tier = document.createElement("div");
    tier.textContent = `TIER ${option.tier}`;
    tier.style.cssText = `font:11px ${FONT.body}; letter-spacing:.1em; color:${THEME.goldDeep}; margin-top:5px;`;
    card.appendChild(tier);

    if (selected) {
      const badge = document.createElement("div");
      badge.textContent = "CHOSEN";
      badge.style.cssText = `
        position:absolute; top:10px; right:10px;
        font:700 10px ${FONT.body}; letter-spacing:0.1em; color:#221a0c;
        background:linear-gradient(180deg,${THEME.gold},${THEME.goldDeep});
        padding:3px 9px; border-radius:6px;
      `;
      card.appendChild(badge);
    }

    return card;
  }

  /**
   * Full-width contract board: the server's per-map offers as mini-cards. The host clicks to
   * choose (`chooseContract`); everyone sees the live selection via `roomState.contract`. No
   * pick by start time → the run gets the default Chart the Wilds contract server-side.
   */
  private contractBoard(room: RoomStatePayload): HTMLDivElement {
    const amHost = this.seat.isHost();
    const selectedType = room.contract?.type ?? null;

    const section = document.createElement("div");
    section.style.cssText = "padding:0 44px 22px; flex:0 0 auto; display:flex; flex-direction:column;";
    section.appendChild(rule());

    const head = document.createElement("div");
    head.style.cssText = "display:flex; align-items:baseline; gap:14px; margin:16px 0 12px;";
    head.appendChild(heading("Contract", "section"));
    const hint = document.createElement("div");
    hint.textContent = amHost ? "Choose the party's contract" : "The host chooses the contract";
    hint.style.cssText = `font:13px ${FONT.body}; color:${THEME.faint};`;
    head.appendChild(hint);
    section.appendChild(head);

    const row = document.createElement("div");
    row.style.cssText = `display:flex; gap:${THEME.gap};`;
    for (const offer of this.offers) row.appendChild(this.offerCard(offer, offer.type === selectedType, amHost));
    section.appendChild(row);

    if (selectedType === null) {
      const note = document.createElement("div");
      note.textContent = "Default: Chart the Wilds";
      note.style.cssText = `font:11px ${FONT.body}; color:${THEME.faint}; margin-top:8px;`;
      section.appendChild(note);
    }

    return section;
  }

  private offerCard(offer: ContractOffer, selected: boolean, amHost: boolean): HTMLDivElement {
    const def = contractById(offer.type);

    const card = document.createElement("div");
    card.style.cssText = `
      position:relative; flex:1; box-sizing:border-box; padding:14px 16px; border-radius:10px;
      background:rgba(11,9,6,0.45);
      border:1px solid ${selected ? THEME.gold : THEME.goldLine};
      ${selected ? `box-shadow:0 0 14px -6px ${THEME.gold};` : ""}
      ${amHost ? "cursor:pointer;" : ""}
    `;
    if (amHost) {
      card.addEventListener("click", () => this.conn.send({ type: "chooseContract", contractType: offer.type }));
    }

    const name = document.createElement("div");
    name.textContent = def.name;
    name.style.cssText = `font:700 14px ${FONT.cinzel}; color:${THEME.gold};`;
    card.appendChild(name);

    const desc = document.createElement("div");
    desc.textContent = def.description;
    desc.style.cssText = `font:12px/1.5 ${FONT.body}; color:${THEME.muted}; margin:5px 0 8px;`;
    card.appendChild(desc);

    const meta = document.createElement("div");
    meta.style.cssText = "display:flex; align-items:baseline; gap:10px;";
    const reward = document.createElement("span");
    reward.textContent = `+${def.xpReward} XP`;
    reward.style.cssText = `font:11px ${FONT.body}; color:${THEME.goldDeep};`;
    meta.appendChild(reward);
    if (offer.targetHex) {
      const bearing = document.createElement("span");
      bearing.textContent = `(${offer.targetHex.q}, ${offer.targetHex.r})`;
      bearing.style.cssText = `font:11px ${FONT.body}; color:${THEME.faint};`;
      meta.appendChild(bearing);
    }
    card.appendChild(meta);

    if (selected) {
      const badge = document.createElement("div");
      badge.textContent = "CHOSEN";
      badge.style.cssText = `
        position:absolute; top:10px; right:10px;
        font:700 10px ${FONT.body}; letter-spacing:0.1em; color:#221a0c;
        background:linear-gradient(180deg,${THEME.gold},${THEME.goldDeep});
        padding:3px 9px; border-radius:6px;
      `;
      card.appendChild(badge);
    }

    return card;
  }

  /**
   * Full-width manifest section (03-loot-codex §6.4), below the contract board: K slot wells
   * for this seat's codex picks (K = expeditionSlots(level); server re-validates), a picker
   * popover over the account's designs with eligibility dimming, and a dropped-picks notice
   * when a dimension change returned now-ineligible picks server-side.
   */
  private manifestBoard(room: RoomStatePayload): HTMLDivElement {
    const profile = this.account.profile;
    if (!profile) throw new Error("LobbyScreen: seated without a profile (welcome must precede roomState)");
    const slots = expeditionSlots(profile.level);
    const startingTier = effectiveStartingTier(room.dimensionTier);
    const myInfo = room.seats.find((s) => s.seatId === room.yourSeatId);
    const picks = myInfo?.manifestIds ?? [];

    // Detect a server-side shrink this client did not send (dimension-change re-validation).
    const prev = this.renderedManifestIds;
    this.renderedManifestIds = [...picks];
    if (prev !== null && (prev.length !== picks.length || prev.some((id, i) => picks[i] !== id))) {
      if (!this.manifestInteracted && prev.some((id) => !picks.includes(id))) this.droppedNotice = true;
      this.manifestInteracted = false;
    }

    const section = document.createElement("div");
    section.style.cssText = "padding:0 44px 22px; flex:0 0 auto; display:flex; flex-direction:column;";
    section.appendChild(rule());
    this.manifestSection = section;

    const head = document.createElement("div");
    head.style.cssText = "display:flex; align-items:baseline; gap:14px; margin:16px 0 12px;";
    head.appendChild(heading("Manifest", "section"));
    const hint = document.createElement("div");
    hint.textContent =
      `Bring up to ${slots} codex designs · tier ${startingTier} or below` +
      (room.dimensionTier === null ? " · Unplaced expedition — tier 0 designs only" : "");
    hint.style.cssText = `font:13px ${FONT.body}; color:${THEME.faint};`;
    head.appendChild(hint);
    section.appendChild(head);

    if (this.droppedNotice) {
      const note = errorNote("Some manifested designs exceed the new destination's tier and were returned.");
      note.style.marginBottom = "10px";
      section.appendChild(note);
    }

    const slotWrap = document.createElement("div");
    slotWrap.style.cssText = "position:relative;";
    const slotRow = document.createElement("div");
    slotRow.style.cssText = "display:flex; gap:10px;";
    for (let i = 0; i < slots; i++) {
      slotRow.appendChild(this.slotWell(picks, picks[i] ?? null));
    }
    slotWrap.appendChild(slotRow);
    if (this.pickerOpen) slotWrap.appendChild(this.manifestPicker(picks, startingTier));
    section.appendChild(slotWrap);

    return section;
  }

  /** One 48px manifest slot: a picked design (chip + ✕ remove) or a dashed click-to-pick well. */
  private slotWell(picks: readonly string[], itemId: string | null): HTMLDivElement {
    const well = document.createElement("div");
    well.style.cssText = `
      position:relative; width:48px; height:48px; box-sizing:border-box; flex:0 0 auto;
      display:flex; align-items:center; justify-content:center;
      border:1px dashed ${THEME.goldLine}; border-radius:8px;
    `;
    if (itemId === null) {
      well.style.cursor = "pointer";
      well.title = "Add a codex design";
      const plus = document.createElement("span");
      plus.textContent = "+";
      plus.style.cssText = `font:20px ${FONT.cinzel}; color:${THEME.faint};`;
      well.appendChild(plus);
      well.addEventListener("click", () => this.openPicker());
      return well;
    }

    const entry = this.codex.entries.find((e) => e.item.id === itemId);
    if (entry) {
      well.appendChild(designChip(entry.item, 40));
    } else {
      // Codex fetch still in flight (reconnect into the lobby): the id is known-good server-side.
      const pending = document.createElement("span");
      pending.textContent = "…";
      pending.title = itemId;
      pending.style.cssText = `font:16px ${FONT.body}; color:${THEME.faint};`;
      well.appendChild(pending);
    }

    const remove = document.createElement("button");
    remove.tabIndex = -1;
    remove.textContent = "✕";
    remove.title = "Remove";
    remove.style.cssText = `
      position:absolute; top:-7px; right:-7px; width:18px; height:18px; box-sizing:border-box;
      display:flex; align-items:center; justify-content:center; padding:0; cursor:pointer;
      font:700 10px ${FONT.body}; color:${THEME.parch};
      background:${THEME.dangerDeep}; border:1px solid ${THEME.danger}; border-radius:50%;
    `;
    remove.addEventListener("click", () => this.sendManifest(picks.filter((id) => id !== itemId)));
    well.appendChild(remove);
    return well;
  }

  /** Picker popover (titlesPopover precedent), anchored under the slot row. */
  private manifestPicker(picks: readonly string[], startingTier: number): HTMLDivElement {
    const pop = document.createElement("div");
    pop.style.cssText = `
      position:absolute; top:56px; left:0; right:0; z-index:5;
      background:linear-gradient(180deg, ${THEME.slate2}, ${THEME.ink});
      border:1px solid ${THEME.goldLine}; border-radius:10px;
      box-shadow:0 14px 34px -10px rgba(0,0,0,0.8);
    `;

    if (this.codex.entries.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No designs in your codex yet — win an expedition to bank your first.";
      empty.style.cssText = `padding:12px 14px; font:12.5px ${FONT.body}; color:${THEME.muted};`;
      pop.appendChild(empty);
      return pop;
    }

    const grid = document.createElement("div");
    grid.style.cssText = `
      display:grid; grid-template-columns:repeat(auto-fill, minmax(210px, 1fr)); gap:8px;
      padding:12px; max-height:240px; overflow-y:auto;
    `;
    for (const entry of this.codex.entries) {
      grid.appendChild(this.pickerCell(entry, picks, startingTier));
    }
    pop.appendChild(grid);
    return pop;
  }

  private pickerCell(entry: CodexEntryPayload, picks: readonly string[], startingTier: number): HTMLElement {
    const picked = picks.includes(entry.item.id);
    const eligible = !picked && isManifestable(entry.item, entry.tier, startingTier);
    const reason =
      picked ? "Picked"
      : entry.item.type === "consumable" ? "Run-scoped"
      : entry.tier > startingTier ? "Tier too high"
      : null;

    const cell = document.createElement("button");
    cell.tabIndex = -1;
    cell.style.cssText = `
      display:flex; align-items:center; gap:9px; text-align:left; box-sizing:border-box;
      padding:8px 10px; border:1px solid rgba(184,137,58,0.25); border-radius:8px;
      background:rgba(11,9,6,0.35);
      ${eligible ? "cursor:pointer;" : "opacity:.45;"}
    `;
    cell.disabled = !eligible;
    cell.appendChild(designChip(entry.item, 34));

    const info = document.createElement("div");
    info.style.cssText = "flex:1; min-width:0;";
    const name = document.createElement("div");
    name.textContent = entry.item.name;
    name.style.cssText = `
      font:600 13px ${FONT.body}; color:${RARITY_COLOR[entry.item.rarity]};
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    `;
    info.appendChild(name);
    const meta = document.createElement("div");
    meta.style.cssText = "display:flex; align-items:baseline; gap:8px; margin-top:2px;";
    const tier = document.createElement("span");
    tier.textContent = `TIER ${entry.tier}`;
    tier.style.cssText = `font:11px ${FONT.body}; letter-spacing:.1em; color:${THEME.goldDeep};`;
    meta.appendChild(tier);
    if (reason) {
      const why = document.createElement("span");
      why.textContent = reason;
      why.style.cssText = `font:11px ${FONT.body}; color:${THEME.faint};`;
      meta.appendChild(why);
    }
    info.appendChild(meta);
    cell.appendChild(info);

    if (eligible) {
      cell.addEventListener("mouseenter", () => (cell.style.borderColor = THEME.gold));
      cell.addEventListener("mouseleave", () => (cell.style.borderColor = "rgba(184,137,58,0.25)"));
      cell.addEventListener("click", () => {
        this.sendManifest([...picks, entry.item.id]);
        this.closePicker();
      });
    }
    return cell;
  }

  /** Full-replacement manifest send; also clears the dropped-picks notice (§6.4). */
  private sendManifest(itemIds: readonly string[]): void {
    this.droppedNotice = false;
    this.manifestInteracted = true;
    this.conn.send({ type: "chooseManifest", itemIds });
  }

  private openPicker(): void {
    if (this.pickerOpen) return;
    this.pickerOpen = true;
    document.addEventListener("mousedown", this.onOutsideClick);
    this.render();
  }

  private closePicker(): void {
    if (!this.pickerOpen) return;
    this.pickerOpen = false;
    document.removeEventListener("mousedown", this.onOutsideClick);
    this.render();
  }

  /** Left rail: "Roster" heading over one ledger row per seat. */
  private rosterRail(room: RoomStatePayload): HTMLDivElement {
    const roster = document.createElement("div");
    roster.style.cssText = `padding:26px 32px 30px; border-right:1px solid ${THEME.goldLine}; overflow-y:auto;`;

    const title = heading("Roster", "section");
    title.style.marginBottom = "16px";
    roster.appendChild(title);

    const list = document.createElement("div");
    list.style.cssText = "display:flex; flex-direction:column; gap:12px;";
    for (const s of room.seats) list.appendChild(this.seatRow(s, room));
    roster.appendChild(list);
    return roster;
  }

  /** A seat ledger row: avatar token, name + host/bot badge + preset, and a ready badge. */
  private seatRow(s: SeatInfo, room: RoomStatePayload): HTMLDivElement {
    const isMe = s.seatId === room.yourSeatId;
    const isOpen = s.state === "open";
    const isBot = s.state === "bot";
    const isDropped = s.state === "human-disconnected";

    const row = document.createElement("div");
    row.style.cssText = `
      display:flex; align-items:center; gap:13px; padding:13px 15px; border-radius:11px;
      background:${isOpen
        ? "rgba(11,9,6,0.35)"
        : "linear-gradient(180deg, rgba(58,47,37,0.5), rgba(33,27,22,0.6))"};
      border:1px solid ${isMe ? THEME.greenBright : isOpen ? "rgba(138,122,104,0.5)" : "rgba(184,137,58,0.3)"};
      ${isOpen ? "border-style:dashed;" : ""}
      ${isMe ? `box-shadow:inset 0 0 0 1px ${THEME.greenBright};` : ""}
    `;

    // avatar
    const avatar = document.createElement("div");
    avatar.style.cssText = `
      width:46px; height:46px; flex:0 0 auto; border-radius:50%; box-sizing:border-box;
      border:1px solid ${THEME.goldLine};
      background:radial-gradient(circle, rgba(184,137,58,0.2), rgba(11,9,6,0.5));
      display:flex; align-items:center; justify-content:center; overflow:hidden;
    `;
    if (isOpen) {
      avatar.innerHTML = `<span style="font:22px ${FONT.cinzel}; color:${THEME.faint}">+</span>`;
    } else {
      const tok = document.createElement("img");
      tok.src = assetUrl(isMe ? "/sprites/player/blue-player-idle.webp" : "/sprites/player/red-player-idle.webp");
      tok.style.cssText = `
        width:54px; height:54px; object-fit:contain; transform:translateY(4px);
        filter:${isDropped ? "grayscale(1)" : "none"};
        opacity:${isDropped ? ".5" : isBot ? ".6" : "1"};
      `;
      avatar.appendChild(tok);
    }
    row.appendChild(avatar);

    // info
    const info = document.createElement("div");
    info.style.cssText = "flex:1; min-width:0;";

    const nameRow = document.createElement("div");
    nameRow.style.cssText = "display:flex; align-items:center; gap:8px;";
    const name = document.createElement("div");
    name.textContent =
      isOpen ? "Open Seat"
      : isDropped ? `${s.displayName} (dropped)`
      : s.displayName;
    name.style.cssText = `font:600 16px ${FONT.body}; color:${isOpen ? THEME.faint : THEME.parch}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`;
    nameRow.appendChild(name);
    if (s.level !== null) nameRow.appendChild(levelChip(s.level));
    if (s.isHost) nameRow.appendChild(this.badge("HOST", THEME.goldDeep, THEME.goldLine));
    if (isBot) nameRow.appendChild(this.badge("BOT", THEME.muted, THEME.faint));
    info.appendChild(nameRow);

    const sub = document.createElement("div");
    sub.style.cssText = `display:flex; align-items:center; gap:6px; font:12.5px ${FONT.body}; color:${THEME.muted}; margin-top:3px;`;
    if (isOpen) {
      sub.textContent = "Invite a friend or add a bot";
    } else {
      if (s.equippedTitleId !== null) {
        sub.appendChild(titleTag(s.equippedTitleId));
        const sep = document.createElement("span");
        sep.textContent = "·";
        sep.style.color = THEME.faint;
        sub.appendChild(sep);
      }
      const preset = document.createElement("span");
      preset.textContent = s.presetId ? PRESET_NAME[s.presetId] ?? "Choosing kit…" : "Choosing kit…";
      sub.appendChild(preset);
      if (s.manifestIds.length > 0) {
        const manifests = document.createElement("span");
        manifests.textContent = `+${s.manifestIds.length} design${s.manifestIds.length === 1 ? "" : "s"}`;
        manifests.style.cssText = `
          flex:0 0 auto; font:11px ${FONT.body}; color:${THEME.goldDeep};
          border:1px solid ${THEME.goldLine}; border-radius:5px; padding:0 5px;
        `;
        sub.appendChild(manifests);
      }
    }
    info.appendChild(sub);
    row.appendChild(info);

    // ready state
    if (!isOpen) row.appendChild(this.readyTag(s.ready));

    return row;
  }

  private badge(text: string, color: string, borderColor: string): HTMLDivElement {
    const b = document.createElement("div");
    b.textContent = text;
    b.style.cssText = `font:10px ${FONT.body}; font-weight:600; letter-spacing:0.12em; color:${color}; border:1px solid ${borderColor}; padding:1px 6px; border-radius:5px;`;
    return b;
  }

  /** Bright green READY badge or a faint "waiting". */
  private readyTag(ready: boolean): HTMLDivElement {
    const tag = document.createElement("div");
    if (ready) {
      tag.style.cssText = `display:flex; align-items:center; gap:6px; font:700 12px ${FONT.body}; letter-spacing:0.08em; color:${THEME.greenBright};`;
      tag.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${THEME.greenBright};box-shadow:0 0 8px ${THEME.greenBright}"></span>READY`;
    } else {
      tag.style.cssText = `font:600 12px ${FONT.body}; letter-spacing:0.06em; color:${THEME.faint};`;
      tag.textContent = "waiting";
    }
    return tag;
  }

  /** Right column: "Choose Your Kit" heading + the three illuminated preset plates. */
  private presetPicker(room: RoomStatePayload): HTMLDivElement {
    const myInfo = room.seats.find((s) => s.seatId === room.yourSeatId);
    const selectedId = myInfo?.presetId ?? null;

    const right = document.createElement("div");
    right.style.cssText = "padding:26px 40px 28px; display:flex; flex-direction:column; min-width:0; overflow-y:auto;";

    const head = document.createElement("div");
    head.style.cssText = "display:flex; align-items:baseline; justify-content:space-between; margin-bottom:18px;";
    head.appendChild(heading("Choose Your Kit", "section"));
    const sel = document.createElement("div");
    const selName = selectedId ? (PRESET_NAME[selectedId] ?? selectedId).toUpperCase() : "NONE";
    sel.textContent = `YOUR SELECTION · ${selName}`;
    sel.style.cssText = `font:12px ${FONT.body}; letter-spacing:0.1em; color:${THEME.faint};`;
    head.appendChild(sel);
    right.appendChild(head);

    const cards = document.createElement("div");
    cards.style.cssText = "display:grid; grid-template-columns:repeat(3,1fr); gap:16px;";
    for (const preset of STARTER_PRESETS) {
      const plate = presetPlate(preset, preset.id === selectedId);
      plate.addEventListener("click", () =>
        this.conn.send({ type: "choosePreset", presetId: preset.id }),
      );
      cards.appendChild(plate);
    }
    right.appendChild(cards);

    const loadoutBtn = btn("Edit Loadout", "secondary");
    loadoutBtn.style.marginTop = "16px";
    loadoutBtn.style.alignSelf = "flex-start";
    loadoutBtn.addEventListener("click", () => this.onOpenLoadout());
    right.appendChild(loadoutBtn);

    return right;
  }

  /** Footer: readiness tally on the left; Leave + Ready (+ host Start) on the right. */
  private footer(room: RoomStatePayload): HTMLDivElement {
    const myInfo = room.seats.find((s) => s.seatId === room.yourSeatId);
    const amHost = this.seat.isHost();
    const filled = room.seats.filter((s) => s.state !== "open");
    const readyCount = filled.filter((s) => s.ready).length;
    const openCount = room.seats.filter((s) => s.state === "open").length;

    const footer = document.createElement("div");
    footer.style.cssText = `
      display:flex; align-items:center; justify-content:space-between; padding:20px 44px 26px; flex:0 0 auto;
      border-top:1px solid ${THEME.goldLine}; background:linear-gradient(180deg, transparent, rgba(11,9,6,0.5));
    `;

    const tally = document.createElement("div");
    tally.style.cssText = `font:13px ${FONT.body}; color:${THEME.muted};`;
    tally.innerHTML =
      `<b style="color:${THEME.greenBright}">${readyCount} of ${filled.length}</b> warriors ready` +
      (openCount > 0 ? ` · ${openCount} open seat${openCount === 1 ? "" : "s"}` : "");
    footer.appendChild(tally);

    const btns = document.createElement("div");
    btns.style.cssText = "display:flex; align-items:center; gap:14px;";

    const leaveBtn = btn("Leave", "danger");
    leaveBtn.addEventListener("click", () => this.conn.send({ type: "leaveRoom" }));
    btns.appendChild(leaveBtn);

    const readyBtn = btn(myInfo?.ready ? "Not Ready" : "I'm Ready", "primary");
    readyBtn.style.minWidth = "170px";
    if (myInfo?.ready) {
      readyBtn.style.background = `linear-gradient(180deg, ${THEME.green}, ${THEME.greenDeep})`;
      readyBtn.style.borderColor = THEME.greenBright;
      readyBtn.style.color = "#15240c";
    }
    readyBtn.addEventListener("click", () => {
      this.conn.send({ type: "setReady", ready: !(myInfo?.ready ?? false) });
    });
    btns.appendChild(readyBtn);

    if (amHost) {
      const startBtn = btn("Start Expedition", "primary");
      startBtn.title = "Empty seats are filled by bots on start.";
      startBtn.addEventListener("click", () => this.conn.send({ type: "startGame" }));
      btns.appendChild(startBtn);
    }
    footer.appendChild(btns);

    return footer;
  }
}
