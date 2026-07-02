<script lang="ts">
  import { session, profile, isGuest } from "../../state/session.svelte.js";
  import { chrome } from "../../state/chrome.svelte.js";
  import { claimAccount, login, register } from "../../state/actions.js";

  let username = $state("");
  let password = $state("");
  let email = $state("");

  const mode = $derived(chrome.accountDialog);
  const prof = $derived(profile());

  // Success = the auth identity changed under the dialog: claim flips isGuest, register/login
  // swap the accountId. Close on either; inline errors keep it open.
  const authKey = $derived(session.auth ? `${session.auth.accountId}:${session.auth.isGuest}` : "");
  let openedKey: string | null = null;
  $effect(() => {
    if (mode) {
      openedKey ??= authKey;
      if (authKey !== openedKey) close();
    } else {
      openedKey = null;
    }
  });

  function close(): void {
    chrome.accountDialog = null;
    session.authError = null;
    password = "";
  }

  function submit(): void {
    const u = username.trim();
    if (!u || !password) return;
    if (mode === "claim") claimAccount(u, password, email.trim() || undefined);
    else if (mode === "register") register(u, password, email.trim() || undefined);
    else login(u, password);
  }

  const usernameError = $derived(
    session.authError && (session.authError.code === "USERNAME_TAKEN" || session.authError.code === "INVALID_INPUT" || session.authError.code === "NO_SUCH_USER")
      ? session.authError.message
      : null,
  );
  const passwordError = $derived(
    session.authError && !usernameError ? session.authError.message : null,
  );
</script>

{#if mode}
  <div class="overlay">
    <div class="plate acctplate">
      <button class="x" onclick={close}>✕</button>
      {#if mode === "login"}
        <h2>LOG IN</h2>
        {#if session.authRejected}
          <p class="lead">Your session {session.authRejected === "expired" ? "expired" : "couldn't be restored"} — log in to pick up where you left off.</p>
        {:else}
          <p class="lead">Welcome back.</p>
        {/if}
      {:else if mode === "claim"}
        <h2>CREATE ACCOUNT</h2>
        <p class="lead">You're playing as a guest. A free account keeps your progress on any device.</p>
        <div class="keepline">
          carries over: <span class="tag">LEVEL {prof?.level ?? 1}</span> <span class="tag">YOUR STATS</span>
        </div>
      {:else}
        <h2>NEW ACCOUNT</h2>
        <p class="lead">A brand-new account with a clean slate — this guest's progress stays behind.</p>
      {/if}

      <div class="regfield">
        <label for="acct-username">USERNAME</label>
        <input id="acct-username" class="field" bind:value={username} autocomplete="username" />
        {#if usernameError}<div class="errline">{usernameError}</div>{/if}
      </div>
      <div class="regfield">
        <label for="acct-password">PASSWORD</label>
        <input
          id="acct-password"
          class="field"
          type="password"
          bind:value={password}
          autocomplete={mode === "login" ? "current-password" : "new-password"}
          onkeydown={(e) => e.key === "Enter" && submit()}
        />
        {#if passwordError}
          <div class="errline">{passwordError}</div>
        {:else if mode !== "login"}
          <div class="cap">at least 8 characters</div>
        {/if}
      </div>
      {#if mode !== "login"}
        <div class="regfield">
          <label for="acct-email">EMAIL <span style="opacity:.5">— OPTIONAL</span></label>
          <input id="acct-email" class="field" bind:value={email} placeholder="only for account recovery" autocomplete="email" />
        </div>
      {/if}

      <div class="acctfoot">
        <button class="btn gilt bigbtn" onclick={submit}>
          {mode === "login" ? "LOG IN" : "CREATE ACCOUNT"}
        </button>
        {#if mode === "login"}
          <div class="alt">
            No account yet?
            <button class="linkish" onclick={() => (chrome.accountDialog = isGuest() ? "claim" : "register")}>Create one</button>
          </div>
        {:else}
          <div class="alt">
            Already have an account? <button class="linkish" onclick={() => (chrome.accountDialog = "login")}>Log in</button>
          </div>
        {/if}
        {#if mode === "claim"}
          <div class="fresh">
            Want a clean slate?
            <button class="linkish freshlink" onclick={() => (chrome.accountDialog = "register")}>Start a brand-new account</button>
            — this guest's progress stays behind.
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: rgba(46, 32, 12, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(1.5px);
  }
  .acctplate {
    width: 460px;
    max-width: 94vw;
    padding: 24px 28px 20px;
    animation: settle 0.35s ease both;
  }
  .x {
    position: absolute;
    top: 10px;
    right: 14px;
    color: var(--ink-40);
    font-size: 15px;
    cursor: pointer;
  }
  h2 {
    font-family: var(--sc);
    font-weight: 400;
    font-size: 18px;
    letter-spacing: 0.26em;
    text-align: center;
  }
  .lead {
    font-size: 15px;
    color: var(--ink-70);
    text-align: center;
    margin-top: 8px;
    line-height: 1.5;
  }
  .keepline {
    display: flex;
    gap: 10px;
    justify-content: center;
    align-items: center;
    margin: 12px 0 14px;
    font-size: 13.5px;
    color: var(--ink-70);
    flex-wrap: wrap;
  }
  .regfield {
    margin-bottom: 12px;
  }
  .regfield label {
    display: block;
    font-family: var(--sc);
    font-size: 12px;
    letter-spacing: 0.18em;
    color: var(--ink-70);
    margin-bottom: 4px;
  }
  .regfield .cap {
    font-size: 13px;
    color: var(--ink-55);
    margin-top: 4px;
  }
  .acctfoot {
    text-align: center;
    margin-top: 14px;
  }
  .bigbtn {
    font-size: 14px;
    padding: 11px 30px 10px;
  }
  .alt {
    font-size: 14px;
    margin-top: 12px;
  }
  .fresh {
    font-size: 13px;
    color: var(--ink-55);
    margin-top: 10px;
  }
  .freshlink {
    color: var(--ink-70);
  }
</style>
