import type { ServerWebSocket } from "bun";
import type { ServerMessage } from "shared";
import type { SocketData } from "./room.js";
import { sendTo } from "./wire-transport.js";

/**
 * Online presence: account -> live sockets (docs/meta-loop/01-accounts.md §5). "Online" means at
 * least one live ws connection resolved to that account — including room-less HOME sockets, the
 * primary friends-panel audience. All pushes go through sendTo so envelope seq numbering holds.
 */

const socketsByAccount = new Map<string, Set<ServerWebSocket<SocketData>>>();

/** Bind a socket to an account. Returns true iff the account transitioned offline -> online. */
export function register(accountId: string, ws: ServerWebSocket<SocketData>): boolean {
  let set = socketsByAccount.get(accountId);
  const wentOnline = !set || set.size === 0;
  if (!set) {
    set = new Set();
    socketsByAccount.set(accountId, set);
  }
  set.add(ws);
  return wentOnline;
}

/**
 * Unbind a socket from its CURRENT ws.data.accountId (callers doing an account swap must call this
 * BEFORE reassigning). No-op when the socket never resolved an account (died pre-hello).
 */
export function unregister(ws: ServerWebSocket<SocketData>): { accountId: string; wentOffline: boolean } | null {
  const accountId = ws.data.accountId;
  if (!accountId) return null;
  const set = socketsByAccount.get(accountId);
  if (!set || !set.delete(ws)) return { accountId, wentOffline: false };
  if (set.size === 0) {
    socketsByAccount.delete(accountId);
    return { accountId, wentOffline: true };
  }
  return { accountId, wentOffline: false };
}

export function isOnline(accountId: string): boolean {
  return (socketsByAccount.get(accountId)?.size ?? 0) > 0;
}

export function socketsFor(accountId: string): ReadonlySet<ServerWebSocket<SocketData>> {
  return socketsByAccount.get(accountId) ?? new Set();
}

/** Send to every live socket of an account (works for room-less sockets too). */
export function pushToAccount(accountId: string, msg: ServerMessage): void {
  for (const ws of socketsFor(accountId)) sendTo(ws, msg);
}
