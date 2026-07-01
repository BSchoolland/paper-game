import type { ServerWebSocket } from "bun";
import type {
  ClientMessage,
  ErrorCode,
  FriendEntry,
  FriendRequestEntry,
  FriendsListPayload,
  ChatEntry,
  RoomCode,
} from "shared";
import type { Room, Seat, SocketData } from "./room.js";
import {
  AccountError,
  accountById,
  loadProfilePayload,
  loadCardProfile,
  setDisplayName,
  equipTitle,
  listFriends,
  acceptedFriendIds,
  sendFriendRequest,
  acceptFriend,
  declineFriend,
  removeFriend,
  validateChatText,
} from "./accounts.js";
import * as presence from "./presence.js";
import { rooms } from "./room-registry.js";
import { broadcastRoomState } from "./room-machine.js";
import { upsertRunSeat } from "./db.js";
import { io, sendTo } from "./wire-transport.js";

/** Profile / friends / chat handlers (docs/meta-loop/01-accounts.md §5). */

const CHAT_LOG_CAP = 100;
const CHAT_RATE_LIMIT = 5; // accepted messages
const CHAT_RATE_WINDOW_MS = 10_000;

function sendError(ws: ServerWebSocket<SocketData>, code: ErrorCode, message: string): void {
  sendTo(ws, { type: "error", code, message, recoverable: true });
}

/** Run a handler body, mapping domain AccountErrors to wire errors; anything else stays loud. */
function withAccountErrors(ws: ServerWebSocket<SocketData>, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    if (e instanceof AccountError) return sendError(ws, e.code, e.message);
    throw e;
  }
}

function resolvedAccountId(ws: ServerWebSocket<SocketData>): string {
  const accountId = ws.data.accountId;
  if (!accountId) throw new Error("social handler before hello account resolution");
  return accountId;
}

/**
 * Re-sync a bound seat's identity caches (displayName + cardProfile) and its durable row from the
 * seat's account profile, then broadcast the roster. Used after claim / setDisplayName / equipTitle.
 */
export function refreshSeatIdentity(ws: ServerWebSocket<SocketData>): void {
  if (!ws.data.roomCode || !ws.data.seatId) return;
  const room = rooms.get(ws.data.roomCode);
  const seat = room?.seats.find((s) => s.seatId === ws.data.seatId);
  if (!room || !seat || !seat.accountId) return;
  const card = loadCardProfile(seat.accountId);
  seat.displayName = card.displayName;
  seat.cardProfile = { level: card.level, equippedTitleId: card.equippedTitleId };
  upsertRunSeat(room.runId, seat.seatIndex, {
    clientId: seat.clientId,
    displayName: seat.displayName,
    controllerKind: "human",
    tokenSalt: seat.tokenSalt,
    accountId: seat.accountId,
  });
  broadcastRoomState(room, io);
}

// --- Profile ---

export function handleGetProfile(
  ws: ServerWebSocket<SocketData>,
  msg: Extract<ClientMessage, { type: "getProfile" }>,
): void {
  withAccountErrors(ws, () => {
    const accountId = msg.accountId ?? resolvedAccountId(ws);
    sendTo(ws, { type: "profile", profile: loadProfilePayload(accountId) });
  });
}

export function handleSetDisplayName(
  ws: ServerWebSocket<SocketData>,
  msg: Extract<ClientMessage, { type: "setDisplayName" }>,
): void {
  withAccountErrors(ws, () => {
    const accountId = resolvedAccountId(ws);
    setDisplayName(accountId, msg.name);
    refreshSeatIdentity(ws);
    presence.pushToAccount(accountId, { type: "profile", profile: loadProfilePayload(accountId) });
  });
}

export function handleEquipTitle(
  ws: ServerWebSocket<SocketData>,
  msg: Extract<ClientMessage, { type: "equipTitle" }>,
): void {
  withAccountErrors(ws, () => {
    const accountId = resolvedAccountId(ws);
    equipTitle(accountId, msg.titleId);
    refreshSeatIdentity(ws);
    presence.pushToAccount(accountId, { type: "profile", profile: loadProfilePayload(accountId) });
  });
}

// --- Friends ---

/** The friend's joinable-room code: a live seat in a listed lobby-phase room with an open seat. */
function joinableRoomCodeFor(accountId: string): RoomCode | null {
  for (const room of rooms.joinableRooms()) {
    if (room.seats.some((s) => s.accountId === accountId && s.socket !== null)) return room.code;
  }
  return null;
}

export function buildFriendsList(accountId: string): FriendsListPayload {
  const account = accountById(accountId);
  if (account.is_guest) return { friends: [], incoming: [], outgoing: [] };

  const lists = listFriends(accountId);
  const friends: FriendEntry[] = lists.friends.map((id) => {
    const card = loadCardProfile(id);
    return {
      accountId: id,
      displayName: card.displayName,
      level: card.level,
      equippedTitleId: card.equippedTitleId,
      online: presence.isOnline(id),
      roomCode: joinableRoomCodeFor(id),
    };
  });
  const toRequestEntry = (r: { accountId: string; sentAt: string }): FriendRequestEntry => {
    const card = loadCardProfile(r.accountId);
    return { accountId: r.accountId, displayName: card.displayName, level: card.level, sentAt: r.sentAt };
  };
  return {
    friends,
    incoming: lists.incoming.map(toRequestEntry),
    outgoing: lists.outgoing.map(toRequestEntry),
  };
}

/** Full-snapshot friendsList push to every live socket of an account. */
export function pushFriendsListTo(accountId: string): void {
  if (!presence.isOnline(accountId)) return;
  presence.pushToAccount(accountId, { type: "friendsList", friends: buildFriendsList(accountId) });
}

/** On a presence 0<->1 transition, refresh the friends panels of this account's ONLINE friends. */
export function pushPresenceDelta(accountId: string): void {
  if (accountById(accountId).is_guest) return; // guests have no friends to notify
  for (const friendId of acceptedFriendIds(accountId)) {
    if (presence.isOnline(friendId)) pushFriendsListTo(friendId);
  }
}

/**
 * A room's lobby joinability changed (seat bound/freed, last seat filled, game started, room
 * reaped): refresh the friends panels watching every seated account, so the Join affordance
 * (§7.4) tracks reality — mutation/presence pushes alone never fire on lobby entry/exit.
 */
export function pushRoomPresenceDelta(room: Room): void {
  const seen = new Set<string>();
  for (const seat of room.seats) {
    if (seat.accountId !== null && seat.socket !== null && !seen.has(seat.accountId)) {
      seen.add(seat.accountId);
      pushPresenceDelta(seat.accountId);
    }
  }
}

export function handleGetFriends(ws: ServerWebSocket<SocketData>): void {
  withAccountErrors(ws, () => {
    // Guests get truthful empty lists, not an error (§5 friends rules).
    sendTo(ws, { type: "friendsList", friends: buildFriendsList(resolvedAccountId(ws)) });
  });
}

export function handleFriendRequest(
  ws: ServerWebSocket<SocketData>,
  msg: Extract<ClientMessage, { type: "friendRequest" }>,
): void {
  withAccountErrors(ws, () => {
    const accountId = resolvedAccountId(ws);
    const { toAccountId } = sendFriendRequest(accountId, msg.username);
    pushFriendsListTo(accountId);
    pushFriendsListTo(toAccountId);
  });
}

export function handleFriendAccept(
  ws: ServerWebSocket<SocketData>,
  msg: Extract<ClientMessage, { type: "friendAccept" }>,
): void {
  withAccountErrors(ws, () => {
    const accountId = resolvedAccountId(ws);
    acceptFriend(accountId, msg.accountId);
    pushFriendsListTo(accountId);
    pushFriendsListTo(msg.accountId);
  });
}

export function handleFriendDecline(
  ws: ServerWebSocket<SocketData>,
  msg: Extract<ClientMessage, { type: "friendDecline" }>,
): void {
  withAccountErrors(ws, () => {
    const accountId = resolvedAccountId(ws);
    declineFriend(accountId, msg.accountId);
    pushFriendsListTo(accountId);
    pushFriendsListTo(msg.accountId);
  });
}

export function handleFriendRemove(
  ws: ServerWebSocket<SocketData>,
  msg: Extract<ClientMessage, { type: "friendRemove" }>,
): void {
  withAccountErrors(ws, () => {
    const accountId = resolvedAccountId(ws);
    removeFriend(accountId, msg.accountId);
    pushFriendsListTo(accountId);
    pushFriendsListTo(msg.accountId);
  });
}

// --- Seat-scoped: invite + chat ---

export function handleFriendInvite(
  room: Room,
  seat: Seat,
  ws: ServerWebSocket<SocketData>,
  targetAccountId: string,
): void {
  withAccountErrors(ws, () => {
    const accountId = seat.accountId ?? resolvedAccountId(ws);
    if (room.phase !== "lobby") throw new AccountError("BAD_PHASE", "Invites only work from a lobby");
    if (!room.seats.some((s) => s.state === "open")) throw new AccountError("ROOM_FULL", "No open seat to invite into");
    if (!acceptedFriendIds(accountId).includes(targetAccountId)) {
      throw new AccountError("INVALID_INPUT", "You can only invite friends");
    }
    presence.pushToAccount(targetAccountId, {
      type: "roomInvite",
      from: { accountId, displayName: seat.displayName },
      code: room.code,
      dimensionId: room.dimensionId,
    });
  });
}

export function handleChatSend(
  room: Room,
  seat: Seat,
  ws: ServerWebSocket<SocketData>,
  text: string,
): void {
  withAccountErrors(ws, () => {
    if (room.phase !== "lobby" && room.phase !== "overworld") {
      throw new AccountError("BAD_PHASE", "Chat is available in the lobby and overworld only");
    }
    const clean = validateChatText(text);
    const now = Date.now();
    seat.chatTimestamps = seat.chatTimestamps.filter((t) => now - t < CHAT_RATE_WINDOW_MS);
    if (seat.chatTimestamps.length >= CHAT_RATE_LIMIT) {
      throw new AccountError("RATE_LIMITED", "You are sending messages too quickly");
    }
    seat.chatTimestamps.push(now);

    const entry: ChatEntry = { seatId: seat.seatId, displayName: seat.displayName, text: clean, t: now };
    room.chatLog.push(entry);
    if (room.chatLog.length > CHAT_LOG_CAP) room.chatLog.shift();
    io.broadcast(room, { type: "chat", entry });
  });
}
