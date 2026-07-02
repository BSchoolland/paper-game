/**
 * Visual harness for the menu surfaces. Two modes, both driven by `?screen=home|home-rooms|lobby|gameover`:
 *
 *  - REAL screens (no `attempt` param): instantiates the production HomeScreen/LobbyScreen/GameOverScreen
 *    with inert mocks + canned data — used to verify the final integrated design.
 *  - VARIANT prototype (`?attempt=N`): dynamically loads dev/variants/attempt-N.ts and calls its
 *    renderVariant(screen, root). Design-attempt agents iterate here in isolation, screenshot, repeat.
 *
 * Used by scripts/shot-menus.ts.
 */
import type { RoomConnection } from "../src/net/connection.js";
import { SeatContext } from "../src/state/seat-context.js";
import { AccountStore } from "../src/state/account-store.js";
import { CodexStore } from "../src/state/codex-store.js";
import { HomeScreen } from "../src/screens/home-screen.js";
import { LobbyScreen } from "../src/screens/lobby-screen.js";
import { GameOverScreen } from "../src/screens/game-over-screen.js";
import { mockRooms, lobbyRoom, mockAuth, type MenuScreen } from "./mock-data.js";

const params = new URLSearchParams(location.search);
const screen = (params.get("screen") ?? "home") as MenuScreen;
const attempt = params.get("attempt");

async function main() {
  if (attempt) {
    const mod = await import(`./variants/attempt-${attempt}.ts`);
    (mod.renderVariant as (s: MenuScreen, root: HTMLElement) => void)(screen, document.body);
  } else {
    renderReal(screen);
  }
}

function renderReal(which: MenuScreen) {
  // Screens only ever call conn.on(...) and conn.send(...); both are inert in the harness.
  const conn = { on() {}, send() {} } as unknown as RoomConnection;
  const account = new AccountStore();
  account.setAuth(mockAuth());
  if (which === "home" || which === "home-rooms") {
    const home = new HomeScreen(conn, new SeatContext(), 1, account, new CodexStore(), () => {});
    home.enter();
    home.setRooms(which === "home-rooms" ? mockRooms : []);
  } else if (which === "lobby") {
    const seat = new SeatContext();
    seat.setRoom(lobbyRoom());
    new LobbyScreen(conn, seat, account, new CodexStore(), () => {}).enter();
  } else if (which === "gameover") {
    new GameOverScreen(conn, new SeatContext(), () => null, () => null).enter();
  }
}

void main().then(() => {
  void document.fonts.ready.then(() => {
    (window as unknown as { __menuReady?: boolean }).__menuReady = true;
  });
});
