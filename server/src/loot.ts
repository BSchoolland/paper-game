import type { LootPoolEntry } from "shared";
import { rollDrops } from "shared";
import type { Room } from "./room.js";
import type { RoomIO } from "./room-machine.js";
import type { RunEvent } from "./run-events.js";
import { loadItems, insertRunLoot } from "./db.js";

/**
 * Loot drop recorder (docs/meta-loop/03-loot-codex.md §4.2): the `encounter-won` subscriber that
 * rolls the current dimension's item pool, persists the drops to the run's ledger, and grows the
 * shared party pool. Pure recorder (02 §4.1 discipline): it persists + broadcasts, never touches
 * phase/vote/session. The roll uses Math.random in prod (tests seed via the pure shared rollDrops).
 */
export function lootDropRecorder(room: Room, io: RoomIO,
    ev: Extract<RunEvent, { type: "encounter-won" }>): void {
  const pool = Object.values(loadItems(room.dimensionId));
  if (pool.length === 0) {
    // FALLBACK (flag #10): dev-override runs can enter incomplete dims; READY dims never hit this.
    console.error(`[loot] dimension ${room.dimensionId} has no item pool — no drops`);
    return;
  }
  const drops = rollDrops(pool, ev.icon, Math.random);
  if (drops.length === 0) return;
  const entries: LootPoolEntry[] = drops.map((item) => ({
    lootId: insertRunLoot(ev.runId, item, ev.hex, ev.icon),
    item,
    sourceIcon: ev.icon,
  }));
  room.lootPool = [...room.lootPool, ...entries];
  io.broadcast(room, { type: "lootFound", drops: entries });
}
