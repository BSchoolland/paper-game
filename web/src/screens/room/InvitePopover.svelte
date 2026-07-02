<script lang="ts">
  import type { RoomCode } from "shared";
  import Popover from "../../kit/Popover.svelte";
  import { social } from "../../state/social.svelte.js";
  import { friendInvite } from "../../state/actions.js";
  import { isGuest } from "../../state/session.svelte.js";

  let { code, open = $bindable(false) }: { code: RoomCode; open?: boolean } = $props();

  let invited = $state<Set<string>>(new Set());

  const friends = $derived(social.friends?.friends ?? []);

  function invite(accountId: string): void {
    friendInvite(accountId);
    invited = new Set([...invited, accountId]);
  }
</script>

<button class="btn" data-popover-toggle onclick={() => (open = !open)}>INVITE ✉</button>
<Popover bind:open class="invitepop">
  <h4>INVITE A FRIEND</h4>
  {#if isGuest() || friends.length === 0}
    <div class="nofriends">
      {isGuest() ? "A free account lets you keep a friends list." : "No friends yet — add them from home."}
    </div>
  {/if}
  {#each friends as f (f.accountId)}
    <div class="frow">
      <span class="candle" class:lit={f.online}></span>
      <div>
        <div class="fname" style={f.online ? "" : "opacity:.6"}>{f.displayName}</div>
        <div class="fmeta">{f.online ? `Lv ${f.level} · online` : "offline"}</div>
      </div>
      <button class="btn act sm" disabled={!f.online || invited.has(f.accountId)} onclick={() => invite(f.accountId)}>
        {invited.has(f.accountId) ? "SENT ✓" : "INVITE"}
      </button>
    </div>
  {/each}
  <div class="codehint">or share the room code — <b class="sc">{code}</b></div>
</Popover>

<style>
  :global(.invitepop) {
    top: 44px;
    right: 0;
    width: 284px;
    padding: 14px 14px 12px;
    z-index: 20;
    text-align: left;
  }
  h4 {
    font-family: var(--sc);
    font-size: 12.5px;
    letter-spacing: 0.2em;
    font-weight: 400;
    margin-bottom: 8px;
  }
  .fname {
    font-size: 20px;
  }
  .sm {
    padding: 4px 10px 3px;
    font-size: 12.5px;
  }
  .nofriends {
    font-size: 13.5px;
    color: var(--ink-55);
    padding: 6px 0;
  }
  .codehint {
    font-size: 13.5px;
    color: var(--ink-55);
    margin-top: 10px;
    text-align: center;
  }
</style>
