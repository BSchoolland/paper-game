import type { AccountId, AttachmentData, ContractType, HexCoord, RoomCapacity, RoomCode, SeatId, VoteChoice, WireAction } from "shared";
import { socket } from "../net/client.js";
import { clearStoredSeat } from "../net/identity.js";
import { expectInputErrorAt } from "./dispatch.js";
import { session } from "./session.svelte.js";
import { room } from "./room.svelte.js";
import { social } from "./social.svelte.js";
import { home } from "./home.svelte.js";
import { combat } from "./combat.svelte.js";

/**
 * The only way screens talk to the server. Each action clears the error slot it can refill,
 * so a retry never shows a stale inline error.
 */

// --- home / rooms ---
export function play(capacity: RoomCapacity): void {
  home.createError = null;
  socket().send({ type: "createRoom", capacity });
}

export function joinByCode(code: RoomCode): void {
  home.joinError = null;
  socket().send({ type: "joinRoom", code });
}

export function quickJoin(): void {
  home.joinError = null;
  socket().send({ type: "quickMatch" });
}

export function refreshRooms(): void {
  socket().send({ type: "listRooms" });
}

export function leaveRoom(): void {
  socket().send({ type: "leaveRoom" });
}

export function playAgain(): void {
  socket().send({ type: "playAgain" });
}

// --- room staging ---
export function setReady(ready: boolean): void {
  socket().send({ type: "setReady", ready });
}

export function startGame(): void {
  socket().send({ type: "startGame" });
}

export function choosePreset(presetId: string): void {
  socket().send({ type: "choosePreset", presetId });
}

export function chooseContract(contractType: ContractType): void {
  socket().send({ type: "chooseContract", contractType });
}

export function chooseDimension(dimensionId: number): void {
  socket().send({ type: "chooseDimension", dimensionId });
}

export function chooseManifest(itemIds: readonly string[]): void {
  room.returnedManifestIds = [];
  socket().send({ type: "chooseManifest", itemIds });
}

export function sendChat(text: string): void {
  socket().send({ type: "chatSend", text });
}

// --- account ---
export function claimAccount(username: string, password: string, email?: string): void {
  session.authError = null;
  expectInputErrorAt("auth");
  socket().send({ type: "claimAccount", username, password, email });
}

export function register(username: string, password: string, email?: string): void {
  session.authError = null;
  expectInputErrorAt("auth");
  socket().send({ type: "register", username, password, email });
}

export function login(username: string, password: string): void {
  session.authError = null;
  expectInputErrorAt("auth");
  socket().send({ type: "login", username, password });
}

export function logout(): void {
  socket().send({ type: "logout" });
}

export function setDisplayName(name: string): void {
  expectInputErrorAt(null);
  socket().send({ type: "setDisplayName", name });
}

export function equipTitle(titleId: string | null): void {
  socket().send({ type: "equipTitle", titleId });
}

// --- social ---
export function addFriend(username: string): void {
  social.addError = null;
  expectInputErrorAt("friendAdd");
  socket().send({ type: "friendRequest", username });
}

export function friendAccept(accountId: AccountId): void {
  socket().send({ type: "friendAccept", accountId });
}

export function friendDecline(accountId: AccountId): void {
  socket().send({ type: "friendDecline", accountId });
}

export function friendRemove(accountId: AccountId): void {
  socket().send({ type: "friendRemove", accountId });
}

export function friendInvite(accountId: AccountId): void {
  socket().send({ type: "friendInvite", accountId });
}

// --- seat reclaim (the REJOIN connect face) ---
export function takeOverSeat(): void {
  const r = session.reclaim;
  if (!r) return;
  session.reclaim = { ...r, phase: "pending" };
  socket().send({ type: "reclaimSeat", code: r.code, seatId: r.seatId, force: true });
}

export function stayHere(): void {
  clearStoredSeat();
  session.reclaim = null;
}

export function retryConnect(): void {
  socket().retryNow();
}

// --- run (overworld + combat) ---
export function proposeMove(target: HexCoord): void {
  socket().send({ type: "proposeMove", target });
}

export function castVote(proposalId: string, vote: VoteChoice): void {
  socket().send({ type: "castVote", proposalId, vote });
}

export function proposeRetreat(): void {
  socket().send({ type: "proposeRetreat" });
}

export function proposeTravel(): void {
  socket().send({ type: "proposeTravel" });
}

export function takeLoot(lootId: number): void {
  socket().send({ type: "takeLoot", lootId });
}

export function stashLoot(bagIndex: number): void {
  socket().send({ type: "stashLoot", bagIndex });
}

export function sendAction(seatId: SeatId, action: WireAction): void {
  socket().send({ type: "action", seatId, action });
}

export function pass(): void {
  socket().send({ type: "pass" });
}

export function unpass(): void {
  socket().send({ type: "unpass" });
}

export function defendResult(seatId: SeatId, promptId: string, power: number): void {
  combat.defend = null;
  socket().send({ type: "defendResult", seatId, promptId, power });
}

export function equip(bagIndex: number): void {
  socket().send({ type: "equip", bagIndex });
}

export function unequip(equippedIndex: number): void {
  socket().send({ type: "unequip", equippedIndex });
}

export function updateAttachment(itemId: string, attachment: AttachmentData): void {
  socket().send({ type: "updateAttachment", itemId, attachment });
}
