import { describe, it, expect, beforeAll } from "bun:test";
import type { ServerMessage } from "shared";
import { startServer, connectClient, hello, sleep, type HarnessServer, type MockClient } from "./coop-harness.js";
import { rooms } from "../room-registry.js";
import { disposeRoom } from "../room.js";
import { reconstructRoomForRun } from "../room-machine.js";

/**
 * Simulate a server RESTART for a run: drop the live in-memory Room (timers + registry, NOT durable
 * rows, R19), then rebuild it from SQLite via the boot crash-recovery primitive. The next reconnect by
 * clientId resumes the reconstructed Room (equipped loadout from run_seat_items, shared bag from
 * run_party_bag) instead of the still-live in-memory state. (hello no longer lazily reconstructs —
 * crash recovery is boot-driven, so a test must reconstruct explicitly to model the restart.)
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

/** Start the game and return the first overworld roomState (it carries the staged party bag). */
async function startToOverworld(client: MockClient) {
  client.send({ type: "startGame" });
  return client.waitFor(
    (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState" && m.room.phase === "overworld",
    { consumeBuffered: false, timeoutMs: 4000 },
  );
}

describe("shared party bag", () => {
  it("equip pulls a bag entry onto ONE seat: roster updates for it, the entry leaves the bag for everyone", async () => {
    const host = await connectClient(server);
    const guest = await connectClient(server);
    await hello(host);
    await hello(guest);

    const { code, inv: hostInv } = await connectAndJoin(host, guest);
    void code;

    // Both start with the same default preset loadout.
    const guestBaseline = (guest.latest("inventory")!).inventory.equipped.map((i) => i.id);
    expect(hostInv.inventory.equipped.map((i) => i.id)).toEqual(guestBaseline);
    const guestInvCount = guest.inbox.filter(isInventory).length;

    // Start: both seats' preset extras stage into the shared bag.
    const over = await startToOverworld(host);
    expect(over.room.partyBag.length).toBe(2); // one potion per vanguard seat
    const entry = over.room.partyBag[0]!;

    host.mark();
    host.send({ type: "equip", bagId: entry.bagId });
    const hostAfter = await host.nextOf("inventory", { fromNow: true, timeoutMs: 4000 });
    expect(hostAfter.inventory.equipped.map((i) => i.id)).toContain(entry.item.id);

    // The roster's loadoutSummary picks up the new item for s0 only; the bag shrank for everyone.
    // (Match the POSITIVE post-state — a bare "entry gone" also matches buffered lobby states.)
    const roster = await guest.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" &&
        (m.room.seats[0]!.loadoutSummary?.equippedIds.includes(entry.item.id) ?? false),
      { timeoutMs: 4000 },
    );
    expect(roster.room.partyBag.some((e) => e.bagId === entry.bagId)).toBe(false);
    expect(roster.room.seats[0]!.loadoutSummary!.equippedIds).toContain(entry.item.id);
    expect(roster.room.seats[1]!.loadoutSummary!.equippedIds).toEqual(guestBaseline);
    expect(roster.room.partyBag.length).toBe(1);

    // The guest's own equipped loadout never changed (no new inventory push).
    expect(guest.inbox.filter(isInventory).length).toBe(guestInvCount);

    // A racing equip of the SAME entry loses loudly.
    guest.mark();
    guest.send({ type: "equip", bagId: entry.bagId });
    const err = await guest.nextOf("error", { fromNow: true, timeoutMs: 4000 });
    expect(err.code).toBe("INVALID_INPUT");

    host.close();
    guest.close();
  });

  it("equip is durable through a restart (run_party_bag + run_seat_items round-trip)", async () => {
    const owner = await connectClient(server);
    await hello(owner);
    const { code } = await createRoom(owner, 2);

    const over = await startToOverworld(owner);
    const entry = over.room.partyBag[0]!;
    owner.mark();
    owner.send({ type: "equip", bagId: entry.bagId });
    const afterEquip = await owner.nextOf("inventory", { fromNow: true, timeoutMs: 4000 });
    expect(afterEquip.inventory.equipped.map((i) => i.id)).toContain(entry.item.id);

    // Disconnect AND restart the run (drop the live Room, rebuild from SQLite — simulating a crash +
    // boot recovery) so the reconnect must rehydrate from durable rows, not in-memory state.
    owner.close();
    await owner.closed;
    await sleep(200);
    restartRoom(code);

    const owner2 = await connectClient(server, owner.clientId);
    const w2 = await hello(owner2);
    expect(w2.reconnected).toBeTruthy();
    const reInv = await owner2.waitFor(isInventory, { timeoutMs: 4000 });
    expect(reInv.inventory.equipped.map((i) => i.id)).toContain(entry.item.id);
    // The equipped item is no longer sitting in the shared bag.
    const reState = await owner2.waitFor(isRoomState, { timeoutMs: 4000 });
    expect(reState.room.partyBag.some((e) => e.bagId === entry.bagId)).toBe(false);

    owner2.close();
  });

  it("unequip deposits into the shared bag and is durable through a restart", async () => {
    const owner = await connectClient(server);
    await hello(owner);
    const { code, inv } = await createRoom(owner, 2);

    const itemId = inv.inventory.equipped[0]!.id;
    await startToOverworld(owner);

    owner.mark();
    owner.send({ type: "unequip", equippedIndex: 0 });
    const afterUnequip = await owner.nextOf("inventory", { fromNow: true, timeoutMs: 4000 });
    expect(afterUnequip.inventory.equipped.map((i) => i.id)).not.toContain(itemId);
    const withDeposit = await owner.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && m.room.partyBag.some((e) => e.item.id === itemId),
      { timeoutMs: 4000 },
    );
    expect(withDeposit.room.partyBag.some((e) => e.item.id === itemId)).toBe(true);

    owner.close();
    await owner.closed;
    await sleep(200);
    restartRoom(code);

    const owner2 = await connectClient(server, owner.clientId);
    await hello(owner2);
    const reInv = await owner2.waitFor(isInventory, { timeoutMs: 4000 });
    expect(reInv.inventory.equipped.map((i) => i.id)).not.toContain(itemId);
    const reState = await owner2.waitFor(isRoomState, { timeoutMs: 4000 });
    expect(reState.room.partyBag.some((e) => e.item.id === itemId)).toBe(true);

    owner2.close();
  });
});

/** Host creates a 2-cap room; guest joins. Returns the host's create-time state. */
async function connectAndJoin(host: MockClient, guest: MockClient) {
  const { code, inv } = await createRoom(host, 2);
  guest.send({ type: "joinRoom", code });
  await guest.nextOf("welcome");
  await guest.waitFor((m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState");
  await guest.waitFor((m): m is Extract<ServerMessage, { type: "inventory" }> => m.type === "inventory");
  return { code, inv };
}
