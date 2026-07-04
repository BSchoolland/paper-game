<script lang="ts">
  import { onMount } from "svelte";
  import { combat, holdDisplayFor, onCoopPhaseChange } from "../../state/combat.svelte.js";
  import { room } from "../../state/room.svelte.js";

  /** Full-screen turn banner. On the enemy flip it also pauses the display drain so the slate
   *  lands BEFORE the first enemy moves — the pause is what makes the phase readable. */
  const SLATE_MS = 1150;
  const ENEMY_DRAIN_HOLD_MS = 1050;

  let shown = $state<"player" | "enemy" | null>(null);
  let seq = 0;

  function show(phase: "player" | "enemy"): void {
    // The combat may already be decided while the final animations drain — no slate then.
    if (room.state?.phase !== "combat") return;
    const mySeq = ++seq;
    shown = phase;
    if (phase === "enemy") holdDisplayFor(ENEMY_DRAIN_HOLD_MS);
    setTimeout(() => {
      if (seq === mySeq) shown = null;
    }, SLATE_MS);
  }

  onMount(() => {
    // The phase that was already current when we mounted (combat entry) gets a slate too.
    if (combat.coop) show(combat.coop.phase);
    return onCoopPhaseChange((phase) => show(phase));
  });
</script>

{#if shown}
  {#key shown}
    <div class="slatewrap">
      <div class="slate" class:enemy={shown === "enemy"}>
        <span class="line"></span>
        <span class="text sc">{shown === "enemy" ? "ENEMY TURN" : "YOUR TURN"}</span>
        <span class="line"></span>
      </div>
    </div>
  {/key}
{/if}

<style>
  .slatewrap {
    position: fixed;
    inset: 0;
    z-index: 105;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .slate {
    display: flex;
    align-items: center;
    gap: 18px;
    width: min(560px, 80vw);
    padding: 14px 0;
    background: linear-gradient(90deg, transparent, rgba(243, 231, 193, 0.94) 18%, rgba(243, 231, 193, 0.94) 82%, transparent);
    animation: slate-in 1.15s ease both;
  }
  .text {
    font-size: 26px;
    letter-spacing: 0.34em;
    text-indent: 0.34em;
    color: var(--moss);
    white-space: nowrap;
    text-shadow: 0 1px 0 rgba(255, 252, 240, 0.6);
  }
  .slate.enemy .text {
    color: var(--wax);
  }
  .line {
    flex: 1;
    height: 2px;
    background: currentColor;
    color: var(--moss);
    opacity: 0.55;
  }
  .slate.enemy .line {
    color: var(--wax);
  }
  @keyframes slate-in {
    0% {
      opacity: 0;
      transform: translateX(-40px);
    }
    14% {
      opacity: 1;
      transform: none;
    }
    82% {
      opacity: 1;
      transform: none;
    }
    100% {
      opacity: 0;
      transform: translateX(40px);
    }
  }
</style>
