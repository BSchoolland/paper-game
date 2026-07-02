<script lang="ts">
  import { home } from "../../state/home.svelte.js";
  import { dimMeta } from "../../state/dim-meta.svelte.js";
  import { joinByCode, refreshRooms } from "../../state/actions.js";
  import { assetUrl } from "../../lib/urls.js";

  const rooms = $derived(home.rooms ?? []);
  const inkForHost = (name: string) => `var(--ink-s${[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 4})`;
</script>

<div class="panehead">
  Public rooms anyone can join.
  <button class="linkish end" onclick={refreshRooms}>refresh</button>
</div>
<div class="notegrid">
  {#each rooms as r (r.code)}
    {@const meta = dimMeta.byId[r.dimensionId]}
    {@const joinable = r.phase === "lobby" && r.openSeats > 0}
    <div class="plate pin note" class:underway={!joinable}>
      <div class="chart" style={meta?.thumbPath ? `background-image:url('${assetUrl(meta.thumbPath)}')` : ""}>
        {#if meta?.tier !== undefined}<span class="tier tag">TIER {meta.tier}</span>{/if}
      </div>
      <div class="hostline">
        <span class="hand" style="color:{inkForHost(r.hostDisplayName)}">{r.hostDisplayName}</span>
        <span class="dim">{meta?.name ?? ""}</span>
      </div>
      <div class="meta">
        <span class="pips">
          {#each Array.from({ length: r.totalSeats }, (_, i) => i < r.totalSeats - r.openSeats) as lit, i (i)}
            <span class="pip" class:lit></span>
          {/each}
        </span>
        {#if joinable}
          <span>{r.openSeats} seat{r.openSeats === 1 ? "" : "s"} open</span>
        {:else}
          <span class="stamp terra underwaystamp">UNDERWAY</span>
        {/if}
      </div>
      {#if joinable}
        <button class="btn join" onclick={() => joinByCode(r.code)}>JOIN</button>
      {:else}
        <div class="small dim center" style="margin-top:10px">already started — can't be joined</div>
      {/if}
    </div>
  {/each}
  <div class="note-ghost">More rooms show up here as players open them.</div>
</div>

<style>
  .notegrid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
  .note {
    padding: 12px 12px 11px;
    transition: transform 0.15s ease;
  }
  .note:nth-child(odd) {
    transform: rotate(-0.7deg);
  }
  .note:nth-child(even) {
    transform: rotate(0.6deg);
  }
  .note:hover {
    transform: rotate(0) translateY(-2px);
  }
  .chart {
    height: 86px;
    border: 1px solid var(--ink-40);
    border-radius: 3px;
    background-size: 190%;
    background-position: center 40%;
    box-shadow: inset 0 0 14px rgba(88, 64, 28, 0.3);
    position: relative;
  }
  .chart .tier {
    position: absolute;
    right: 6px;
    bottom: 6px;
    background: rgba(243, 231, 193, 0.9);
    border-radius: 3px;
  }
  .hostline {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-top: 8px;
  }
  .hostline .hand {
    font-size: 22px;
    font-weight: 600;
  }
  .hostline .dim {
    font-size: 13.5px;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: space-between;
    margin-top: 6px;
    font-size: 13px;
    color: var(--ink-70);
    white-space: nowrap;
  }
  .underwaystamp {
    font-size: 9.5px;
  }
  .join {
    width: 100%;
    margin-top: 10px;
    padding: 6px 10px 5px;
    font-size: 12px;
  }
  .note.underway {
    opacity: 0.6;
  }
  .note.underway .chart {
    filter: saturate(0.6);
  }
  .note-ghost {
    border: 2px dashed var(--ink-25);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-55);
    font-size: 13.5px;
    text-align: center;
    padding: 16px;
    line-height: 1.5;
    min-height: 120px;
  }
  @media (max-width: 1100px) {
    .notegrid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
