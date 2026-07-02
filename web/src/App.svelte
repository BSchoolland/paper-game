<script lang="ts">
  import { session } from "./state/session.svelte.js";
  import { room } from "./state/room.svelte.js";
  import Toasts from "./kit/Toasts.svelte";
  import ConnectScreen from "./screens/ConnectScreen.svelte";
  import HomeScreen from "./screens/home/HomeScreen.svelte";
  import RoomScreen from "./screens/room/RoomScreen.svelte";
  import RunScreen from "./screens/run/RunScreen.svelte";

  /**
   * Screen = f(session, room). The server is the state machine; nothing here navigates.
   * Full stops (halts, boot, an offered seat reclaim) take the connect screen; a seated
   * room renders by phase; everything else is home.
   */
  const screen = $derived.by(() => {
    if (session.halted || !session.welcomed || session.reclaim !== null) return "connect" as const;
    if (room.state === null) return "home" as const;
    return room.state.phase === "lobby" ? ("room" as const) : ("run" as const);
  });
</script>

<div id="bg"></div>

{#if screen === "connect"}
  <ConnectScreen />
{:else if screen === "room"}
  <RoomScreen />
{:else if screen === "run"}
  <RunScreen />
{:else}
  <HomeScreen />
{/if}

<Toasts />
