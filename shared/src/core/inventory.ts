import type { AnimSet, ItemDefinition, SlotType, SlotCost } from "./items.js";

/** The shared party bag holds 16 slots per started seat (hard cap on player deposits;
 *  loot drops always land even at the cap so loot is never lost). */
export const PARTY_BAG_SLOTS_PER_PLAYER = 16;

export function partyBagCapacity(seatCount: number): number {
  return PARTY_BAG_SLOTS_PER_PLAYER * seatCount;
}

export const PLAYER_SLOTS: Record<SlotType, number> = {
  hand: 2,
  hat: 1,
  utility: 3,
  accessory: 3,
};

export interface AttachmentData {
  readonly boneName: string;
  readonly attachEnd: "from" | "to";
  readonly localOffsetAlong: number;
  readonly localOffsetPerp: number;
  readonly scale: number;
  readonly rotation: number;
  readonly referenceFrame: string;
}

/** A seat's personal loadout: what the hero WEARS. Unequipped items live in the shared
 *  party bag (RoomStatePayload.partyBag), not here. */
export interface InventoryState {
  readonly equipped: readonly ItemDefinition[];
  readonly attachments: Record<string, AttachmentData>;
}

function usedSlots(equipped: readonly ItemDefinition[]): Record<SlotType, number> {
  const used: Record<SlotType, number> = { hand: 0, hat: 0, utility: 0, accessory: 0 };
  for (const item of equipped) {
    for (const [slot, count] of Object.entries(item.slotCost) as [SlotType, number][]) {
      used[slot] += count;
    }
  }
  return used;
}

export function canEquip(equipped: readonly ItemDefinition[], item: ItemDefinition): boolean {
  const used = usedSlots(equipped);
  for (const [slot, count] of Object.entries(item.slotCost) as [SlotType, number][]) {
    if (used[slot] + count > PLAYER_SLOTS[slot]) return false;
  }
  return true;
}

export function equipItem(inv: InventoryState, item: ItemDefinition): InventoryState {
  return { equipped: [...inv.equipped, item], attachments: { ...inv.attachments } };
}

export function unequipItem(inv: InventoryState, equippedIndex: number): InventoryState {
  const removedItem = inv.equipped[equippedIndex]!;
  const newEquipped = inv.equipped.filter((_, i) => i !== equippedIndex);
  const newAttachments = { ...inv.attachments };
  delete newAttachments[removedItem.id];
  return { equipped: newEquipped, attachments: newAttachments };
}

export function getEquippedWeapon(inv: InventoryState): ItemDefinition | null {
  return inv.equipped.find((item) => item.type === "weapon") ?? null;
}

export function getItemAbilities(equipped: readonly ItemDefinition[]): import("./types.js").AbilityDefinition[] {
  const abilities: import("./types.js").AbilityDefinition[] = [];
  for (const item of equipped) {
    if ("abilities" in item && item.abilities) {
      abilities.push(...item.abilities);
    }
  }
  return abilities;
}

export function getAnimSet(equipped: readonly ItemDefinition[]): AnimSet {
  const handItems = equipped.filter(
    (item) => item.slotCost.hand && item.slotCost.hand > 0,
  );
  const weapons = handItems.filter((item) => item.type === "weapon");

  if (weapons.length >= 2) return "dual-wield";

  if (weapons.length === 1) {
    const w = weapons[0]!;
    if (w.type === "weapon") {
      const hasOffhand = handItems.length > 1;
      if (hasOffhand) return w.animSet;
      return w.animSet;
    }
  }

  if (handItems.length >= 2) return "dual-wield";

  return "sword";
}
