import type { ServerWebSocket } from "bun";
import type { CodexEntryPayload, ItemDefinition } from "shared";
import type { Room, Seat, SocketData } from "./room.js";
import type { RoomIO } from "./room-machine.js";
import type { RunEvent } from "./run-events.js";
import type { CodexEntryRow, RunLootRow } from "./db.js";
import {
  loadRunLoot,
  loadCodex,
  loadCodexEntry,
  loadCodexFirst,
  bankCodexEntry,
  recordCodexFirst,
  getDimensionMeta,
} from "./db.js";
import { bumpStat, evaluateTitles, loadCardProfile, loadProfilePayload } from "./accounts.js";
import { eligibleSeats } from "./run-recorders.js";
import { sendTo } from "./wire-transport.js";

/**
 * Codex banking + fetch (docs/meta-loop/03-loot-codex.md §4.4-4.5). The banking recorder subscribes
 * to `run-ended` AFTER recordRunSettled and mints permanent per-account design entries + global
 * first-recovery provenance for the run's found designs on victory/retreat only. All writes are
 * synchronous SQLite; per-seat pushes go PRIVATE via io.send.
 */

/** Payload builder shared by getCodex and the banking pushes. */
export function codexEntryPayload(row: CodexEntryRow, requesterId: string): CodexEntryPayload {
  const first = loadCodexFirst(row.item_id);
  if (!first) throw new Error(`codex: missing codex_firsts row for ${row.item_id}`); // bank writes both
  const meta = getDimensionMeta(row.dimension_id);
  if (!meta) throw new Error(`codex: dimension ${row.dimension_id} missing`);
  return {
    item: JSON.parse(row.item_json) as ItemDefinition,
    dimensionId: row.dimension_id,
    dimensionName: meta.name,
    tier: row.tier,
    acquiredAt: row.acquired_at,
    first: {
      accountId: first.account_id,
      displayName: loadCardProfile(first.account_id).displayName,
      at: first.recovered_at,
      mine: first.account_id === requesterId,
    },
  };
}

function refreshCardProfile(seat: Seat, accountId: string): void {
  const card = loadCardProfile(accountId);
  seat.cardProfile = { level: card.level, equippedTitleId: card.equippedTitleId };
}

export function codexBankingRecorder(room: Room, io: RoomIO,
    ev: Extract<RunEvent, { type: "run-ended" }>): void {
  if (ev.outcome !== "victory" && ev.outcome !== "retreat") return; // locked #6/#7

  // Designs found this run (flag #1): dedup the drop ledger by item id, keep the first row per
  // design. The party bag is storage, not finds — only run_loot rows bank.
  const byDesign = new Map<string, RunLootRow>();
  for (const row of loadRunLoot(ev.runId)) {
    if (!byDesign.has(row.item_id)) byDesign.set(row.item_id, row);
  }
  if (byDesign.size === 0) return;

  const bankSeats = eligibleSeats(room); // 02's attribution gate
  if (bankSeats.length === 0) return;
  const bankAccounts = bankSeats.map((s) => s.accountId!);
  const hostAccount = room.hostSeatId
    ? room.seats.find((s) => s.seatId === room.hostSeatId)?.accountId ?? null : null;

  let skippedUntiered = 0;
  const skippedDims = new Set<number>();
  const newEntries = new Map<string, CodexEntryPayload[]>(); // accountId -> pushes
  const firstCredits = new Map<string, string[]>(); // accountId -> itemIds

  for (const row of byDesign.values()) {
    const meta = getDimensionMeta(row.dimension_id); // 04 §1.3
    if (!meta) throw new Error(`codex: dimension ${row.dimension_id} missing for design ${row.item_id}`);
    if (meta.tier === null) { skippedUntiered++; skippedDims.add(row.dimension_id); continue; } // flag #5
    const item = JSON.parse(row.item_json) as ItemDefinition;

    // Global first (flag #6): the host if banking, else the first banker (drops are party-shared
    // in the bag, so there is no per-seat claimant to credit).
    const discoverer =
      (hostAccount && bankAccounts.includes(hostAccount)) ? hostAccount : bankAccounts[0]!;
    const isFirst = recordCodexFirst(item, discoverer);
    if (isFirst) {
      bumpStat(discoverer, "firsts_recovered", 1);
      (firstCredits.get(discoverer) ?? firstCredits.set(discoverer, []).get(discoverer)!).push(item.id);
    }

    for (const accountId of bankAccounts) {
      if (!bankCodexEntry(accountId, item, meta.tier)) continue; // dedup: already known
      bumpStat(accountId, "designs_recovered", 1);
      (newEntries.get(accountId) ?? newEntries.set(accountId, []).get(accountId)!)
        .push(codexEntryPayload(loadCodexEntry(accountId, item.id)!, accountId)); // §4.5 builder
    }
  }
  if (skippedUntiered > 0) {
    console.error(`[codex] skipped ${skippedUntiered} design(s) from untiered dimension(s) ` +
      `[${[...skippedDims].join(", ")}] — dev-override runs bank nothing from unplaced dims`);
  }

  for (const seat of bankSeats) {
    const accountId = seat.accountId!;
    io.send(seat, {
      type: "codexBanked",
      entries: newEntries.get(accountId) ?? [],
      firstItemIds: firstCredits.get(accountId) ?? [],
      skippedUntiered,
    });
    const newTitles = evaluateTitles(accountId); // archivist/trailblazer
    refreshCardProfile(seat, accountId);
    if (newTitles.length > 0) io.send(seat, { type: "titlesEarned", titleIds: newTitles });
    io.send(seat, { type: "profile", profile: loadProfilePayload(accountId) });
  }
}

export function handleGetCodex(ws: ServerWebSocket<SocketData>): void {
  const accountId = ws.data.accountId;
  if (!accountId) return sendTo(ws, { type: "error", code: "BAD_PHASE", message: "Say hello first", recoverable: true });
  const entries = loadCodex(accountId).map((r) => codexEntryPayload(r, accountId));
  sendTo(ws, { type: "codex", entries });
}
