import { describe, it, expect, beforeAll } from "bun:test";
import type { ServerMessage } from "shared";
import { startServer, connectClient, hello, sleep, type HarnessServer, type MockClient } from "./coop-harness.js";
import { rooms } from "../room-registry.js";
import { disposeRoom } from "../room.js";

/**
 * Force the durable resume path: drop the live in-memory Room for a run (timers + registry entry,
 * NOT durable rows, R19) so the next reconnect by clientId reconstructs the Room from SQLite
 * (run_seats / run_seat_items) instead of finding the still-live in-memory inventory.
 */
function evictLiveRoom(code: string): void {
  const room = rooms.get(code);
  if (!room) return;
  disposeRoom(room);
  rooms.remove(room);
}

const DIM = 0;
let server: HarnessServer;

beforeAll(async () => {
  server = await startServer();
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`http://localhost:${server.port}/health`)).ok) return;
    } catch {
      /* not up */
    }
    await sleep(50);
  }
  throw new Error("server did not come up");
});

function isRoomState(m: ServerMessage): m is Extract<ServerMessage, { type: "roomState" }> {
  return m.type === "roomState";
}
function isInventory(m: ServerMessage): m is Extract<ServerMessage, { type: "inventory" }> {
  return m.type === "inventory";
}

async function createRoom(client: MockClient, capacity: 2 | 3 | 4) {
  client.send({ type: "createRoom", capacity, dimensionId: DIM });
  await client.nextOf("welcome");
  const rs = await client.waitFor(isRoomState);
  const inv = await client.waitFor(isInventory);
  return { code: rs.room.code, inv };
}

/** First non-empty bag slot index in an inventory message. */
function firstBagIndex(inv: Extract<ServerMessage, { type: "inventory" }>): number {
  const i = inv.inventory.bag.findIndex((it) => it !== null);
  if (i < 0) throw new Error("starter bag was empty");
  return i;
}

describe("per-seat inventory", () => {
  it("equip on one seat does not change another seat's bag (isolation)", async () => {
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host, "Host");
    await hello(guest, "Guest");

    const { code, inv: hostInv } = await createRoom(host, 2);
    guest.send({ type: "joinRoom", code, displayName: "Guest" });
    await guest.nextOf("welcome");
    await guest.waitFor(isRoomState);
    const guestInv = await guest.waitFor(isInventory);

    // Both start with the same default loadout (nothing equipped).
    expect(hostInv.inventory.equipped.length).toBe(0);
    expect(guestInv.inventory.equipped.length).toBe(0);

    // Host equips its first bag item.
    const bagIdx = firstBagIndex(hostInv);
    const equippedId = hostInv.inventory.bag[bagIdx]!.id;
    host.mark();
    host.send({ type: "equip", bagIndex: bagIdx });
    const hostAfter = await host.nextOf("inventory", { fromNow: true, timeoutMs: 4000 });
    expect(hostAfter.inventory.equipped.map((i) => i.id)).toContain(equippedId);
    expect(hostAfter.inventory.bag[bagIdx]).toBeNull();

    // The roster's loadoutSummary updates for s0 only; s1 stays empty.
    const roster = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && (m.room.seats[0]!.loadoutSummary?.equippedIds.length ?? 0) > 0,
      { consumeBuffered: false, timeoutMs: 4000 },
    );
    expect(roster.room.seats[0]!.loadoutSummary!.equippedIds).toContain(equippedId);
    expect(roster.room.seats[1]!.loadoutSummary!.equippedIds.length).toBe(0);

    // The guest never received a new `inventory` message (its bag is untouched).
    expect(guest.inbox.filter(isInventory).length).toBe(1);

    host.close();
    guest.close();
  });

  it("equip is durable through a reconnect within the live room (saveSeatInventory round-trip)", async () => {
    const owner = await connectClient(server);
    await hello(owner, "Owner");
    const { code, inv } = await createRoom(owner, 2);

    // Equip an item, capturing what should persist.
    const bagIdx = firstBagIndex(inv);
    const equippedId = inv.inventory.bag[bagIdx]!.id;
    owner.mark();
    owner.send({ type: "equip", bagIndex: bagIdx });
    const afterEquip = await owner.nextOf("inventory", { fromNow: true, timeoutMs: 4000 });
    expect(afterEquip.inventory.equipped.map((i) => i.id)).toContain(equippedId);

    // Start the game so the run is a genuine in-progress (overworld) run — an unstarted lobby run is
    // intentionally NOT resumable (it is abandoned when the lobby empties), so we resume a real run.
    owner.send({ type: "startGame" });
    await owner.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "overworld",
      { consumeBuffered: false, timeoutMs: 4000 },
    );

    // Disconnect AND evict the live Room (simulating a restart / reap) so the reconnect must
    // rehydrate the bag from SQLite (run_seat_items), not from a surviving in-memory inventory.
    owner.close();
    await owner.closed;
    await sleep(200);
    evictLiveRoom(code);

    // Reconnect with the SAME clientId. hello -> reconstructRoomForRun -> the seat's persisted bag
    // is rehydrated from run_seat_items and pushed back as `inventory`.
    const owner2 = await connectClient(server, owner.clientId);
    const w2 = await hello(owner2, "Owner");
    expect(w2.reconnected).toBeTruthy();
    const reInv = await owner2.waitFor(isInventory, { timeoutMs: 4000 });
    expect(reInv.inventory.equipped.map((i) => i.id)).toContain(equippedId);
    // The equipped item is no longer sitting in the bag.
    expect(reInv.inventory.bag.some((it) => it?.id === equippedId)).toBe(false);

    owner2.close();
  });

  it("unequip is durable through a reconnect (bag/equipped round-trip)", async () => {
    const owner = await connectClient(server);
    await hello(owner, "Owner2");
    const { code, inv } = await createRoom(owner, 2);

    // equip then unequip; the item should return to the bag and stay there after reconnect.
    const bagIdx = firstBagIndex(inv);
    const itemId = inv.inventory.bag[bagIdx]!.id;
    owner.mark();
    owner.send({ type: "equip", bagIndex: bagIdx });
    await owner.nextOf("inventory", { fromNow: true, timeoutMs: 4000 });
    owner.mark();
    owner.send({ type: "unequip", equippedIndex: 0 });
    const afterUnequip = await owner.nextOf("inventory", { fromNow: true, timeoutMs: 4000 });
    expect(afterUnequip.inventory.equipped.map((i) => i.id)).not.toContain(itemId);
    expect(afterUnequip.inventory.bag.some((it) => it?.id === itemId)).toBe(true);

    // Start the game so we resume a genuine in-progress run (unstarted lobby runs are not resumable).
    owner.send({ type: "startGame" });
    await owner.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "overworld",
      { consumeBuffered: false, timeoutMs: 4000 },
    );

    owner.close();
    await owner.closed;
    await sleep(200);
    evictLiveRoom(code);

    const owner2 = await connectClient(server, owner.clientId);
    await hello(owner2, "Owner2");
    const reInv = await owner2.waitFor(isInventory, { timeoutMs: 4000 });
    expect(reInv.inventory.equipped.map((i) => i.id)).not.toContain(itemId);
    expect(reInv.inventory.bag.some((it) => it?.id === itemId)).toBe(true);

    owner2.close();
  });
});
