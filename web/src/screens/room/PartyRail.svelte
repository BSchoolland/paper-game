<script lang="ts">
  import { getPreset, titleById } from "shared";
  import { room, seatInkIndex } from "../../state/room.svelte.js";
  import { assetUrl } from "../../lib/urls.js";

  let { oninvite }: { oninvite: () => void } = $props();

  const roomState = $derived(room.state!);
  const filled = $derived(roomState.seats.filter((s) => s.state !== "open").length);
</script>

<div class="plate party">
  <div class="sechead partyhead">PARTY <span class="hint">{filled} of {roomState.capacity} seats</span></div>
  {#each roomState.seats as seat (seat.seatId)}
    {@const ink = seatInkIndex(seat.seatId)}
    {@const you = seat.seatId === roomState.yourSeatId}
    {#if seat.state === "open"}
      <div class="seatrow">
        <div class="openport"></div>
        <div class="seatbody">
          <div class="seatname plain openname">OPEN SEAT</div>
          <div class="seatmeta">becomes a bot at start</div>
        </div>
        <button class="btn ghost invitebtn" onclick={oninvite}>INVITE</button>
      </div>
    {:else if seat.state === "bot"}
      <div class="seatrow">
        <div class="botport"><span class="stamp botstamp">BOT</span></div>
        <div class="seatbody">
          <div class="seatname plain">BOT</div>
          <div class="seatmeta">plays along · always ready</div>
        </div>
        <span class="seal sm" title="Ready">✦</span>
      </div>
    {:else}
      {@const preset = seat.presetId ? getPreset(seat.presetId) : null}
      {@const designs = seat.manifestIds.length}
      {@const disconnected = seat.state === "human-disconnected"}
      {@const metaParts = [
        seat.level !== null ? `Lv ${seat.level}` : null,
        preset ? `${preset.name} kit` : "picking a kit",
        designs > 0 ? `brings ${designs} design${designs === 1 ? "" : "s"}` : null,
        seat.equippedTitleId ? titleById(seat.equippedTitleId).name : null,
      ].filter(Boolean)}
      <div class="seatrow s{ink}" class:faded={disconnected}>
        <div class="sigport"><img src={assetUrl("sprites/char1/inventory-idle.png")} alt="" /></div>
        <div class="seatbody">
          <div class="seatname">
            {seat.displayName}
            {#if you}<span class="microtag">YOU</span>{/if}
            {#if seat.isHost}<span class="tag host">HOST</span>{/if}
          </div>
          <div class="seatmeta">{metaParts.join(" · ")}</div>
          {#if disconnected}
            <div class="reconcap">reconnecting — seat held</div>
          {/if}
        </div>
        <span class="seal sm" class:empty={!seat.ready} title={seat.ready ? "Ready" : "Not ready"}>
          {seat.ready ? seat.displayName[0]?.toUpperCase() : "–"}
        </span>
      </div>
    {/if}
  {/each}
</div>

<style>
  .party {
    padding: 14px 14px 10px;
  }
  .partyhead {
    margin-bottom: 4px;
  }
  .seatrow {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 9px 2px;
    border-bottom: 1px dotted var(--ink-25);
  }
  .seatrow:last-of-type {
    border-bottom: none;
  }
  .sigport {
    width: 40px;
    height: 48px;
    border: 1px solid var(--ink-40);
    border-radius: 50%/44%;
    overflow: hidden;
    background: rgba(255, 250, 235, 0.6);
    flex: 0 0 40px;
  }
  .sigport img {
    width: 34px;
    margin: 5px auto 0;
    filter: sepia(0.4) saturate(0.7);
  }
  .seatrow.s1 .sigport img {
    filter: sepia(0.75) saturate(0.5) hue-rotate(155deg) brightness(1.02);
  }
  .seatrow.s2 .sigport img {
    filter: sepia(0.75) saturate(0.6) hue-rotate(45deg);
  }
  .seatrow.s3 .sigport img {
    filter: sepia(0.7) saturate(0.9) hue-rotate(-20deg);
  }
  .botport {
    width: 40px;
    height: 48px;
    flex: 0 0 40px;
    border: 1px dashed var(--ink-40);
    border-radius: 50%/44%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .botstamp {
    font-size: 9px;
    padding: 2px 4px 1px;
    letter-spacing: 0.12em;
    transform: rotate(-12deg);
  }
  .openport {
    width: 40px;
    height: 48px;
    flex: 0 0 40px;
    border: 2px dashed var(--ink-25);
    border-radius: 50%/44%;
  }
  .seatbody {
    min-width: 0;
    flex: 1;
  }
  .seatname {
    font-family: var(--hand);
    font-size: 23px;
    font-weight: 600;
    line-height: 1;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .seatname.plain {
    font-family: var(--sc);
    font-size: 12.5px;
    letter-spacing: 0.14em;
    color: var(--ink-55);
  }
  .openname {
    color: var(--ink-40);
  }
  .seatrow.s0 .seatname { color: var(--ink-s0); }
  .seatrow.s1 .seatname { color: var(--ink-s1); }
  .seatrow.s2 .seatname { color: var(--ink-s2); }
  .seatrow.s3 .seatname { color: var(--ink-s3); }
  .seatmeta {
    font-size: 13px;
    color: var(--ink-55);
    margin-top: 3px;
    line-height: 1.4;
  }
  .seatrow .seal {
    margin-left: auto;
  }
  .seatrow.faded .sigport,
  .seatrow.faded .seatbody {
    opacity: 0.45;
  }
  .seatrow.faded .reconcap {
    opacity: 1;
  }
  .reconcap {
    font-size: 13px;
    color: #8c4526;
  }
  .invitebtn {
    margin-left: auto;
    padding: 4px 10px 3px;
    font-size: 12px;
  }
</style>
