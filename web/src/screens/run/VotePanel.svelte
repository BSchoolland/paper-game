<script lang="ts">
  import type { VoteKind } from "shared";
  import { room } from "../../state/room.svelte.js";
  import { castVote } from "../../state/actions.js";

  const TITLE_BY_KIND: Record<VoteKind, string> = {
    move: "MOVE PROPOSED",
    retreat: "RETREAT PROPOSED",
    travel: "DESCENT PROPOSED",
  };

  const vote = $derived(room.vote);
  const mySeatId = $derived(room.state?.yourSeatId ?? null);

  const tally = $derived.by(() => {
    if (!vote) return null;
    let yes = 0;
    let no = 0;
    for (const seatId of vote.electorate) {
      const choice = vote.votes[seatId];
      if (choice === "yes") yes++;
      else if (choice === "no") no++;
    }
    return { yes, no, pending: vote.electorate.length - yes - no, of: vote.electorate.length };
  });

  const canVote = $derived(!!vote && !!mySeatId && vote.electorate.includes(mySeatId));
  const myChoice = $derived(vote && mySeatId ? vote.votes[mySeatId] : undefined);

  // Countdown re-render tick.
  let now = $state(Date.now());
  $effect(() => {
    if (!vote) return;
    const t = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(t);
  });
  const secondsLeft = $derived(vote ? Math.max(0, Math.ceil((vote.deadlineMs - now) / 1000)) : 0);
</script>

{#if vote && tally}
  <div class="plate votepanel">
    <div class="vtitle sc">{TITLE_BY_KIND[vote.kind]}</div>
    {#if vote.kind === "retreat"}
      <div class="vsub">End the run at this gateway — bank 50% of pending XP</div>
    {:else if vote.kind === "travel" && vote.travel}
      <div class="vsub">Travel the gateway to <b>{vote.travel.toName}</b> (Tier {vote.travel.toTier})</div>
    {/if}
    <div class="vtally">Yes {tally.yes} · No {tally.no} · Pending {tally.pending} <span class="dim">(of {tally.of})</span></div>
    <div class="vclock dim">{secondsLeft}s</div>
    <div class="vbtns">
      <button class="btn gilt" disabled={!canVote} class:chosen={myChoice === "yes"} onclick={() => castVote(vote.proposalId, "yes")}>
        {myChoice === "yes" ? "YES ✓" : "YES"}
      </button>
      <button class="btn ghost" disabled={!canVote} class:chosen={myChoice === "no"} onclick={() => castVote(vote.proposalId, "no")}>
        {myChoice === "no" ? "NO ✓" : "NO"}
      </button>
    </div>
  </div>
{/if}

<style>
  .votepanel {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 120;
    min-width: 280px;
    max-width: 380px;
    padding: 14px 18px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    text-align: center;
  }
  .vtitle {
    font-size: 13px;
    letter-spacing: 0.22em;
  }
  .vsub {
    font-size: 14px;
    color: var(--ink-70);
    line-height: 1.4;
  }
  .vtally {
    font-size: 14px;
  }
  .vclock {
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .vbtns {
    display: flex;
    gap: 10px;
    margin-top: 4px;
  }
  .vbtns .btn.chosen {
    outline: 2px solid var(--ink-70);
    outline-offset: 1px;
  }
</style>
