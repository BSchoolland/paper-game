import type { HexCoord, HexMapState } from "shared";
import { hexKey, isAdjacent } from "shared";
import type { Screen } from "./screen-manager.js";
import type { HexMapRenderer } from "../renderer/hex-map-renderer.js";
import type { RoomConnection } from "../net/connection.js";

/**
 * The shared overworld. A click on an adjacent visible hex sends `proposeMove` — there is NO
 * optimistic local move (movement is vote-resolved server-side). The party token
 * animates only when the server confirms (`moveResolved{accepted}` then `hexMapState`). Input is
 * disabled while a proposal is open. The vote UI is owned by the VotePanel wired in main.
 */
export class MapScreen implements Screen {
  private proposalOpen = false;

  constructor(
    private hexRenderer: HexMapRenderer,
    private conn: RoomConnection,
    private getHexMapState: () => HexMapState | null,
  ) {
    this.hexRenderer.onHexClick((coord) => this.onHexClick(coord));

    // An open vote disables input; its resolution re-enables it. A `moveResolved{accepted:true}`
    // for a visited hex animates the token toward the target ahead of the authoritative hexMapState.
    this.conn.on("voteState", (msg) => {
      this.proposalOpen = msg.vote !== null;
      this.applyInputState();
    });
    this.conn.on("moveResolved", (msg) => {
      this.proposalOpen = false;
      this.applyInputState();
      if (msg.accepted) this.animateTo(msg.target);
    });
  }

  enter() {
    this.applyInputState();
    this.hexRenderer.show();
    const state = this.getHexMapState();
    if (state) this.hexRenderer.render(state);
  }

  exit() {
    this.hexRenderer.hideControls();
    this.hexRenderer.setInputEnabled(false);
    this.hexRenderer.hide();
  }

  suspend() {
    this.hexRenderer.hideControls();
    this.hexRenderer.setInputEnabled(false);
  }

  resume() {
    this.applyInputState();
    const state = this.getHexMapState();
    if (state) this.hexRenderer.render(state);
  }

  private applyInputState() {
    this.hexRenderer.setInputEnabled(!this.proposalOpen);
  }

  private onHexClick(coord: HexCoord) {
    if (this.proposalOpen) return;
    const state = this.getHexMapState();
    if (!state) return;
    if (!isAdjacent(state.playerPos, coord)) return;
    if (!(hexKey(coord) in state.hexes)) return;
    this.conn.send({ type: "proposeMove", target: coord });
  }

  private animateTo(target: HexCoord) {
    const state = this.getHexMapState();
    if (!state) return;
    // Only animate a step from the current party position to a confirmed adjacent target. A
    // combat-entry move switches screens before the token would land; an explored visited hex
    // advances playerPos via the following hexMapState.
    if (!isAdjacent(state.playerPos, target)) return;
    this.hexRenderer.animateMoveTo(target);
  }
}
