<script lang="ts">
  import { room, mySeat, isHost, hostSeat } from "../../state/room.svelte.js";
  import { setReady, startGame } from "../../state/actions.js";

  const roomState = $derived(room.state!);
  const me = $derived(mySeat());
  const host = $derived(isHost());
  const hostName = $derived(hostSeat()?.displayName ?? "The host");

  const status = $derived.by(() => {
    const parts: { text: string; strong: boolean }[] = [];
    const humans = roomState.seats.filter((s) => s.state === "human-connected" || s.state === "human-disconnected");
    const ready = humans.filter((s) => s.ready && s.seatId !== roomState.yourSeatId);
    if (ready.length > 0) parts.push({ text: `${ready.map((s) => s.displayName).join(" and ")} ${ready.length === 1 ? "is" : "are"} ready`, strong: true });
    for (const s of humans) {
      if (s.state === "human-disconnected") parts.push({ text: `${s.displayName} is reconnecting`, strong: false });
    }
    if (me) parts.push({ text: me.ready ? "you're ready" : "you're not ready", strong: false });
    const open = roomState.seats.filter((s) => s.state === "open").length;
    if (open > 0) {
      const party = humans.length;
      parts.push({ text: `${open} open seat${open === 1 ? "" : "s"} dropped at start — ${party === 1 ? "you'll go solo" : `party of ${party}`}, no bots`, strong: false });
    }
    return parts;
  });
</script>

<div class="plate readybar">
  <div class="status">
    {#each status as part, i (i)}
      {#if i > 0}{" · "}{/if}{#if part.strong}<b>{part.text}</b>{:else}{part.text}{/if}
    {/each}
  </div>
  <div class="acts">
    <button class="btn readybtn" class:on={me?.ready} onclick={() => setReady(!me?.ready)}>
      {me?.ready ? "READY ✓" : "READY"}
    </button>
    <div class="startwrap">
      {#if host}
        <button class="btn wax" onclick={startGame}>START EXPEDITION</button>
        <div class="startnote">starts for everyone — you'll be warned if someone isn't ready</div>
      {:else}
        <div class="hostnote">
          {hostName} <span class="tag host hostnotetag">HOST</span> starts the expedition — you don't have to wait on anyone.
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .readybar {
    position: sticky;
    bottom: 16px;
    z-index: 30;
    margin: 16px 0 28px;
    padding: 13px 18px;
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .status {
    font-size: 15px;
    color: var(--ink-70);
    line-height: 1.5;
    min-width: 0;
  }
  .status b {
    color: var(--ink);
  }
  .acts {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 14px;
    white-space: nowrap;
  }
  .readybtn {
    font-size: 14px;
    letter-spacing: 0.2em;
    padding: 12px 26px 11px;
    border: 2px dashed var(--ink-40);
    background: transparent;
    box-shadow: none;
    color: var(--ink-70);
  }
  .readybtn.on {
    border: 1px solid #5f1a12;
    border-style: solid;
    background: radial-gradient(circle at 35% 28%, var(--wax-hi), var(--wax) 62%, #7e241b);
    color: #f6e2cd;
    text-shadow: 0 1px 2px rgba(60, 10, 0, 0.5);
    box-shadow: 0 2px 6px rgba(58, 30, 10, 0.45);
  }
  .startwrap {
    text-align: center;
  }
  .startwrap :global(.btn) {
    font-size: 14px;
    padding: 12px 26px 11px;
  }
  .startnote {
    font-size: 13px;
    color: var(--ink-55);
    margin-top: 6px;
  }
  .hostnote {
    font-size: 13.5px;
    color: var(--ink-70);
    line-height: 1.45;
    max-width: 240px;
    white-space: normal;
    text-align: left;
  }
  .hostnotetag {
    font-size: 10px;
  }
</style>
