<script lang="ts">
  import { isGuest } from "../../state/session.svelte.js";
  import { social } from "../../state/social.svelte.js";
  import { chrome } from "../../state/chrome.svelte.js";
  import { addFriend, friendAccept, friendDecline, friendRemove, joinByCode } from "../../state/actions.js";

  let addName = $state("");
  const friends = $derived(social.friends);

  function inkFor(accountId: string): string {
    return `var(--ink-s${[...accountId].reduce((a, c) => a + c.charCodeAt(0), 0) % 4})`;
  }

  function submitAdd(): void {
    const name = addName.trim();
    if (!name) return;
    addFriend(name);
    addName = "";
  }
</script>

{#if isGuest()}
  <div class="emptypane">
    <div class="lead">NO FRIENDS YET</div>
    <p>
      Friends see when you're online, can invite you to their rooms, and join yours in one click. You're playing as a guest — a free
      account lets you add friends and keeps your progress on any device.
    </p>
    <button class="btn gilt" onclick={() => (chrome.accountDialog = "claim")}>CREATE ACCOUNT</button>
    <div class="foot">
      Already have one? <button class="linkish" onclick={() => (chrome.accountDialog = "login")}>Log in</button>
    </div>
  </div>
{:else}
  <div class="friendlist">
    {#each friends?.incoming ?? [] as req (req.accountId)}
      <div class="request">
        <div>
          <span class="hand reqname">{req.displayName}</span>
          <span class="small dim">Lv {req.level} · sent you a friend request</span>
        </div>
        <div class="btns">
          <button class="btn gilt smbtn" onclick={() => friendAccept(req.accountId)}>ACCEPT</button>
          <button class="btn ghost smbtn" onclick={() => friendDecline(req.accountId)}>DECLINE</button>
        </div>
      </div>
    {/each}

    {#if (friends?.friends.length ?? 0) === 0 && (friends?.incoming.length ?? 0) === 0}
      <div class="emptypane" style="min-height:180px">
        <div class="lead">NO FRIENDS YET</div>
        <p>Add a friend by username below — they'll get a request next time they're online.</p>
      </div>
    {/if}

    {#each friends?.friends ?? [] as f (f.accountId)}
      <div class="frow">
        <span class="candle" class:lit={f.online}></span>
        <div>
          <div class="fname" style={f.online ? `color:${inkFor(f.accountId)}` : "opacity:.6"}>{f.displayName}</div>
          <div class="fmeta">
            Lv {f.level} · {f.roomCode ? `in room ${f.roomCode}` : f.online ? "online" : "offline"}
          </div>
        </div>
        {#if f.roomCode}
          <button class="btn act smbtn" onclick={() => joinByCode(f.roomCode!)}>JOIN</button>
        {/if}
        <button class="dots-menu" class:act={!f.roomCode} title="Remove friend" onclick={() => friendRemove(f.accountId)}>✕</button>
      </div>
    {/each}

    {#each friends?.outgoing ?? [] as out (out.accountId)}
      <div class="outgoing">
        request sent to <b>{out.displayName}</b> ·
        <button class="linkish" onclick={() => friendDecline(out.accountId)}>cancel</button>
      </div>
    {/each}

    <div class="addrow">
      <input
        class="field"
        placeholder="add a friend by username…"
        bind:value={addName}
        onkeydown={(e) => e.key === "Enter" && submitAdd()}
      />
      <button class="btn addbtn" onclick={submitAdd}>ADD</button>
    </div>
    {#if social.addError}
      <div class="errline">{social.addError.message}</div>
    {/if}
  </div>
{/if}

<style>
  .friendlist {
    max-width: 620px;
    margin: 0 auto;
  }
  .request {
    border: 1px dashed var(--ink-40);
    border-radius: 4px;
    padding: 10px 12px;
    margin-bottom: 10px;
    background: rgba(255, 250, 235, 0.4);
  }
  .reqname {
    font-size: 21px;
    font-weight: 600;
  }
  .request .btns {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .smbtn {
    padding: 5px 14px 4px;
    font-size: 12.5px;
  }
  .outgoing {
    font-size: 13.5px;
    color: var(--ink-55);
    margin-top: 10px;
  }
  .addrow {
    display: flex;
    gap: 8px;
    margin-top: 14px;
  }
  .addbtn {
    padding: 8px 14px;
  }
</style>
