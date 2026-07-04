<script lang="ts">
  import { room, reconnectingSeated } from "../../state/room.svelte.js";
  import { combat } from "../../state/combat.svelte.js";
  import { overworld } from "../../state/overworld.svelte.js";
  import { leaveRoom, playAgain } from "../../state/actions.js";
  import { ClientState } from "../../board/client-state.svelte.js";
  import BoardHost from "../../board/BoardHost.svelte";
  import VotePanel from "./VotePanel.svelte";
  import PartyHud from "./PartyHud.svelte";
  import CombatDock from "./CombatDock.svelte";
  import PhaseSlate from "./PhaseSlate.svelte";
  import ContractHud from "./ContractHud.svelte";
  import LootPanel from "./LootPanel.svelte";
  import PackOverlay from "./PackOverlay.svelte";
  import ItemChip from "../../kit/ItemChip.svelte";
  import ChatBox from "../room/ChatBox.svelte";

  const clientState = new ClientState();

  const roomState = $derived(room.state!);
  const phase = $derived(roomState.phase);
  // Server truth flips the phase the instant an outcome resolves; the PLAYER's outcome is what's
  // on the board. The board holds its combat display until the final animations settle (BoardHost
  // nulls it in exitCombat), so this is "combat is still on screen" — outcome overlays wait on it.
  const combatOnScreen = $derived(phase === "combat" || combat.display !== null);

  let packOpen = $state(false);
  let chatOpen = $state(false);

  function onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    if ((e.key === "i" || e.key === "I") && !e.ctrlKey && !e.metaKey) {
      packOpen = !packOpen;
    }
  }

  const outcomeTitle = $derived.by(() => {
    switch (roomState.outcome) {
      case "victory":
        return "EXPEDITION COMPLETE";
      case "retreat":
        return "THE PARTY RETREATED";
      default:
        return "THE PARTY FELL";
    }
  });
</script>

<svelte:document onkeydown={onKey} />

<BoardHost {clientState} />

{#if reconnectingSeated()}
  <div class="recon">Connection lost — reconnecting… your seat is held.</div>
{/if}

<VotePanel />

{#if combatOnScreen}
  <PartyHud />
  <CombatDock {clientState} onOpenPack={() => (packOpen = true)} />
  <PhaseSlate />
{/if}

{#if phase === "overworld" && !combatOnScreen}
  <ContractHud />
  <LootPanel />
  <button class="btn ghost packbtn" onclick={() => (packOpen = true)}>PACK (I)</button>
{/if}

{#if phase === "overworld" || phase === "combat"}
  <button class="btn ghost leavebtn" onclick={leaveRoom}>LEAVE</button>
{/if}

{#if phase !== "combat"}
  <div class="chatdock" class:open={chatOpen}>
    <button class="btn ghost chattoggle" onclick={() => (chatOpen = !chatOpen)}>{chatOpen ? "CHAT ▾" : "CHAT ▴"}</button>
    {#if chatOpen}
      <div class="chatwrap"><ChatBox /></div>
    {/if}
  </div>
{/if}

<PackOverlay bind:open={packOpen} />

{#if phase === "gameover" && !combatOnScreen}
  <div class="gameoverwrap">
    <div class="plate goplate">
      <div class="gostamp">
        <span class="stamp" class:gilt={roomState.outcome === "victory"} class:terra={roomState.outcome !== "victory"}>
          {roomState.outcome === "victory" ? "CONTRACT FULFILLED" : roomState.outcome === "retreat" ? "RETREAT" : "DEFEAT"}
        </span>
      </div>
      <h2>{outcomeTitle}</h2>
      <p class="gosub dim">{roomState.dimensionName}{roomState.dimensionTier !== null ? ` · tier ${roomState.dimensionTier}` : ""}</p>

      {#if overworld.lastBank}
        <div class="rule"></div>
        <div class="bankline">
          <b>+{overworld.lastBank.banked} XP banked</b>
          <span class="dim">({overworld.lastBank.pending} pending × {overworld.lastBank.multiplier})</span>
          {#if overworld.lastBank.leveledUp}
            <span class="levelup sc">LEVEL {overworld.lastBank.level}!</span>
          {/if}
        </div>
      {/if}

      {#if overworld.lastCodexBank && overworld.lastCodexBank.entries.length > 0}
        <div class="codexline dim">Banked into your codex:</div>
        <div class="codexrow">
          {#each overworld.lastCodexBank.entries as entry (entry.item.id)}
            <div class="codexitem" title={entry.item.name}>
              <ItemChip item={entry.item} small />
              {#if overworld.lastCodexBank.firstItemIds.includes(entry.item.id)}<span class="first">✦</span>{/if}
            </div>
          {/each}
        </div>
      {/if}

      <div class="goacts">
        <button class="btn wax" onclick={playAgain}>PLAY AGAIN</button>
        <button class="btn ghost" onclick={leaveRoom}>BACK TO HOME</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .recon {
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 125;
    padding: 6px 18px;
    color: #8c4526;
    font-size: 15px;
    background: rgba(243, 231, 193, 0.92);
    border: 1px solid rgba(163, 81, 47, 0.4);
    border-radius: 4px;
  }
  .leavebtn {
    position: fixed;
    top: 16px;
    right: 14px;
    z-index: 110;
    font-size: 12px;
    padding: 6px 14px 5px;
  }
  .packbtn {
    position: fixed;
    bottom: 16px;
    left: 14px;
    z-index: 110;
    font-size: 12px;
    padding: 6px 14px 5px;
  }
  /* Bottom-left next to PACK — the board's camera controls own the bottom-right corner. */
  .chatdock {
    position: fixed;
    bottom: 16px;
    left: 110px;
    z-index: 110;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .chattoggle {
    font-size: 12px;
    padding: 6px 14px 5px;
  }
  .chatwrap {
    width: 320px;
  }
  .gameoverwrap {
    position: fixed;
    inset: 0;
    z-index: 115;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    background: rgba(46, 32, 12, 0.35);
  }
  .goplate {
    width: 520px;
    max-width: 94vw;
    padding: 30px 36px 26px;
    text-align: center;
    animation: settle 0.35s ease both;
  }
  .gostamp {
    margin-bottom: 12px;
  }
  h2 {
    font-family: var(--sc);
    font-weight: 400;
    font-size: 19px;
    letter-spacing: 0.24em;
    margin-bottom: 6px;
  }
  .gosub {
    font-size: 15px;
  }
  .bankline {
    font-size: 16px;
    display: flex;
    gap: 8px;
    justify-content: center;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .levelup {
    color: var(--gilt);
    font-size: 13px;
    letter-spacing: 0.18em;
  }
  .codexline {
    font-size: 13.5px;
    margin-top: 10px;
  }
  .codexrow {
    display: flex;
    gap: 8px;
    justify-content: center;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .codexitem {
    position: relative;
  }
  .first {
    position: absolute;
    top: -7px;
    right: -6px;
    color: var(--gilt);
    text-shadow: 0 0 7px rgba(201, 167, 99, 0.7);
    font-size: 13px;
  }
  .goacts {
    margin-top: 18px;
    display: flex;
    gap: 14px;
    justify-content: center;
  }
</style>
