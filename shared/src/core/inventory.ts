import type { AnimSet, ItemDefinition, SlotType, SlotCost } from "./items.js";

export const BAG_SIZE = 12;

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

export interface InventoryState {
  readonly bag: readonly (ItemDefinition | null)[];
  readonly equipped: readonly ItemDefinition[];
  readonly attachments: Record<string, AttachmentData>;
}

export function createInventory(startingItems: ItemDefinition[]): InventoryState {
  const bag: (ItemDefinition | null)[] = new Array(BAG_SIZE).fill(null);
  for (let i = 0; i < startingItems.length && i < BAG_SIZE; i++) {
    bag[i] = startingItems[i]!;
  }
  return { bag, equipped: [], attachments: {} };
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

export function equipFromBag(inv: InventoryState, bagIndex: number): InventoryState {
  const item = inv.bag[bagIndex];
  if (!item) return inv;
  if (!canEquip(inv.equipped, item)) return inv;

  const newBag = [...inv.bag];
  newBag[bagIndex] = null;
  return { bag: newBag, equipped: [...inv.equipped, item], attachments: { ...inv.attachments } };
}

export function unequipItem(inv: InventoryState, equippedIndex: number): InventoryState {
  if (equippedIndex < 0 || equippedIndex >= inv.equipped.length) return inv;

  const emptySlot = inv.bag.indexOf(null);
  if (emptySlot === -1) return inv;

  const removedItem = inv.equipped[equippedIndex]!;
  const newBag = [...inv.bag];
  newBag[emptySlot] = removedItem;
  const newEquipped = inv.equipped.filter((_, i) => i !== equippedIndex);
  const newAttachments = { ...inv.attachments };
  delete newAttachments[removedItem.id];
  return { bag: newBag, equipped: newEquipped, attachments: newAttachments };
}

export function getEquippedWeapon(inv: InventoryState): ItemDefinition | null {
  return inv.equipped.find((item) => item.type === "weapon") ?? null;
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
