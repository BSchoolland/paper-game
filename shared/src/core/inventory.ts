import type { ItemDefinition, WeaponItem } from "./items.js";

export const INVENTORY_SIZE = 12;

export interface InventoryState {
  readonly slots: readonly (ItemDefinition | null)[];
  readonly equippedWeapon: WeaponItem | null;
}

export function createInventory(startingItems: ItemDefinition[]): InventoryState {
  const slots: (ItemDefinition | null)[] = new Array(INVENTORY_SIZE).fill(null);
  for (let i = 0; i < startingItems.length && i < INVENTORY_SIZE; i++) {
    slots[i] = startingItems[i]!;
  }
  return { slots, equippedWeapon: null };
}

export function equipFromSlot(inv: InventoryState, slotIndex: number): InventoryState {
  const item = inv.slots[slotIndex];
  if (!item || item.type !== "weapon") return inv;

  const newSlots = [...inv.slots];

  if (inv.equippedWeapon) {
    newSlots[slotIndex] = inv.equippedWeapon;
  } else {
    newSlots[slotIndex] = null;
  }

  return { slots: newSlots, equippedWeapon: item };
}

export function unequipWeapon(inv: InventoryState): InventoryState {
  if (!inv.equippedWeapon) return inv;

  const emptySlot = inv.slots.indexOf(null);
  if (emptySlot === -1) return inv;

  const newSlots = [...inv.slots];
  newSlots[emptySlot] = inv.equippedWeapon;
  return { slots: newSlots, equippedWeapon: null };
}
