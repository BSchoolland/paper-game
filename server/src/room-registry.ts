import type { ClientId, RoomCode } from "shared";
import type { Room } from "./room.js";

/**
 * Process-wide registry of live rooms (DESIGN.md §2.1). Keyed by room code (the ephemeral invite)
 * and by runId. The runId index is the anti-split-brain guard for reconnect/reconstruction:
 * two near-simultaneous reconnects to a restarted run must converge on exactly one Room (ruling
 * R30). Reaped codes are quarantined briefly so a stale invite resolves to ROOM_NOT_FOUND rather
 * than a stranger's room (ruling R20).
 */
export class RoomRegistry {
  private byCode = new Map<RoomCode, Room>();
  private byRunId = new Map<number, Room>();
  private quarantine = new Map<RoomCode, number>(); // reaped code -> expiry epoch ms
  private readonly quarantineMs: number;

  constructor(quarantineMs = 60_000) {
    this.quarantineMs = quarantineMs;
  }

  /** True if a code is in use OR still quarantined (so it can't be re-minted yet). */
  isTaken(code: RoomCode): boolean {
    return this.byCode.has(code) || this.isQuarantined(code);
  }

  get(code: RoomCode): Room | null {
    return this.byCode.get(code) ?? null;
  }

  getByRun(runId: number): Room | null {
    return this.byRunId.get(runId) ?? null;
  }

  add(room: Room): void {
    this.byCode.set(room.code, room);
    this.byRunId.set(room.runId, room);
  }

  /**
   * Register a Room for a run, throwing if a different Room already claims it (lost the
   * reconstruction race, ruling R30). The caller catches and reuses the existing Room.
   */
  registerRoomForRun(runId: number, room: Room): void {
    const existing = this.byRunId.get(runId);
    if (existing && existing !== room) {
      throw new Error(`room already registered for run ${runId}`);
    }
    this.byRunId.set(runId, room);
    this.byCode.set(room.code, room);
  }

  /** Re-key a room after a run swap (e.g. defeat -> fresh run keeps the same Room, ruling R30). */
  rekeyRun(oldRunId: number, room: Room): void {
    this.byRunId.delete(oldRunId);
    this.byRunId.set(room.runId, room);
  }

  remove(room: Room): void {
    this.byCode.delete(room.code);
    this.byRunId.delete(room.runId);
    this.quarantine.set(room.code, Date.now() + this.quarantineMs);
  }

  /** Rooms a HOME socket may join: still in the lobby with at least one open seat (matchmaking). */
  joinableRooms(): Room[] {
    const out: Room[] = [];
    for (const room of this.byCode.values()) {
      if (room.phase === "lobby" && room.seats.some((s) => s.state === "open")) out.push(room);
    }
    return out;
  }

  /** The first joinable room — the quick-match target — or null if none exist. */
  firstJoinable(): Room | null {
    for (const room of this.byCode.values()) {
      if (room.phase === "lobby" && room.seats.some((s) => s.state === "open")) return room;
    }
    return null;
  }

  /** Find the live room currently hosting a given client's seat, if any (in-memory fast path). */
  findRoomForClient(clientId: ClientId): { room: Room; seatId: string } | null {
    for (const room of this.byCode.values()) {
      const seat = room.seats.find((s) => s.clientId === clientId && s.socket !== null);
      if (seat) return { room, seatId: seat.seatId };
    }
    return null;
  }

  get size(): number {
    return this.byCode.size;
  }

  private isQuarantined(code: RoomCode): boolean {
    const expiry = this.quarantine.get(code);
    if (expiry === undefined) return false;
    if (expiry <= Date.now()) {
      this.quarantine.delete(code); // lazily prune on lookup
      return false;
    }
    return true;
  }
}

export const rooms = new RoomRegistry();
