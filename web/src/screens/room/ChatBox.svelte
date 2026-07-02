<script lang="ts">
  import { room, seatInkIndex } from "../../state/room.svelte.js";
  import { sendChat } from "../../state/actions.js";

  let draft = $state("");
  let scroller = $state<HTMLDivElement | null>(null);

  const entries = $derived(room.chat);

  $effect(() => {
    entries.length;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });

  function submit(): void {
    const text = draft.trim();
    if (!text) return;
    sendChat(text);
    draft = "";
  }
</script>

<div class="plate chatbox">
  <div class="sechead chathead">CHAT</div>
  <div class="chatscroll" bind:this={scroller}>
    {#each entries as entry, i (i)}
      <div class="msg i{seatInkIndex(entry.seatId)}">
        <span class="who">{entry.displayName} —</span>{entry.text}
      </div>
    {/each}
  </div>
  <div class="chatfoot">
    <div class="chatrow">
      <input
        class="field"
        placeholder="say something…"
        bind:value={draft}
        onkeydown={(e) => e.key === "Enter" && submit()}
      />
      <button class="btn sendbtn" onclick={submit}>SEND</button>
    </div>
    {#if room.chatRateLimited}
      <div class="chatcap">Slow down — a few messages at a time.</div>
    {/if}
  </div>
</div>

<style>
  .chatbox {
    padding: 13px 13px 12px;
    display: flex;
    flex-direction: column;
  }
  .chathead {
    margin-bottom: 4px;
  }
  .chatscroll {
    max-height: 220px;
    min-height: 80px;
    overflow-y: auto;
    padding: 4px 2px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .msg {
    font-family: var(--hand);
    font-size: 20px;
    line-height: 1.15;
    font-weight: 500;
  }
  .msg .who {
    font-weight: 700;
    margin-right: 6px;
  }
  .msg.i0 { color: var(--ink-s0); }
  .msg.i1 { color: var(--ink-s1); }
  .msg.i2 { color: var(--ink-s2); }
  .msg.i3 { color: var(--ink-s3); }
  .chatfoot {
    margin-top: 9px;
  }
  .chatrow {
    display: flex;
    gap: 8px;
  }
  .chatrow .field {
    flex: 1;
  }
  .sendbtn {
    padding: 8px 13px;
  }
  .chatcap {
    font-size: 13.5px;
    color: #8c4526;
    margin-top: 6px;
    text-align: center;
  }
</style>
