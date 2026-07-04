<script lang="ts">
  import type { RoomCapacity } from "shared";
  import Compass from "../../kit/Compass.svelte";
  import CodeInput from "../../kit/CodeInput.svelte";
  import Tabs from "../../kit/Tabs.svelte";
  import Popover from "../../kit/Popover.svelte";
  import { session, isGuest, profile } from "../../state/session.svelte.js";
  import { home } from "../../state/home.svelte.js";
  import { social } from "../../state/social.svelte.js";
  import { codex } from "../../state/codex.svelte.js";
  import { chrome } from "../../state/chrome.svelte.js";
  import { play, joinByCode, quickJoin, refreshRooms } from "../../state/actions.js";
  import { titleById } from "shared";
  import { assetUrl } from "../../lib/urls.js";
  import RoomsPane from "./RoomsPane.svelte";
  import FriendsPane from "./FriendsPane.svelte";
  import CodexPane from "./CodexPane.svelte";
  import ProfilePopover from "./ProfilePopover.svelte";
  import AccountDialog from "./AccountDialog.svelte";

  let code = $state("");
  let capacity = $state<RoomCapacity>(4);
  let sizeOpen = $state(false);
  let profOpen = $state(false);
  let activeTab = $state("rooms");

  $effect(() => {
    // Prime the browser once per home visit; the pane's refresh link re-requests.
    refreshRooms();
  });

  const codexEarned = $derived((codex.entries?.length ?? 0) > 0);
  const tabs = $derived.by(() => {
    const list = [
      { id: "rooms", label: "OPEN ROOMS", count: String(home.rooms?.length ?? 0) },
      { id: "friends", label: "FRIENDS", count: String(social.friends?.friends.length ?? 0) },
    ];
    if (codexEarned) list.push({ id: "codex", label: "CODEX", count: `${codex.entries!.length} designs` });
    return list;
  });

  const prof = $derived(profile());
  const equippedTitle = $derived(prof?.equippedTitleId ? titleById(prof.equippedTitleId).name : null);

  function submitCode(): void {
    if (code.length === 6) joinByCode(code);
  }
</script>

<section class="screen">
  <header class="brandrow">
    <div class="right">
      <span class="conn">
        <span class="candle" class:lit={session.status === "open"}></span>
        {session.status === "open" ? "Connected" : "Reconnecting…"}
      </span>
      {#if isGuest()}
        <span>
          Playing as guest ·
          <button class="linkish" onclick={() => (chrome.accountDialog = "claim")}>Create account</button> ·
          <button class="linkish" onclick={() => (chrome.accountDialog = "login")}>Log in</button>
        </span>
      {:else if prof}
        <div class="idwrap">
          <button class="idchip" data-popover-toggle onclick={() => (profOpen = !profOpen)} title="Your profile">
            <img src={assetUrl("sprites/char1/inventory-idle.png")} alt="" />
            <span class="who">{prof.displayName}</span>
            <span class="lv">LV {prof.level}{equippedTitle ? ` · ${equippedTitle.toUpperCase()}` : ""}</span>
          </button>
          <ProfilePopover bind:open={profOpen} />
        </div>
      {/if}
    </div>
  </header>

  <div class="col">
    <div class="masthead">
      <Compass size={54} />
      <h1>EXPEDITION</h1>
      <div class="sub">a co-op journey into strange dimensions · 1–4 players</div>
    </div>

    <div class="plate startblock">
      <button class="btn wax playbtn" onclick={() => play(capacity)}>PLAY</button>
      <div class="playcap">
        Creates a room for up to {capacity} — friends join with your code; unfilled seats are dropped at start (no bots).
        <span class="sizewrap">
          <button class="linkish" data-popover-toggle onclick={() => (sizeOpen = !sizeOpen)}>room size: {capacity} ▾</button>
          <Popover bind:open={sizeOpen} class="sizepop">
            {#each [2, 3, 4] as RoomCapacity[] as n (n)}
              <button
                class="sizeopt"
                class:on={capacity === n}
                onclick={() => {
                  capacity = n;
                  sizeOpen = false;
                }}>{n} seats</button
              >
            {/each}
          </Popover>
        </span>
      </div>
      {#if home.createError}
        <div class="errline center">{home.createError.message}</div>
      {/if}
      <div class="orline">OR JOIN A ROOM</div>
      <div class="joinrow">
        <CodeInput bind:value={code} onsubmit={submitCode} />
        <button class="btn joinbtn" disabled={code.length !== 6} onclick={submitCode}>JOIN</button>
        <button class="btn ghost quickbtn" onclick={quickJoin}>QUICK JOIN</button>
      </div>
      {#if home.joinError}
        <div class="errline center">{home.joinError.message}</div>
      {:else}
        <div class="joincap">Enter a friend's room code, or quick join any open room.</div>
      {/if}
    </div>

    <Tabs {tabs} bind:active={activeTab} bodyClass="h-home">
      {#snippet pane(id)}
        {#if id === "rooms"}
          <RoomsPane />
        {:else if id === "friends"}
          <FriendsPane />
        {:else}
          <CodexPane />
        {/if}
      {/snippet}
    </Tabs>
  </div>
</section>

<AccountDialog />

<style>
  .brandrow {
    max-width: 1240px;
    margin: 18px auto 0;
    padding: 0 28px;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
  }
  .brandrow .right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 13.5px;
    color: var(--ink-55);
  }
  .brandrow .conn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .idwrap {
    position: relative;
  }
  .idchip {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 5px 14px 5px 6px;
    border: 1px solid var(--ink-40);
    border-radius: 22px;
    background: rgba(255, 250, 235, 0.5);
    cursor: pointer;
  }
  .idchip:hover {
    background: rgba(255, 250, 235, 0.75);
  }
  .idchip img {
    width: 28px;
    height: 32px;
    object-fit: cover;
    object-position: top;
    border-radius: 50%;
    border: 1px solid var(--ink-25);
    background: rgba(255, 250, 235, 0.8);
    filter: sepia(0.35) saturate(0.75);
  }
  .idchip .who {
    font-family: var(--hand);
    font-size: 22px;
    font-weight: 600;
    line-height: 1;
    color: var(--ink);
  }
  .idchip .lv {
    font-family: var(--sc);
    font-size: 11px;
    letter-spacing: 0.14em;
    color: var(--ink-55);
  }

  .col {
    max-width: 920px;
    margin: 0 auto;
    padding: 0 28px;
  }
  .masthead {
    text-align: center;
    margin-top: 26px;
  }
  .masthead h1 {
    font-family: var(--sc);
    font-weight: 400;
    font-size: 34px;
    letter-spacing: 0.42em;
    text-indent: 0.42em;
    text-shadow: 0 1px 0 rgba(255, 248, 220, 0.55);
    margin-top: 8px;
  }
  /* decorative tagline — the one italic kept */
  .masthead .sub {
    font-style: italic;
    color: var(--ink-55);
    font-size: 16px;
    margin-top: 3px;
  }

  .startblock {
    max-width: 680px;
    margin: 22px auto 0;
    padding: 30px 34px 22px;
    text-align: center;
  }
  .playbtn {
    font-size: 20px;
    letter-spacing: 0.34em;
    text-indent: 0.2em;
    padding: 17px 64px 15px;
    border-radius: 4px;
  }
  .playcap {
    font-size: 15px;
    color: var(--ink-70);
    margin-top: 13px;
  }
  .playcap :global(.linkish) {
    font-size: 15px;
  }
  .sizewrap {
    position: relative;
    display: inline-block;
  }
  :global(.sizepop) {
    top: 26px;
    left: 0;
    width: 120px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sizeopt {
    font-family: var(--sc);
    font-size: 13px;
    letter-spacing: 0.1em;
    padding: 6px 10px 5px;
    border-radius: 3px;
    color: var(--ink-70);
    text-align: left;
  }
  .sizeopt:hover {
    background: rgba(60, 47, 28, 0.08);
  }
  .sizeopt.on {
    color: var(--ink);
    background: rgba(60, 47, 28, 0.12);
  }
  .orline {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 20px 0 2px;
    font-family: var(--sc);
    font-size: 13px;
    letter-spacing: 0.26em;
    color: var(--ink-40);
  }
  .orline::before,
  .orline::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--ink-25);
  }
  .joinrow {
    display: flex;
    gap: 5px;
    align-items: center;
    justify-content: center;
    margin-top: 14px;
    flex-wrap: wrap;
  }
  .joinbtn {
    margin-left: 6px;
    padding: 9px 14px 8px;
  }
  .quickbtn {
    margin-left: 10px;
  }
  .joincap {
    font-size: 13.5px;
    color: var(--ink-55);
    margin-top: 11px;
  }
</style>
