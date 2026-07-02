import type { ErrorCode, ServerMessage } from "shared";
import { hexKey } from "shared";
import { clearStoredSeat, getStoredSeat, setAuthToken, setStoredSeat } from "../net/identity.js";
import { socket } from "../net/client.js";
import type { SocketStatus } from "../net/socket.js";
import { session, resetSession } from "./session.svelte.js";
import { room, mySeat, resetRoom, clearRoom } from "./room.svelte.js";
import { social, resetSocial } from "./social.svelte.js";
import { codex, resetCodex } from "./codex.svelte.js";
import { home, resetHome } from "./home.svelte.js";
import { overworld, resetOverworld } from "./overworld.svelte.js";
import { combat, applyCombatSnapshot, notifyActionRejected, resetCombat } from "./combat.svelte.js";
import { chrome, pushToast, resetChrome } from "./chrome.svelte.js";
import { ensureDimensionMeta } from "./dim-meta.svelte.js";

/**
 * Where the NEXT ambiguous field error (INVALID_INPUT) belongs. The wire has no
 * request/response correlation, so the action that can trigger one declares its home
 * just before sending. Single-slot is enough: the server answers in order.
 */
let expectedInputErrorHome: "auth" | "friendAdd" | null = null;

export function expectInputErrorAt(homeSlot: "auth" | "friendAdd" | null): void {
  expectedInputErrorHome = homeSlot;
}

export function onStatus(status: SocketStatus): void {
  session.status = status;
}

/** The one place every server message is interpreted. Exhaustive: a new protocol variant fails the build here. */
export function dispatch(msg: ServerMessage): void {
  switch (msg.type) {
    case "welcome": {
      session.welcomed = true;
      session.auth = msg.auth;
      session.authRejected = msg.auth.authRejected ?? null;
      setAuthToken(msg.auth.authToken);
      // A rejected bearer token means "you were someone — log back in": open the dialog in login mode.
      if (session.authRejected) chrome.accountDialog = "login";
      if (msg.reconnected) {
        setStoredSeat(msg.reconnected);
        session.reclaim = null;
      } else {
        // Room-less welcome: any room we thought we were in is gone (snapshots would follow otherwise).
        clearRoom();
        const stored = getStoredSeat();
        if (stored) {
          // Probe: our durable seat may be live on another device. Outcomes route below.
          session.reclaim = { ...stored, phase: "pending" };
          socket().send({ type: "reclaimSeat", code: stored.code, seatId: stored.seatId });
        }
      }
      socket().send({ type: "getCodex" });
      return;
    }
    case "protocolMismatch": {
      session.halted = { kind: "update", serverVersion: msg.serverVersion, clientVersion: msg.clientVersion };
      return;
    }
    case "displaced": {
      session.halted = { kind: "displaced" };
      return;
    }
    case "leftRoom": {
      clearRoom();
      resetCombat();
      resetOverworld();
      clearStoredSeat();
      return;
    }
    case "roomList": {
      home.rooms = [...msg.rooms];
      for (const r of msg.rooms) ensureDimensionMeta(r.dimensionId);
      return;
    }
    case "roomState": {
      const prev = room.state;
      const prevMine = mySeat();
      room.state = msg.room;
      if (msg.room.yourSeatId !== null) {
        setStoredSeat({ code: msg.room.code, seatId: msg.room.yourSeatId });
        session.reclaim = null;
      }
      // A live overworld means any previous run's settlement is history (reconnect-safe).
      if (msg.room.phase === "overworld") {
        overworld.lastBank = null;
        overworld.lastCodexBank = null;
      }
      // Destination dropped to a lower tier and the server pruned manifest picks: surface which.
      if (prev && prevMine && prev.code === msg.room.code && prev.dimensionId !== msg.room.dimensionId) {
        const now = mySeat();
        if (now) {
          const kept = new Set(now.manifestIds);
          const returned = prevMine.manifestIds.filter((id) => !kept.has(id));
          if (returned.length > 0) room.returnedManifestIds = returned;
        }
      }
      ensureDimensionMeta(msg.room.dimensionId);
      return;
    }
    case "hexMapState": {
      overworld.hexMap = msg.hexMap;
      overworld.gateways = { ...msg.gateways };
      return;
    }
    case "gatewayUpdate": {
      if (msg.gateway) overworld.gateways[hexKey(msg.hex)] = msg.gateway;
      return;
    }
    case "hexDiscovered": {
      overworld.discovered.push(msg.coord);
      return;
    }
    case "voteState": {
      room.vote = msg.vote;
      return;
    }
    case "moveResolved": {
      if (room.vote?.proposalId === msg.proposalId) room.vote = null;
      overworld.lastMove = { n: (overworld.lastMove?.n ?? 0) + 1, accepted: msg.accepted, target: msg.target };
      return;
    }
    case "combatStart": {
      // Phase truth rides roomState; the board reads archetype/hex from here if it wants flavor.
      return;
    }
    case "restUpdate": {
      // Reconnect-safe truth also rides roomState.rested; this is the live flip.
      if (room.state) room.state = { ...room.state, rested: msg.rested };
      return;
    }
    case "state": {
      applyCombatSnapshot(msg.state, msg.events);
      return;
    }
    case "coopStatus": {
      combat.coop = msg.coop;
      return;
    }
    case "defendPrompt": {
      if (msg.seatId === room.state?.yourSeatId) combat.defend = msg;
      return;
    }
    case "actionRejected": {
      if (msg.seatId === room.state?.yourSeatId) notifyActionRejected();
      return;
    }
    case "combatEnd": {
      combat.defend = null;
      return;
    }
    case "gameOver": {
      combat.defend = null;
      return;
    }
    case "inventory": {
      combat.inventory = msg.inventory;
      return;
    }
    case "authState": {
      session.auth = msg.auth;
      session.authRejected = msg.auth.authRejected ?? null;
      setAuthToken(msg.auth.authToken);
      return;
    }
    case "profile": {
      if (session.auth && msg.profile.accountId === session.auth.accountId) {
        session.auth = { ...session.auth, profile: msg.profile };
      }
      return;
    }
    case "friendsList": {
      social.friends = msg.friends;
      return;
    }
    case "roomInvite": {
      pushToast({ kind: "invite", from: msg.from.displayName, code: msg.code, dimensionId: msg.dimensionId });
      ensureDimensionMeta(msg.dimensionId);
      return;
    }
    case "chat": {
      room.chat.push(msg.entry);
      room.chatRateLimited = false;
      return;
    }
    case "chatHistory": {
      room.chat = [...msg.entries];
      return;
    }
    case "contractOffers": {
      room.offers = [...msg.offers];
      return;
    }
    case "dimensionOptions": {
      room.options = [...msg.options];
      for (const o of msg.options) ensureDimensionMeta(o.id);
      return;
    }
    case "xpAward": {
      session.xpPending = msg.pending;
      return;
    }
    case "xpBanked": {
      session.xpPending = 0;
      overworld.lastBank = msg;
      pushToast({ kind: "xpBanked", banked: msg });
      if (session.auth) {
        session.auth = { ...session.auth, profile: { ...session.auth.profile, xp: msg.xp, level: msg.level } };
      }
      return;
    }
    case "titlesEarned": {
      pushToast({ kind: "titles", titleIds: msg.titleIds });
      if (session.auth) {
        const owned = new Set([...session.auth.profile.titles, ...msg.titleIds]);
        session.auth = { ...session.auth, profile: { ...session.auth.profile, titles: [...owned] } };
      }
      return;
    }
    case "lootFound": {
      pushToast({ kind: "loot", drops: msg.drops });
      return;
    }
    case "codex": {
      codex.entries = [...msg.entries];
      for (const e of msg.entries) ensureDimensionMeta(e.item.dimensionId);
      return;
    }
    case "codexBanked": {
      overworld.lastCodexBank = msg;
      if (msg.entries.length > 0) {
        pushToast({ kind: "codexBanked", entries: msg.entries, firstItemIds: msg.firstItemIds });
        codex.entries = [...msg.entries, ...(codex.entries ?? [])];
        for (const e of msg.entries) ensureDimensionMeta(e.item.dimensionId);
      }
      return;
    }
    case "error": {
      routeError(msg.code, msg.message);
      return;
    }
    default:
      msg satisfies never;
  }
}

/** Every ErrorCode has one home (refine-4 rule). Probe outcomes are consumed, not shown. */
function routeError(code: ErrorCode, message: string): void {
  const probing = session.reclaim?.phase === "pending";
  switch (code) {
    case "SEAT_IN_USE":
      if (probing && session.reclaim) {
        session.reclaim = { ...session.reclaim, phase: "offered" };
      } else {
        pushToast({ kind: "error", message });
      }
      return;
    case "ROOM_NOT_FOUND":
    case "ROOM_FULL":
    case "ALREADY_STARTED":
      if (probing) {
        // Stale stored seat (room reaped / reassigned): the probe just lands home.
        clearStoredSeat();
        session.reclaim = null;
      } else {
        home.joinError = { code, message };
      }
      return;
    case "NOT_YOUR_SEAT":
      if (probing) {
        clearStoredSeat();
        session.reclaim = null;
      } else {
        pushToast({ kind: "error", message });
      }
      return;
    case "ROOM_CREATE_FAILED":
      home.createError = { code, message };
      return;
    case "USERNAME_TAKEN":
    case "INVALID_CREDENTIALS":
    case "NOT_A_GUEST":
    case "AUTH_IN_ROOM":
      session.authError = { code, message };
      return;
    case "INVALID_INPUT":
      if (expectedInputErrorHome === "friendAdd") {
        social.addError = { code, message };
      } else if (expectedInputErrorHome === "auth") {
        session.authError = { code, message };
      } else {
        pushToast({ kind: "error", message });
      }
      return;
    case "NO_SUCH_USER":
    case "CLAIM_REQUIRED":
      social.addError = { code, message };
      return;
    case "RATE_LIMITED":
      if (room.state) {
        room.chatRateLimited = true;
      } else {
        pushToast({ kind: "error", message });
      }
      return;
    case "PROTOCOL_MISMATCH":
    case "NOT_HOST":
    case "BAD_PHASE":
    case "INVALID_MOVE":
    case "GATEWAY_UNATTUNED":
    case "NO_OPEN_PROPOSAL":
    case "MALFORMED":
      pushToast({ kind: "error", message });
      return;
    default:
      code satisfies never;
  }
}

/** Wipe every store back to boot state (the dev harness uses this between fixtures). */
export function resetAllStores(): void {
  resetSession();
  resetRoom();
  resetSocial();
  resetCodex();
  resetHome();
  resetOverworld();
  resetCombat();
  resetChrome();
}
