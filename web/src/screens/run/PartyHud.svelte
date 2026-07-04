<script lang="ts">
  import { combat } from "../../state/combat.svelte.js";
  import { room } from "../../state/room.svelte.js";

  const coop = $derived(combat.coop);
  const mySeatId = $derived(room.state?.yourSeatId ?? null);
  const defendingSeats = $derived(new Set(coop?.pendingDefends.filter((d) => !d.answered).map((d) => d.seatId) ?? []));

  function seatStatus(
    s: NonNullable<typeof coop>["seats"][number],
    dead: boolean,
    defending: boolean,
  ): { text: string; cls: string } {
    if (dead) return { text: "✕ fallen", cls: "dead" };
    if (defending) return { text: "defending", cls: "defending" };
    if (coop?.phase !== "player") return { text: "waiting", cls: "waiting" };
    if (s.ready || s.exhausted) return { text: "done", cls: "done" };
    return { text: "playing…", cls: "playing" };
  }
</script>

{#if coop}
  <div class="partyhud">
    {#if coop.phase === "enemy"}
      <span class="stamp terra phasechip">ENEMY PHASE</span>
    {/if}
    {#each coop.seats as s (s.seatId)}
      {@const hero = combat.display?.entities.get(s.heroEntityId) ?? null}
      {@const dead = hero?.dead ?? false}
      {@const status = seatStatus(s, dead, defendingSeats.has(s.seatId))}
      {@const tag = !s.connected && s.controller === "human" ? " (dropped)" : s.controller === "ai" ? " (bot)" : ""}
      <div class="plate card" class:me={s.seatId === mySeatId} class:dead>
        <div class="toprow">
          <span class="sname hand">{s.displayName}{tag}</span>
          {#if hero}
            <div class="hpbar">
              <div class="hpfill" style:width="{Math.min(100, (Math.max(0, hero.hp) / hero.maxHp) * 100)}%"></div>
              <span class="hpnum">{Math.max(0, Math.ceil(hero.hp))}/{hero.maxHp}{hero.barrier > 0 ? ` +${hero.barrier}` : ""}</span>
            </div>
          {/if}
        </div>
        <div class="botrow">
          {#if hero}
            <span class="pips">
              {#each { length: hero.energy.maxRed } as _, i}
                <span class="epip red" class:lit={i < hero.energy.red}></span>
              {/each}
              {#each { length: hero.energy.maxBlue } as _, i}
                <span class="epip blue" class:lit={i < hero.energy.blue}></span>
              {/each}
            </span>
          {/if}
          <span class="status sc {status.cls}">{status.text}</span>
        </div>
      </div>
    {/each}
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
    gap: 9px;
    align-items: flex-start;
  }
  .phasechip {
    font-size: 11.5px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 7px 13px 7px;
    min-width: 230px;
  }
  .card.me {
    box-shadow: 0 0 0 2px rgba(164, 133, 76, 0.5), inset 0 1px 0 rgba(255, 252, 240, 0.5);
  }
  .card.dead {
    opacity: 0.55;
  }
  .toprow {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .sname {
    font-size: 20px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 130px;
  }
  .hpbar {
    position: relative;
    flex: 1;
    height: 16px;
    min-width: 96px;
    border: 1px solid var(--ink-55);
    border-radius: 3px;
    background: rgba(255, 250, 235, 0.55);
    overflow: hidden;
  }
  .hpfill {
    height: 100%;
    background: linear-gradient(180deg, #d0664f, #b03a28);
    transition: width 0.25s ease;
  }
  .hpnum {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
    text-shadow: 0 0 3px rgba(248, 239, 211, 0.9);
    line-height: 1;
  }
  .botrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .pips {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }
  .epip {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 1.4px solid;
    background: transparent;
  }
  .epip.red {
    border-color: #a33b2b;
  }
  .epip.red.lit {
    background: radial-gradient(circle at 38% 32%, #e98a6d, #c0392b 70%);
  }
  .epip.blue {
    border-color: #2e6f96;
    margin-left: 0;
  }
  .epip.red + .epip.blue {
    margin-left: 6px;
  }
  .epip.blue.lit {
    background: radial-gradient(circle at 38% 32%, #7db8e0, #2980b9 70%);
  }
  .status {
    font-size: 11px;
    letter-spacing: 0.1em;
  }
  .status.playing {
    color: var(--terra);
  }
  .status.done {
    color: var(--moss);
  }
  .status.defending {
    color: var(--slate);
  }
  .status.dead {
    color: #8c3a1e;
  }
  .status.waiting {
    color: var(--ink-55);
  }
</style>
