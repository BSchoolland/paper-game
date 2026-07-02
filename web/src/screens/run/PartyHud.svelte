<script lang="ts">
  import { combat } from "../../state/combat.svelte.js";
  import { room } from "../../state/room.svelte.js";
  import type { ClientState } from "../../board/client-state.svelte.js";

  let { clientState }: { clientState: ClientState } = $props();

  const coop = $derived(combat.coop);
  const mySeatId = $derived(room.state?.yourSeatId ?? null);
  const mine = $derived(coop?.seats.find((s) => s.seatId === mySeatId) ?? null);
  const defendingSeats = $derived(new Set(coop?.pendingDefends.filter((d) => !d.answered).map((d) => d.seatId) ?? []));

  const banner = $derived.by(() => {
    if (!coop) return null;
    if (defendingSeats.size > 0) {
      const names = coop.seats.filter((s) => defendingSeats.has(s.seatId)).map((s) => s.displayName);
      return `Defending: ${names.join(", ")}`;
    }
    if (coop.phase === "enemy") return "Enemy phase";
    const waiting = coop.seats.filter((s) => s.connected && !s.ready && !s.exhausted && s.controller === "human");
    if (waiting.length > 0 && waiting.every((s) => s.seatId !== mySeatId)) {
      return `Waiting on ${waiting.map((s) => s.displayName).join(", ")}`;
    }
    return null;
  });

  function seatStatus(s: NonNullable<typeof coop>["seats"][number], dead: boolean, defending: boolean): { mark: string; cls: string } {
    if (dead) return { mark: "✕", cls: "dead" };
    if (defending) return { mark: "defending", cls: "defending" };
    if (s.ready || s.exhausted) return { mark: "done", cls: "done" };
    return { mark: "…", cls: "waiting" };
  }
</script>

{#if coop}
  <div class="partyhud">
    {#if banner}
      <div class="plate hudbanner">{banner}</div>
    {/if}
    <div class="rows">
      {#each coop.seats as s (s.seatId)}
        {@const hero = combat.display?.entities.get(s.heroEntityId) ?? null}
        {@const dead = hero?.dead ?? false}
        {@const status = seatStatus(s, dead, defendingSeats.has(s.seatId))}
        {@const tag = !s.connected && s.controller === "human" ? " (dropped)" : s.controller === "ai" ? " (bot)" : ""}
        <div class="plate seat" class:me={s.seatId === mySeatId} class:dead>
          <span class="sname hand">{s.displayName}{tag}</span>
          {#if hero}
            <span class="hp">{Math.max(0, Math.ceil(hero.hp))}/{hero.maxHp}{hero.barrier > 0 ? ` +${hero.barrier}` : ""}</span>
          {/if}
          <span class="mark {status.cls}">{status.mark}</span>
        </div>
      {/each}
    </div>
    {#if coop.phase === "player" && mine && !mine.exhausted}
      <button class="btn passbtn" class:on={mine.ready} onclick={() => clientState.setReady(!mine.ready)}>
        {mine.ready ? "UN-READY" : "PASS / READY"}
      </button>
    {/if}
  </div>
{/if}

<style>
  .partyhud {
    position: fixed;
    top: 16px;
    left: 16px;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .hudbanner {
    font-size: 14px;
    padding: 6px 12px 5px;
    color: var(--ink);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .seat {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 11px 4px;
    min-width: 190px;
    font-size: 13px;
  }
  .seat.me {
    box-shadow: 0 0 0 2px rgba(164, 133, 76, 0.5), inset 0 1px 0 rgba(255, 252, 240, 0.5);
  }
  .seat.dead {
    opacity: 0.55;
  }
  .sname {
    flex: 1;
    font-size: 19px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hp {
    color: #8c3a1e;
    font-variant-numeric: tabular-nums;
  }
  .mark {
    min-width: 58px;
    text-align: right;
    font-family: var(--sc);
    font-size: 11px;
    letter-spacing: 0.1em;
  }
  .mark.done {
    color: var(--moss);
  }
  .mark.defending {
    color: var(--slate);
  }
  .mark.dead {
    color: #8c3a1e;
  }
  .mark.waiting {
    color: var(--ink-55);
  }
  .passbtn {
    margin-top: 2px;
    border: 2px dashed var(--ink-40);
    background: transparent;
    box-shadow: none;
    color: var(--ink-70);
    font-size: 12.5px;
    padding: 8px 16px 7px;
  }
  .passbtn.on {
    border-style: solid;
    border-color: #5f1a12;
    background: radial-gradient(circle at 35% 28%, var(--wax-hi), var(--wax) 62%, #7e241b);
    color: #f6e2cd;
    text-shadow: 0 1px 2px rgba(60, 10, 0, 0.5);
  }
</style>
