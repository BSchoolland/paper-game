/**
 * Scripted protocol states — every refine-4 mock state, driven through the SAME dispatch the
 * real socket uses. A fixture boots by pushing ServerMessages (plus the rare direct store poke
 * for what the wire can't express, e.g. "transport is reconnecting right now").
 */
import type { ClientMessage, RoomStatePayload, SeatInfo, ServerMessage } from "shared";
import { PROTOCOL_VERSION } from "shared";
import { session } from "../src/state/session.svelte.js";
import { room } from "../src/state/room.svelte.js";
import { chrome } from "../src/state/chrome.svelte.js";
import { DIMS, FEN_CODEX, fenAuth, guestAuth, seedDimensions } from "./fixture-data.js";

export interface FixtureCtx {
  push(msg: ServerMessage): void;
  status(s: "connecting" | "open" | "reconnecting"): void;
}

export interface Fixture {
  label: string;
  boot(ctx: FixtureCtx): void;
  /** Optional live behavior: answer client sends so the fixture feels alive. */
  respond?(msg: ClientMessage, ctx: FixtureCtx): void;
}

function welcome(auth: ReturnType<typeof guestAuth>): ServerMessage {
  return { type: "welcome", protocolVersion: PROTOCOL_VERSION, sessionToken: "mock-session", auth };
}

const LV1_ROOMS: ServerMessage = {
  type: "roomList",
  rooms: [
    { code: "GRETA1", hostDisplayName: "Greta", openSeats: 1, totalSeats: 3, dimensionId: 1, phase: "lobby" },
    { code: "KWXR47", hostDisplayName: "Rook", openSeats: 3, totalSeats: 4, dimensionId: 2, phase: "lobby" },
  ],
};

function seat(partial: Partial<SeatInfo> & Pick<SeatInfo, "seatId" | "state" | "displayName">): SeatInfo {
  return {
    isHost: false,
    heroEntityId: null,
    ready: false,
    presetId: null,
    accountId: null,
    level: null,
    equippedTitleId: null,
    manifestIds: [],
    ...partial,
  };
}

function hostRoomState(): RoomStatePayload {
  return {
    protocolVersion: PROTOCOL_VERSION,
    code: "V4KHM8",
    phase: "lobby",
    hostSeatId: "s0",
    capacity: 4,
    yourSeatId: "s0",
    runId: 101,
    dimensionId: 2,
    dimensionName: DIMS[2]!.name,
    dimensionTier: 1,
    contract: null,
    outcome: null,
    partyBag: [],
    rested: false,
    seats: [
      seat({ seatId: "s0", state: "human-connected", displayName: "Fen", isHost: true, accountId: "acc-fen", level: 15, presetId: "vanguard", equippedTitleId: "pathfinder" }),
      seat({ seatId: "s1", state: "human-connected", displayName: "Rook", accountId: "acc-rook", level: 12, ready: true, presetId: "ranger", manifestIds: ["driftwood-bow"] }),
      seat({ seatId: "s2", state: "bot", displayName: "BOT", ready: true }),
      seat({ seatId: "s3", state: "open", displayName: "" }),
    ],
  };
}

function playerRoomState(): RoomStatePayload {
  return {
    protocolVersion: PROTOCOL_VERSION,
    code: "TBNQ83",
    phase: "lobby",
    hostSeatId: "s2",
    capacity: 4,
    yourSeatId: "s0",
    runId: 102,
    dimensionId: 1,
    dimensionName: DIMS[1]!.name,
    dimensionTier: 0,
    contract: { type: "activate-gateway", targetHex: { q: -5, r: 0 }, targetDimensionId: 1, progress: 0, required: 1, completed: false },
    outcome: null,
    partyBag: [],
    rested: false,
    seats: [
      seat({ seatId: "s0", state: "human-connected", displayName: "Fen", accountId: "acc-fen", level: 7, presetId: "mystic", manifestIds: ["coral-blade", "nautilus-shield"] }),
      seat({ seatId: "s1", state: "human-disconnected", displayName: "Maren", accountId: "acc-maren", level: 9, presetId: "ranger" }),
      seat({ seatId: "s2", state: "human-connected", displayName: "Greta", isHost: true, accountId: "acc-greta", level: 15, ready: true, presetId: "vanguard", manifestIds: ["leviathan-jaw-blade", "titan-jawbone"] }),
      seat({ seatId: "s3", state: "open", displayName: "" }),
    ],
  };
}

const CONTRACT_OFFERS: ServerMessage = {
  type: "contractOffers",
  offers: [
    { type: "slay-boss", targetHex: { q: 7, r: -3 }, required: 1 },
    { type: "recover-relic", targetHex: { q: -4, r: -2 }, required: 1 },
    { type: "activate-gateway", targetHex: { q: 5, r: 1 }, required: 1 },
    { type: "chart-hexes", targetHex: null, required: 10 },
  ],
};

const DIM_OPTIONS: ServerMessage = {
  type: "dimensionOptions",
  options: [
    { id: 1, name: DIMS[1]!.name, tier: 0 },
    { id: 2, name: DIMS[2]!.name, tier: 1 },
    { id: 704, name: DIMS[704]!.name, tier: 2 },
  ],
};

/** Echo a mutated roomState so READY / kit / manifest clicks feel real. */
function roomResponder(state: () => RoomStatePayload): (msg: ClientMessage, ctx: FixtureCtx) => void {
  let current: RoomStatePayload | null = null;
  return (msg, ctx) => {
    current ??= state();
    const mySeatId = current.yourSeatId;
    const patchSeat = (patch: Partial<SeatInfo>) => {
      current = {
        ...current!,
        seats: current!.seats.map((s) => (s.seatId === mySeatId ? { ...s, ...patch } : s)),
      };
      ctx.push({ type: "roomState", room: current });
    };
    switch (msg.type) {
      case "setReady":
        patchSeat({ ready: msg.ready });
        break;
      case "choosePreset":
        patchSeat({ presetId: msg.presetId });
        break;
      case "chooseManifest":
        patchSeat({ manifestIds: msg.itemIds });
        break;
      case "chooseDimension": {
        const dim = DIMS[msg.dimensionId];
        if (dim) {
          current = { ...current, dimensionId: msg.dimensionId, dimensionName: dim.name, dimensionTier: dim.tier };
          ctx.push({ type: "roomState", room: current });
        }
        break;
      }
      case "chooseContract":
        current = {
          ...current,
          contract: { type: msg.contractType, targetHex: { q: 5, r: 1 }, targetDimensionId: current.dimensionId, progress: 0, required: 1, completed: false },
        };
        ctx.push({ type: "roomState", room: current });
        break;
      case "chatSend":
        ctx.push({ type: "chat", entry: { seatId: mySeatId ?? "s0", displayName: "Fen", text: msg.text, t: 0 } });
        break;
      case "leaveRoom":
        ctx.push({ type: "leftRoom" });
        break;
      default:
        break;
    }
  };
}

export const FIXTURES: Record<string, Fixture> = {
  lv1: {
    label: "HOME · LV 1",
    boot(ctx) {
      seedDimensions();
      ctx.status("open");
      ctx.push(welcome(guestAuth()));
      ctx.push({ type: "codex", entries: [] });
      ctx.push(LV1_ROOMS);
    },
    respond(msg, ctx) {
      if (msg.type === "claimAccount") {
        if (msg.username.toLowerCase() === "rook") {
          ctx.push({ type: "error", code: "USERNAME_TAKEN", message: "That username is taken — try another.", recoverable: true });
        } else {
          const auth = { ...guestAuth(), isGuest: false, username: msg.username };
          ctx.push({ type: "authState", auth: { ...auth, profile: { ...auth.profile, isGuest: false, username: msg.username } } });
        }
      }
      if (msg.type === "listRooms") ctx.push(LV1_ROOMS);
    },
  },

  claim: {
    label: "CREATE ACCOUNT",
    boot(ctx) {
      FIXTURES.lv1!.boot(ctx);
      chrome.accountDialog = "claim";
      ctx.push({ type: "error", code: "USERNAME_TAKEN", message: "That username is taken — try another.", recoverable: true });
    },
    respond(msg, ctx) {
      FIXTURES.lv1!.respond!(msg, ctx);
    },
  },

  vet: {
    label: "HOME · LV 15",
    boot(ctx) {
      seedDimensions();
      ctx.status("open");
      ctx.push(welcome(fenAuth()));
      ctx.push({ type: "codex", entries: FEN_CODEX });
      ctx.push({
        type: "roomList",
        rooms: [
          { code: "KWXR47", hostDisplayName: "Rook", openSeats: 2, totalSeats: 4, dimensionId: 2, phase: "lobby" },
          { code: "GRETA1", hostDisplayName: "Greta", openSeats: 1, totalSeats: 3, dimensionId: 1, phase: "lobby" },
          { code: "ODOODO", hostDisplayName: "Odo", openSeats: 0, totalSeats: 2, dimensionId: 704, phase: "overworld" },
        ],
      });
      ctx.push({
        type: "friendsList",
        friends: {
          friends: [
            { accountId: "acc-rook", displayName: "Rook", level: 12, equippedTitleId: null, online: true, roomCode: "KWXR47" },
            { accountId: "acc-maren", displayName: "Maren", level: 9, equippedTitleId: null, online: true, roomCode: null },
            { accountId: "acc-sella", displayName: "Sella", level: 3, equippedTitleId: null, online: false, roomCode: null },
          ],
          incoming: [{ accountId: "acc-piper", displayName: "Piper", level: 2, sentAt: "2026-07-01T00:00:00Z" }],
          outgoing: [{ accountId: "acc-aldous", displayName: "Aldous", level: 11, sentAt: "2026-07-01T00:00:00Z" }],
        },
      });
      ctx.push({ type: "titlesEarned", titleIds: ["sealbearer"] });
      ctx.push({ type: "roomInvite", from: { accountId: "acc-rook", displayName: "Rook" }, code: "KWXR47", dimensionId: 2 });
      ctx.push({ type: "error", code: "ROOM_NOT_FOUND", message: "No room found with that code — check it with your friend.", recoverable: true });
    },
  },

  room: {
    label: "ROOM · HOST",
    boot(ctx) {
      seedDimensions();
      ctx.status("open");
      ctx.push(welcome(fenAuth()));
      ctx.push({ type: "codex", entries: FEN_CODEX });
      ctx.push({ type: "roomState", room: hostRoomState() });
      ctx.push(CONTRACT_OFFERS);
      ctx.push(DIM_OPTIONS);
      ctx.push({
        type: "chatHistory",
        entries: [
          { seatId: "s1", displayName: "Rook", text: "gloom hollows again? bring light, the dark down there bites", t: 1 },
          { seatId: "s0", displayName: "Fen", text: "picking the contract now, gateway or boss?", t: 2 },
          { seatId: "s1", displayName: "Rook", text: "gateway. piper might take the open seat", t: 3 },
        ],
      });
      ctx.push({
        type: "friendsList",
        friends: {
          friends: [
            { accountId: "acc-maren", displayName: "Maren", level: 9, equippedTitleId: null, online: true, roomCode: null },
            { accountId: "acc-sella", displayName: "Sella", level: 3, equippedTitleId: null, online: false, roomCode: null },
          ],
          incoming: [],
          outgoing: [],
        },
      });
    },
    respond: roomResponder(hostRoomState),
  },

  player: {
    label: "ROOM · PLAYER",
    boot(ctx) {
      seedDimensions();
      ctx.status("open");
      const auth = fenAuth();
      ctx.push(welcome({ ...auth, profile: { ...auth.profile, level: 7, xp: 0 } }));
      ctx.push({ type: "codex", entries: FEN_CODEX });
      ctx.push({ type: "roomState", room: playerRoomState() });
      ctx.push(CONTRACT_OFFERS);
      ctx.push(DIM_OPTIONS);
      ctx.push({
        type: "chatHistory",
        entries: [
          { seatId: "s2", displayName: "Greta", text: "shallows first, piper needs the practice", t: 1 },
          { seatId: "s1", displayName: "Maren", text: "my wifi is dying, hold my seat", t: 2 },
          { seatId: "s0", displayName: "Fen", text: "ok ok ok ok", t: 3 },
        ],
      });
      // What the wire can't replay: mid-reconnect transport + the pruned-manifest margin note.
      room.returnedManifestIds = ["prism-staff"];
      room.chatRateLimited = true;
      ctx.status("reconnecting");
    },
    respond: roomResponder(playerRoomState),
  },

  connecting: {
    label: "CONNECTING",
    boot(ctx) {
      ctx.status("connecting");
    },
  },

  update: {
    label: "UPDATE",
    boot(ctx) {
      ctx.status("open");
      ctx.push({ type: "protocolMismatch", serverVersion: PROTOCOL_VERSION + 1, clientVersion: PROTOCOL_VERSION });
    },
  },

  elsewhere: {
    label: "ELSEWHERE",
    boot(ctx) {
      ctx.status("open");
      ctx.push(welcome(fenAuth()));
      ctx.push({ type: "displaced" });
    },
  },

  rejoin: {
    label: "REJOIN",
    boot(ctx) {
      ctx.status("open");
      ctx.push(welcome(fenAuth()));
      session.reclaim = { code: "KWXR47", seatId: "s1", phase: "offered" };
    },
    respond(msg, ctx) {
      if (msg.type === "reclaimSeat" && msg.force) {
        ctx.push({ type: "roomState", room: hostRoomState() });
        ctx.push(CONTRACT_OFFERS);
        ctx.push(DIM_OPTIONS);
      }
    },
  },
};
