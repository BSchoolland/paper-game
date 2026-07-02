import type { VoteKind, VoteStatePayload } from "shared";
import type { RoomConnection } from "../net/connection.js";
import type { SeatContext } from "../state/seat-context.js";
import { RARITY_COLOR, designChip } from "../screens/ui-kit.js";

const TITLE_BY_KIND: Record<VoteKind, string> = {
  move: "Move proposed",
  retreat: "Retreat proposed",
  travel: "Descent proposed",
  loot: "Claim proposed",
};

/**
 * The overworld vote panel (move + retreat + travel + loot proposals). Renders the open `voteState` — a tally
 * over the frozen electorate plus a deadline countdown — with yes/no buttons for the local seat.
 * Voting is server-authoritative: the panel only renders `voteState` and clears on `voteState:
 * null` / `moveResolved`; it never resolves locally. Hidden when there is no open vote.
 */
export class VotePanel {
  private container: HTMLDivElement;
  private title: HTMLDivElement;
  private subtitle: HTMLDivElement;
  private tally: HTMLDivElement;
  private countdown: HTMLDivElement;
  private yesBtn: HTMLButtonElement;
  private noBtn: HTMLButtonElement;
  private vote: VoteStatePayload | null = null;
  private timer: number | null = null;

  constructor(private conn: RoomConnection, private seat: SeatContext) {
    this.container = document.createElement("div");
    this.container.id = "vote-panel";
    this.container.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 120;
      display: none;
      flex-direction: column;
      gap: 8px;
      align-items: center;
      min-width: 260px;
      padding: 12px 16px;
      font-family: monospace;
      color: #4a3728;
      background: rgba(245, 235, 215, 0.96);
      border: 2px solid #6b5b4a;
      border-radius: 8px;
      box-shadow: 0 4px 14px rgba(35, 24, 14, 0.25);
      pointer-events: auto;
    `;

    this.title = document.createElement("div");
    this.title.style.cssText = "font-size:14px; font-weight:bold;";
    this.container.appendChild(this.title);

    this.subtitle = document.createElement("div");
    this.subtitle.style.cssText = "font-size:12px; color:#8a7a68; display:none;";
    this.container.appendChild(this.subtitle);

    this.tally = document.createElement("div");
    this.tally.style.cssText = "font-size:13px;";
    this.container.appendChild(this.tally);

    this.countdown = document.createElement("div");
    this.countdown.style.cssText = "font-size:12px; color:#8a7a68;";
    this.container.appendChild(this.countdown);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex; gap:10px; margin-top:4px;";
    this.yesBtn = voteButton("Yes", "#5a7a3a");
    this.noBtn = voteButton("No", "#8b3a3a");
    this.yesBtn.addEventListener("click", () => this.cast("yes"));
    this.noBtn.addEventListener("click", () => this.cast("no"));
    btnRow.appendChild(this.yesBtn);
    btnRow.appendChild(this.noBtn);
    this.container.appendChild(btnRow);

    document.body.appendChild(this.container);

    this.conn.on("voteState", (msg) => this.setVote(msg.vote));
    this.conn.on("moveResolved", () => this.setVote(null));
  }

  private cast(vote: "yes" | "no"): void {
    if (!this.vote) return;
    this.conn.send({ type: "castVote", proposalId: this.vote.proposalId, vote });
  }

  private setVote(vote: VoteStatePayload | null): void {
    this.vote = vote;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (!vote) {
      this.container.style.display = "none";
      return;
    }
    this.container.style.display = "flex";
    this.render();
    this.timer = window.setInterval(() => this.renderCountdown(), 250);
  }

  private render(): void {
    const vote = this.vote!;
    this.title.textContent = TITLE_BY_KIND[vote.kind];
    this.subtitle.innerHTML = "";
    this.subtitle.style.display = vote.kind === "move" ? "none" : "block";
    if (vote.kind === "retreat") {
      this.subtitle.textContent = "End the run at this gateway — bank 50% of pending XP";
    } else if (vote.kind === "travel") {
      this.subtitle.textContent = `Travel the gateway to ${vote.travel!.toName} (Tier ${vote.travel!.toTier})`;
    } else if (vote.kind === "loot") {
      const item = vote.loot!.item;
      const proposer = this.seat.room?.seats.find((s) => s.seatId === vote.proposerSeatId);
      this.subtitle.style.display = "flex";
      this.subtitle.style.alignItems = "center";
      this.subtitle.style.gap = "6px";
      this.subtitle.appendChild(designChip(item, 26));
      const line = document.createElement("span");
      const itemName = document.createElement("b");
      itemName.textContent = item.name;
      itemName.style.color = RARITY_COLOR[item.rarity];
      line.append(
        document.createTextNode(`${proposer ? proposer.displayName : vote.proposerSeatId} claims `),
        itemName,
      );
      this.subtitle.appendChild(line);
    }
    let yes = 0;
    let no = 0;
    for (const seatId of vote.electorate) {
      const choice = vote.votes[seatId];
      if (choice === "yes") yes++;
      else if (choice === "no") no++;
    }
    const pending = vote.electorate.length - yes - no;
    this.tally.textContent = `Yes ${yes}  ·  No ${no}  ·  Pending ${pending}  (of ${vote.electorate.length})`;

    const canVote = !!this.seat.mySeatId && vote.electorate.includes(this.seat.mySeatId);
    const myChoice = this.seat.mySeatId ? vote.votes[this.seat.mySeatId] : undefined;
    this.styleButton(this.yesBtn, canVote, myChoice === "yes");
    this.styleButton(this.noBtn, canVote, myChoice === "no");
    this.yesBtn.textContent = myChoice === "yes" ? "Yes ✓" : "Yes";
    this.noBtn.textContent = myChoice === "no" ? "No ✓" : "No";
    this.renderCountdown();
  }

  private renderCountdown(): void {
    if (!this.vote) return;
    const remainMs = Math.max(0, this.vote.deadlineMs - Date.now());
    this.countdown.textContent = `${Math.ceil(remainMs / 1000)}s`;
  }

  private styleButton(btn: HTMLButtonElement, enabled: boolean, chosen: boolean): void {
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? "1" : "0.4";
    btn.style.cursor = enabled ? "pointer" : "default";
    btn.style.outline = chosen ? "2px solid #4a3728" : "none";
  }
}

function voteButton(label: string, color: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.tabIndex = -1;
  btn.textContent = label;
  btn.style.cssText = `
    padding: 8px 22px;
    font-family: monospace;
    font-size: 14px;
    font-weight: bold;
    color: #fff;
    background: ${color};
    border: none;
    border-radius: 6px;
    cursor: pointer;
  `;
  return btn;
}
