import type { ServerWebSocket } from "bun";
import type { ServerMessage, ServerEnvelope, WireLogRecord } from "shared";
import { summarizeEvent } from "shared";
import { rooms } from "./room-registry.js";
import type { Room, Seat, SocketData } from "./room.js";
import type { RoomIO } from "./room-machine.js";
import { eventLog } from "./event-log.js";
import { saveWireLogRecord, loadWireLogRecords, clearWireLogRecords } from "./db.js";

// =====================================================================================
// Wire transport — the only place a ServerMessage becomes bytes on a socket. Every send is
// wrapped in a ServerEnvelope { seq, t, msg } and mirrored into the event log, so the room
// machine (which drives sends through `io`) never touches sockets or sequencing itself.
// =====================================================================================

eventLog.setPersister({
  save: saveWireLogRecord,
  recent: loadWireLogRecords,
  clear: clearWireLogRecords,
});

let emitOrdinal = 0;

function nextT(): number {
  return ++emitOrdinal;
}

function buildSendRecord(ws: ServerWebSocket<SocketData>, env: ServerEnvelope, note?: string): WireLogRecord {
  const room = ws.data.roomCode ? rooms.get(ws.data.roomCode) : null;
  const stateMsg = env.msg.type === "state" ? env.msg : null;
  return {
    dir: "send",
    seq: env.seq,
    t: env.t,
    room: ws.data.roomCode ?? undefined,
    runId: room?.runId,
    seatId: ws.data.seatId ?? undefined,
    type: env.msg.type,
    actionCount: stateMsg?.state.actionCount,
    events: stateMsg?.events.map(summarizeEvent),
    combatPhase: room?.combat?.step.kind,
    note,
  };
}

function emit(ws: ServerWebSocket<SocketData>, msg: ServerMessage, note?: string): void {
  const seq = ++ws.data.seq;
  const env: ServerEnvelope = { seq, t: nextT(), msg };
  ws.send(JSON.stringify(env));
  eventLog.record(buildSendRecord(ws, env, note));
}

export const io: RoomIO = {
  send(seat: Seat, msg: ServerMessage, note?: string): void {
    if (seat.socket) emit(seat.socket, msg, note);
  },
  broadcast(room: Room, msg: ServerMessage, note?: string): void {
    for (const seat of room.seats) {
      if (seat.socket) emit(seat.socket, msg, note);
    }
  },
};

/** Send directly to one socket (pre-seat handshake messages: welcome / error / displaced). */
export function sendTo(ws: ServerWebSocket<SocketData>, msg: ServerMessage, note?: string): void {
  emit(ws, msg, note);
}
