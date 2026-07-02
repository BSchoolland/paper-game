<script lang="ts">
  import { contractById, getPreset } from "shared";
  import Tabs from "../../kit/Tabs.svelte";
  import { room, mySeat, isHost, hostSeat, reconnectingSeated } from "../../state/room.svelte.js";
  import { leaveRoom } from "../../state/actions.js";
  import { dimMeta } from "../../state/dim-meta.svelte.js";
  import DestinationPane from "./DestinationPane.svelte";
  import ContractPane from "./ContractPane.svelte";
  import KitPane from "./KitPane.svelte";
  import ManifestPane from "./ManifestPane.svelte";
  import PartyRail from "./PartyRail.svelte";
  import ChatBox from "./ChatBox.svelte";
  import ReadyBar from "./ReadyBar.svelte";
  import InvitePopover from "./InvitePopover.svelte";
  import PackOverlay from "../run/PackOverlay.svelte";

  let activeTab = $state("dest");
  let copied = $state(false);
  let inviteOpen = $state(false);
  let packOpen = $state(false);

  const roomState = $derived(room.state!);
  const host = $derived(isHost());
  const me = $derived(mySeat());
  const hostName = $derived(hostSeat()?.displayName ?? "the host");

  // Step status dots: wax = explicitly chosen, dashed = running on its default.
  const kitVal = $derived.by(() => {
    const preset = me?.presetId ? getPreset(me.presetId) : null;
    if (!preset) return { set: false, text: "default — Vanguard" };
    const chosen = me?.presetId !== null;
    return { set: chosen, text: chosen ? `${preset.name} — ${preset.description.split("—")[0]!.trim().toLowerCase()}` : `default — ${preset.name}` };
  });
  const manifestCount = $derived(me?.manifestIds.length ?? 0);
  const contractVal = $derived.by(() => {
    if (!roomState.contract) return { set: false, text: "default — Chart the Wilds" };
    return { set: roomState.contract.type !== "chart-hexes", text: contractById(roomState.contract.type).name };
  });
  const destName = $derived(dimMeta.byId[roomState.dimensionId]?.name ?? roomState.dimensionName);

  const steps = $derived([
    {
      id: "dest",
      n: 1,
      name: "DESTINATION",
      set: true,
      hostOwned: true,
      value: `${destName}${roomState.dimensionTier !== null ? ` · tier ${roomState.dimensionTier}` : ""}`,
    },
    { id: "contract", n: 2, name: "CONTRACT", set: contractVal.set, hostOwned: true, value: contractVal.text },
    { id: "kit", n: 3, name: "YOUR KIT", set: kitVal.set, hostOwned: false, value: kitVal.text },
    {
      id: "manifest",
      n: 4,
      name: "MANIFEST",
      set: manifestCount > 0,
      hostOwned: false,
      value: manifestCount > 0 ? `${manifestCount} design${manifestCount === 1 ? "" : "s"} packed` : "empty — optional",
    },
  ]);

  function copyCode(): void {
    void navigator.clipboard.writeText(roomState.code);
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }
</script>

<section class="screen">
  {#if reconnectingSeated()}
    <div class="recon">Connection lost — reconnecting… your seat is held.</div>
  {/if}

  <div class="roomtop">
    <button class="btn ghost" onclick={leaveRoom}>← LEAVE</button>
    <div class="code">
      <span class="cap">room code</span>
      <span class="stamp codestamp">{roomState.code}</span>
      <button class="linkish" onclick={copyCode}>{copied ? "copied ✓" : "copy"}</button>
      <span class="cap">— friends can join with this code</span>
    </div>
    <div class="right">
      <InvitePopover code={roomState.code} bind:open={inviteOpen} />
    </div>
  </div>

  <div class="setuphead">
    <h2>EXPEDITION SETUP</h2>
    {#if host}
      <span class="hint">every step has a default — you can start at any time</span>
    {:else}
      <span class="hint">{hostName} is the host — your kit, manifest, and ready are yours</span>
    {/if}
    <span class="legend"><span class="sdot set"></span> chosen · <span class="sdot def"></span> on its default</span>
  </div>

  <div class="roomgrid">
    <main>
      <Tabs
        tabs={steps.map((s) => ({ id: s.id }))}
        bind:active={activeTab}
        bodyClass="h-room"
      >
        {#snippet tab(t, _on)}
          {@const s = steps.find((x) => x.id === t.id)!}
          <span class="tline"><span class="sdot" class:set={s.set} class:def={!s.set}></span>{s.n} · {s.name}</span>
          <span class="tval">
            {#if s.hostOwned && !host}<span class="tag host">HOST</span>{/if}
            {s.value}
          </span>
        {/snippet}
        {#snippet pane(id)}
          {#if id === "dest"}
            <DestinationPane />
          {:else if id === "contract"}
            <ContractPane />
          {:else if id === "kit"}
            <KitPane onadjust={() => (packOpen = true)} />
          {:else}
            <ManifestPane />
          {/if}
        {/snippet}
      </Tabs>

      <ReadyBar />
    </main>

    <aside class="rail">
      <PartyRail oninvite={() => (inviteOpen = true)} />
      <ChatBox />
    </aside>
  </div>
</section>

<PackOverlay bind:open={packOpen} />

<style>
  .recon {
    max-width: 1240px;
    margin: 14px auto 0;
    padding: 8px 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: #8c4526;
    font-size: 15px;
  }
  .recon::before,
  .recon::after {
    content: "";
    height: 1px;
    width: 110px;
    background: linear-gradient(90deg, transparent, rgba(163, 81, 47, 0.5));
  }
  .recon::after {
    transform: scaleX(-1);
  }
  .roomtop {
    max-width: 1240px;
    margin: 16px auto 0;
    padding: 0 24px;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .roomtop .code {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .roomtop .cap {
    font-size: 13.5px;
    color: var(--ink-55);
  }
  .codestamp {
    font-size: 16px;
    letter-spacing: 0.3em;
    padding: 3px 12px 2px;
  }
  .roomtop .right {
    margin-left: auto;
    position: relative;
  }
  .setuphead {
    max-width: 1240px;
    margin: 16px auto 0;
    padding: 0 24px;
    display: flex;
    align-items: baseline;
    gap: 14px;
  }
  .setuphead h2 {
    font-family: var(--sc);
    font-weight: 400;
    font-size: 18px;
    letter-spacing: 0.3em;
  }
  .setuphead .hint {
    font-size: 13.5px;
    color: var(--ink-55);
  }
  .roomgrid {
    max-width: 1240px;
    margin: 6px auto 0;
    padding: 0 24px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 324px;
    gap: 20px;
    align-items: start;
  }
  .roomgrid :global(.tabs) {
    margin-top: 14px;
  }
  .rail {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 14px;
  }
  @media (max-width: 1100px) {
    .roomgrid {
      grid-template-columns: 1fr;
    }
    :global(.steptab .tval) {
      display: none;
    }
  }
</style>
