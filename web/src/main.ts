import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import "@fontsource/im-fell-english-sc/400.css";
import "@fontsource/caveat/400.css";
import "@fontsource/caveat/600.css";
import "@fontsource/caveat/700.css";
import "./kit/tokens.css";
import "./kit/materials.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { RealSocket } from "./net/socket.js";
import { setSocket } from "./net/client.js";
import { wsUrl } from "./lib/urls.js";
import { dispatch, onStatus } from "./state/dispatch.js";

async function boot(): Promise<void> {
  if (import.meta.env.DEV) {
    // Console-poke access to the stores in dev (and for the CDP drive harness).
    const [{ combat }, { room }, { overworld }, { session }] = await Promise.all([
      import("./state/combat.svelte.js"),
      import("./state/room.svelte.js"),
      import("./state/overworld.svelte.js"),
      import("./state/session.svelte.js"),
    ]);
    (window as unknown as Record<string, unknown>).__stores = { combat, room, overworld, session };
  }
  const mock = new URLSearchParams(window.location.search).get("mock");
  if (mock !== null) {
    // Dev harness: scripted fixtures behind the same socket interface + dispatch.
    const { bootMock } = await import("../dev/mock-boot.js");
    bootMock(mock || "lv1");
    mount(App, { target: document.getElementById("app")! });
    const { default: Devbar } = await import("../dev/Devbar.svelte");
    mount(Devbar, { target: document.body });
  } else {
    setSocket(new RealSocket(wsUrl(), { onMessage: dispatch, onStatus }));
    mount(App, { target: document.getElementById("app")! });
  }
}

void boot();
