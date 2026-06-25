import { describe, it, expect, beforeAll } from "bun:test";
import type { ServerMessage } from "shared";
import { startServer, connectClient, hello, sleep, type HarnessServer, type MockClient } from "./coop-harness.js";
import { rooms } from "../room-registry.js";
import { disposeRoom } from "../room.js";
import { reconstructRoomForRun } from "../room-machine.js";

/**
 * Simulate a server RESTART for a run: drop the live in-memory Room (timers + registry, NOT durable
 * rows, R19), then rebuild it from SQLite via the boot crash-recovery primitive. The next reconnect by
 * clientId resumes the reconstructed Room (inventory rehydrated from run_seats / run_seat_items)
 * instead of the still-live in-memory inventory. (hello no longer lazily reconstructs — crash recovery
 * is boot-driven, so a test must reconstruct explicitly to model the restart.)
 */
function restartRoom(code: string): void {
  const room = rooms.get(code);
  if (!room) return;
  const runId = room.runId;
  disposeRoom(room);
  rooms.remove(room);
  reconstructRoomForRun(runId, () => {});
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

    // Both start with the same default preset loadout.
    const guestBaseline = guestInv.inventory.equipped.map((i) => i.id);
    expect(hostInv.inventory.equipped.map((i) => i.id)).toEqual(guestBaseline);

    // Host equips its first bag item (on top of the preset kit).
    const bagIdx = firstBagIndex(hostInv);
    const equippedId = hostInv.inventory.bag[bagIdx]!.id;
    host.mark();
    host.send({ type: "equip", bagIndex: bagIdx });
    const hostAfter = await host.nextOf("inventory", { fromNow: true, timeoutMs: 4000 });
    expect(hostAfter.inventory.equipped.map((i) => i.id)).toContain(equippedId);
    expect(hostAfter.inventory.bag[bagIdx]).toBeNull();

    // The roster's loadoutSummary picks up the new item for s0 only; s1 stays at its preset baseline.
    const roster = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && (m.room.seats[0]!.loadoutSummary?.equippedIds.includes(equippedId) ?? false),
      { consumeBuffered: false, timeoutMs: 4000 },
    );
    expect(roster.room.seats[0]!.loadoutSummary!.equippedIds).toContain(equippedId);
    expect(roster.room.seats[1]!.loadoutSummary!.equippedIds).toEqual(guestBaseline);

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

    // Disconnect AND restart the run (drop the live Room, rebuild from SQLite — simulating a crash +
    // boot recovery) so the reconnect must rehydrate the bag from run_seat_items, not in-memory state.
    owner.close();
    await owner.closed;
    await sleep(200);
    restartRoom(code);

    // Reconnect with the SAME clientId. hello finds the reconstructed live room (boot recovery rebuilt
    // it) and auto-reclaims; the seat's persisted bag was rehydrated from run_seat_items.
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
    const afterEquip = await owner.nextOf("inventory", { fromNow: true, timeoutMs: 4000 });
    const eqIdx = afterEquip.inventory.equipped.findIndex((i) => i.id === itemId);
    owner.mark();
    owner.send({ type: "unequip", equippedIndex: eqIdx });
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
    restartRoom(code);

    const owner2 = await connectClient(server, owner.clientId);
    await hello(owner2, "Owner2");
    const reInv = await owner2.waitFor(isInventory, { timeoutMs: 4000 });
    expect(reInv.inventory.equipped.map((i) => i.id)).not.toContain(itemId);
    expect(reInv.inventory.bag.some((it) => it?.id === itemId)).toBe(true);

    owner2.close();
  });
});
