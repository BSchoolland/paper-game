/**
 * REFERENCE variant — the contract every design attempt implements. A variant is a pure VISUAL
 * prototype of the four menu surfaces (no networking): given a screen name and a root element, paint
 * the full-screen menu with the canned mock data. Design-attempt agents copy this contract, throw
 * away the styling, and build something far better — iterating against scripts/shot-menus.ts.
 *
 * Asset paths are root-absolute (served from client/public), e.g. "/sprites/ui/card-frame.png".
 * Class art: vanguard -> /sprites/char1/sword-idle.webp, ranger -> bow-idle, mystic -> staff-idle.
 * Item icons: /sprites/items/<id>.webp  (e.g. short-sword, round-shield, bow, quiver, staff, spellbook, potion, bomb).
 * Map backdrops: /sprites/maps/dimension-0/{gateway-city-0,town-0,great-ruins-0}.png
 */
import { STARTER_PRESETS } from "shared";
import { mockRooms, lobbyRoom, type MenuScreen } from "../mock-data.js";

export function renderVariant(screen: MenuScreen, root: HTMLElement): void {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "position:fixed; inset:0; display:flex; align-items:center; justify-content:center; " +
    "font-family:system-ui, sans-serif; color:#222; background:#0f0c08;";
  const card = document.createElement("div");
  card.style.cssText = "background:#f5ebd7; padding:24px; border-radius:8px; min-width:360px;";

  if (screen === "home" || screen === "home-rooms") {
    const rooms = screen === "home-rooms" ? mockRooms : [];
    card.innerHTML = `<h1>Co-op Expedition</h1><p>Quick Match · Create · Join</p>` +
      `<p>Open rooms: ${rooms.map((r) => r.code).join(", ") || "none"}</p>`;
  } else if (screen === "lobby") {
    const room = lobbyRoom();
    card.innerHTML = `<h1>Room ${room.code}</h1>` +
      `<p>${room.seats.map((s) => s.displayName).join(", ")}</p>` +
      `<p>Presets: ${STARTER_PRESETS.map((p) => p.name).join(", ")}</p>`;
  } else {
    card.innerHTML = `<h1>Your party has fallen</h1><p>Play again · Return home</p>`;
  }

  wrap.appendChild(card);
  root.appendChild(wrap);
}
