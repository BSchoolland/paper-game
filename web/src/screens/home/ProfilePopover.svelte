<script lang="ts">
  import { titleById, xpToReachLevel } from "shared";
  import Popover from "../../kit/Popover.svelte";
  import { profile } from "../../state/session.svelte.js";
  import { equipTitle, logout, setDisplayName } from "../../state/actions.js";
  import { assetUrl } from "../../lib/urls.js";

  let { open = $bindable(false) }: { open: boolean } = $props();

  let editingName = $state(false);
  let nameDraft = $state("");
  let titlePickOpen = $state(false);
  let allStats = $state(false);

  const prof = $derived(profile());
  const xp = $derived.by(() => {
    if (!prof) return null;
    const cur = xpToReachLevel(prof.level);
    const next = xpToReachLevel(prof.level + 1);
    return { into: prof.xp - cur, span: next - cur, next: prof.level + 1 };
  });

  const STAT_LABELS: [keyof NonNullable<ReturnType<typeof profile>>["stats"], string][] = [
    ["encountersWon", "Encounters won"],
    ["designsRecovered", "Designs recovered"],
    ["firstsRecovered", "World firsts"],
    ["hexesCharted", "Hexes charted"],
    ["dimensionsDiscovered", "Dimensions discovered"],
    ["dimensionsTraveled", "Dimensions traveled"],
    ["contractsCompleted", "Contracts completed"],
    ["wipes", "Wipes"],
  ];
  const headline = $derived(allStats ? STAT_LABELS : STAT_LABELS.slice(0, 3));

  function startRename(): void {
    if (!prof) return;
    nameDraft = prof.displayName;
    editingName = true;
  }

  function commitRename(): void {
    editingName = false;
    const name = nameDraft.trim();
    if (prof && name && name !== prof.displayName) setDisplayName(name);
  }
</script>

<Popover bind:open class="profpop">
  {#if prof}
    <div class="portraitwrap"><img src={assetUrl("sprites/char1/inventory-idle.png")} alt="Your portrait" /></div>
    {#if editingName}
      <input
        class="field namefield"
        bind:value={nameDraft}
        onkeydown={(e) => {
          if (e.key === "Enter") commitRename();
          if (e.key === "Escape") editingName = false;
        }}
        onblur={commitRename}
      />
    {:else}
      <div class="signame hand">
        {prof.displayName}
        <button class="quill" title="Change your display name" onclick={startRename}>✎</button>
      </div>
    {/if}
    {#if prof.username}<div class="handle">@{prof.username}</div>{/if}
    <div class="rankrow">
      <span class="stamp gilt">LEVEL {prof.level}</span>
      <span class="titlewrap">
        <button class="titleplate sc" data-popover-toggle title="Choose a title" onclick={() => (titlePickOpen = !titlePickOpen)}>
          {prof.equippedTitleId ? titleById(prof.equippedTitleId).name : "no title"} ▾
        </button>
        <Popover bind:open={titlePickOpen} class="titlepop">
          <button
            class="topt"
            class:on={prof.equippedTitleId === null}
            onclick={() => {
              equipTitle(null);
              titlePickOpen = false;
            }}>no title</button
          >
          {#each prof.titles as id (id)}
            <button
              class="topt"
              class:on={prof.equippedTitleId === id}
              title={titleById(id).description}
              onclick={() => {
                equipTitle(id);
                titlePickOpen = false;
              }}>{titleById(id).name}</button
            >
          {/each}
        </Popover>
      </span>
    </div>
    {#if xp}
      <div class="xpwrap">
        <div class="xptrack"><div class="xpfill" style="width:{Math.round((xp.into / xp.span) * 100)}%"></div></div>
        <div class="small xprow"><span>{xp.into.toLocaleString()} / {xp.span.toLocaleString()}</span><span>to level {xp.next}</span></div>
      </div>
    {/if}
    <div class="rule"></div>
    <div class="deeds">
      {#each headline as [key, label] (key)}
        <div class="drow">
          <span>{label}</span><span class="dots"></span>
          <span class="val" class:gold={key === "firstsRecovered" && prof.stats[key] > 0}>{prof.stats[key]}</span>
        </div>
      {/each}
    </div>
    <div class="proffoot">
      <button class="linkish" onclick={() => (allStats = !allStats)}>{allStats ? "fewer stats ▴" : "all stats ▾"}</button>
      <button class="logout linkish" onclick={logout}>Log out</button>
    </div>
  {/if}
</Popover>

<style>
  :global(.profpop) {
    top: 48px;
    right: 0;
    width: 312px;
    padding: 18px 16px 14px;
    text-align: left;
  }
  .portraitwrap {
    width: 96px;
    height: 110px;
    margin: 2px auto 2px;
    border: 1px solid var(--ink-40);
    border-radius: 50% 50% 46% 46%/58% 58% 40% 40%;
    overflow: hidden;
    background: radial-gradient(circle at 50% 30%, rgba(255, 250, 232, 0.75), rgba(214, 190, 138, 0.5));
    box-shadow: inset 0 0 18px rgba(88, 64, 28, 0.25);
  }
  .portraitwrap img {
    width: 82px;
    margin: 11px auto 0;
    filter: sepia(0.35) saturate(0.75) contrast(0.95);
  }
  .signame {
    text-align: center;
    font-size: 31px;
    font-weight: 600;
    line-height: 1;
    margin-top: 8px;
  }
  .namefield {
    margin-top: 10px;
    font-family: var(--hand);
    font-size: 24px;
    text-align: center;
  }
  .quill {
    font-size: 13px;
    vertical-align: 12px;
    opacity: 0.5;
    cursor: pointer;
  }
  .handle {
    text-align: center;
    font-size: 13px;
    color: var(--ink-55);
    margin-top: 3px;
  }
  .rankrow {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 10px;
    margin: 10px 0 4px;
  }
  .titlewrap {
    position: relative;
  }
  .titleplate {
    font-size: 13px;
    color: #8a6c37;
    cursor: pointer;
  }
  :global(.titlepop) {
    top: 22px;
    left: 50%;
    transform: translateX(-50%);
    width: 180px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 46;
  }
  .topt {
    font-family: var(--sc);
    font-size: 12.5px;
    letter-spacing: 0.1em;
    padding: 6px 10px 5px;
    border-radius: 3px;
    color: var(--ink-70);
    text-align: left;
  }
  .topt:hover {
    background: rgba(60, 47, 28, 0.08);
  }
  .topt.on {
    color: #8a6c37;
    background: rgba(60, 47, 28, 0.08);
  }
  .xpwrap {
    margin: 8px 6px 2px;
  }
  .xptrack {
    height: 7px;
    border: 1px solid var(--ink-40);
    border-radius: 4px;
    background: rgba(60, 47, 28, 0.08);
    overflow: hidden;
  }
  .xpfill {
    height: 100%;
    background: linear-gradient(90deg, var(--gilt-hi), var(--gilt));
    box-shadow: inset 0 1px 0 rgba(255, 244, 214, 0.6);
  }
  .xprow {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    color: var(--ink-55);
  }
  .deeds {
    margin: 10px 6px 0;
    font-size: 14px;
  }
  .drow {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 2px 0;
  }
  .drow .dots {
    flex: 1;
    border-bottom: 1px dotted var(--ink-25);
    transform: translateY(-3px);
  }
  .drow .val {
    font-variant-numeric: tabular-nums;
  }
  .drow .val.gold {
    color: var(--gilt);
    font-weight: bold;
  }
  .proffoot {
    margin-top: 12px;
    text-align: center;
  }
  .proffoot .logout {
    display: block;
    font-size: 13.5px;
    color: var(--ink-55);
    margin: 8px auto 0;
  }
</style>
