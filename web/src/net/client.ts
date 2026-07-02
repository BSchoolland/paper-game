import type { GameSocket } from "./socket.js";

/**
 * The one live socket, set once at boot (real, or the dev harness's mock). A module-level
 * holder so actions/dispatch can send without threading the socket through every component.
 */
let current: GameSocket | null = null;

export function setSocket(socket: GameSocket): void {
  current = socket;
}

export function socket(): GameSocket {
  if (!current) throw new Error("socket() before boot wired one");
  return current;
}
