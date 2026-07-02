import type { GatewayInfo, DimensionOption, HexCoord } from "shared";
import { isRetreatHex, hexKey } from "shared";
import { db, getDimensionMeta } from "./db.js";
import type { Room } from "./room.js";
import type { RoomIO } from "./room-machine.js";
import type { RunEvent } from "./run-events.js";

/**
 * Gateway / tiered-multiverse domain (docs/meta-loop/04-portals.md §1.4), on the shared db handle
 * (accounts.ts precedent). `dimension_gateways` is community-permanent portal state: a gateway hex's
 * destination is fixed forever on first attunement. Assignment pulls the oldest ready pool dimension
 * (flag #11) and stamps its descent tier atomically (flag #1).
 */

// Readiness predicate (flag #3): approved AND has a background AND ≥1 enemy AND ≥1 item — bare
// status='approved' is polluted by legacy ALTER-default rows. Reused by the pool and startables.
const READY_SQL = `
  d.status = 'approved'
  AND d.background_path IS NOT NULL
  AND EXISTS (SELECT 1 FROM enemy_templates e WHERE e.dimension_id = d.id)
  AND EXISTS (SELECT 1 FROM items i WHERE i.dimension_id = d.id)`;

const gatewayAtStmt = db.prepare(
  `SELECT g.to_dimension_id, d.name, d.tier
   FROM dimension_gateways g JOIN dimensions d ON d.id = g.to_dimension_id
   WHERE g.from_dimension_id = ? AND g.q = ? AND g.r = ?`);
const gatewaysForDimStmt = db.prepare(
  `SELECT g.q, g.r, g.to_dimension_id, d.name, d.tier
   FROM dimension_gateways g JOIN dimensions d ON d.id = g.to_dimension_id
   WHERE g.from_dimension_id = ?`);
const poolCandidateStmt = db.prepare(
  `SELECT d.id FROM dimensions d
   WHERE d.tier IS NULL AND ${READY_SQL}
     AND NOT EXISTS (SELECT 1 FROM dimension_gateways g WHERE g.to_dimension_id = d.id)
   ORDER BY d.id LIMIT 1`); // flag #11: deterministic queue, oldest generated dimension first
const insertGatewayStmt = db.prepare(
  `INSERT INTO dimension_gateways
     (from_dimension_id, q, r, to_dimension_id, attuned_at, attuned_by_account_id)
   VALUES (?, ?, ?, ?, ?, ?)`);
const setTierStmt = db.prepare("UPDATE dimensions SET tier = ? WHERE id = ?");

export type AttuneResult =
  | { attuned: true; gateway: GatewayInfo; firstAttunement: boolean }
  | { attuned: false; reason: "pool-empty" | "untiered-source" };

/**
 * Idempotent gateway resolution: return the fixed destination if one exists, else attune the first
 * pool candidate (assigning it tier = fromTier + 1) atomically. Loud on both failure modes
 * (flags #4, #10); NEVER falls back — the run simply cannot descend until the pool refills.
 */
export function ensureGatewayAttuned(
  fromDimensionId: number,
  fromTier: number | null,
  hex: HexCoord,
  attunedBy: string | null,
): AttuneResult {
  const existing = gatewayAtStmt.get(fromDimensionId, hex.q, hex.r) as
    { to_dimension_id: number; name: string; tier: number } | null;
  if (existing) {
    return {
      attuned: true,
      firstAttunement: false,
      gateway: { toDimensionId: existing.to_dimension_id, toName: existing.name, toTier: existing.tier },
    };
  }
  if (fromTier === null) {
    console.error(`[gateways] cannot attune from untiered dimension ${fromDimensionId} at (${hex.q},${hex.r}) — dev-override runs are outside the multiverse graph`);
    return { attuned: false, reason: "untiered-source" };
  }
  const candidate = poolCandidateStmt.get() as { id: number } | null;
  if (!candidate) {
    console.error(`[gateways] attunement pool EMPTY: gateway at (${hex.q},${hex.r}) in dimension ${fromDimensionId} (tier ${fromTier}) stays unattuned — approve more generated dimensions`);
    return { attuned: false, reason: "pool-empty" };
  }
  const toTier = fromTier + 1;
  const tx = db.transaction(() => {
    setTierStmt.run(toTier, candidate.id);
    insertGatewayStmt.run(fromDimensionId, hex.q, hex.r, candidate.id, Date.now(), attunedBy);
  });
  tx();
  const meta = getDimensionMeta(candidate.id)!;
  console.log(`[gateways] attuned (${hex.q},${hex.r}) in dim ${fromDimensionId} -> dim ${candidate.id} "${meta.name}" (tier ${toTier})`);
  return {
    attuned: true,
    firstAttunement: true,
    gateway: { toDimensionId: candidate.id, toName: meta.name, toTier },
  };
}

/** Community gateway knowledge for a dimension, keyed by hexKey — feeds Room.gateways. */
export function loadGatewaysForDimension(dimensionId: number): Record<string, GatewayInfo> {
  const rows = gatewaysForDimStmt.all(dimensionId) as
    { q: number; r: number; to_dimension_id: number; name: string; tier: number }[];
  const map: Record<string, GatewayInfo> = {};
  for (const row of rows) {
    map[hexKey({ q: row.q, r: row.r })] = {
      toDimensionId: row.to_dimension_id,
      toName: row.name,
      toTier: row.tier,
    };
  }
  return map;
}

/**
 * Run-start options (flag #5): READY tiered dims that are tier 0 OR charted by any of the given
 * accounts. Sorted (tier, id). accountIds ≤ 4 — build the IN(...) per call. With no accounts, only
 * the always-available tier-0 surface qualifies.
 */
export function startableDimensions(accountIds: readonly string[]): DimensionOption[] {
  const chartedClause =
    accountIds.length > 0
      ? `OR EXISTS (SELECT 1 FROM account_dimensions ad WHERE ad.dimension_id = d.id
             AND ad.account_id IN (${accountIds.map(() => "?").join(", ")}))`
      : "";
  const sql = `SELECT d.id, d.name, d.tier FROM dimensions d
    WHERE d.tier IS NOT NULL AND ${READY_SQL}
      AND (d.tier = 0 ${chartedClause})
    ORDER BY d.tier, d.id`;
  const rows = db.prepare(sql).all(...accountIds) as { id: number; name: string; tier: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, tier: r.tier }));
}

export function isStartableDimension(dimensionId: number, accountIds: readonly string[]): boolean {
  return startableDimensions(accountIds).some((d) => d.id === dimensionId);
}

function hostAccountId(room: Room): string | null {
  if (!room.hostSeatId) return null;
  const seat = room.seats.find((s) => s.seatId === room.hostSeatId);
  return seat?.accountId ?? null;
}

/**
 * encounter-won subscriber: first clear of a gateway hex fixes its destination for everyone. Pure
 * recorder — persists + pushes; never touches phase/vote/session (02 §4.1 discipline). Runs during
 * the emit, BEFORE endCombat's broadcastHexMapState, so the win's map broadcast already carries the
 * new gateway; the gatewayUpdate broadcast drives the toast + the unattuned (pool-empty) case.
 */
export function gatewayAttunementRecorder(
  room: Room,
  io: RoomIO,
  ev: Extract<RunEvent, { type: "encounter-won" }>,
): void {
  if (ev.icon === null || !isRetreatHex(ev.icon)) return; // gateway | gateway-city only
  const key = hexKey(ev.hex);
  if (room.gateways[key]) return; // already community-attuned
  const result = ensureGatewayAttuned(room.dimensionId, room.dimensionTier, ev.hex, hostAccountId(room));
  if (result.attuned) {
    room.gateways = { ...room.gateways, [key]: result.gateway };
    io.broadcast(room, { type: "gatewayUpdate", hex: ev.hex, gateway: result.gateway });
  } else {
    io.broadcast(room, { type: "gatewayUpdate", hex: ev.hex, gateway: null }); // flag #4: loud, visible
  }
}
