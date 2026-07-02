import type { ContractType } from "shared";
import { applyContractEvent, buildContractOffers, createContractState } from "shared";
import type { Room } from "./room.js";
import type { RoomIO } from "./room-machine.js";
import type { RunEvent } from "./run-events.js";
import { saveRunContract } from "./db.js";
import { AccountError } from "./accounts.js";

/**
 * Contract evaluation + assignment (docs/meta-loop/02-contracts.md §4.3). Progress is a pure
 * shared step (applyContractEvent); this module owns the room/DB glue only.
 */

/** encounter-won subscriber #2: advance + persist contract progress. Pure recorder — the
 *  machine (endCombat) reads room.contract.completed after the emit and owns the transition. */
export function contractProgressRecorder(
  room: Room,
  _io: RoomIO,
  ev: Extract<RunEvent, { type: "encounter-won" }>,
): void {
  if (!room.contract || room.contract.completed) return;
  const next = applyContractEvent(room.contract, {
    hex: ev.hex,
    dimensionId: room.dimensionId,
    icon: ev.icon,
    clearedCount: ev.clearedCount,
  });
  if (next === room.contract) return;
  room.contract = next;
  saveRunContract(ev.runId, next); // synchronous, tiny — same discipline as commitExplore adjacency
}

/** Assign + persist a contract on a run (chooseContract, startGame default, resetToOrigin).
 *  Validates against the same deterministic offer scan the lobby board was built from (flag #12). */
export function assignContract(room: Room, type: ContractType): void {
  const offers = buildContractOffers(room.hexMap.icons);
  const offer = offers.find((o) => o.type === type);
  if (!offer) throw new AccountError("INVALID_INPUT", "That contract is not available here");
  room.contract = createContractState(
    offer.type,
    offer.targetHex,
    offer.targetHex ? room.dimensionId : null,
  );
  saveRunContract(room.runId, room.contract);
}
