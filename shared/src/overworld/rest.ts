import type { HexIconType } from "../map/hex-map.js";

/** Locked #11: towns and cities (gateway-city is a city) become safe rest nodes once cleared
 *  this run. Plain gateways are portals, not settlements — excluded. */
export const REST_NODE_ICONS: readonly HexIconType[] = ["town", "city", "gateway-city"];

export function isRestNodeIcon(icon: HexIconType | null): boolean {
  return icon !== null && REST_NODE_ICONS.includes(icon);
}

/** Rested (flag #2): every hero starts the party's NEXT combat with this much barrier. */
export const REST_BARRIER_HP = 30;   // vs player hp 120 — one big enemy hit absorbed
