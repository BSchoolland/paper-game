import { apiUrl } from "../lib/urls.js";

/** What GET /api/dimensions/:id returns (the slice the lobby/home surfaces use). */
export interface DimensionMeta {
  id: number;
  name: string;
  spritePaths: string[];
  structureSprites: Record<string, string>;
  /** sprite name -> root-relative path with the correct extension resolved server-side. */
  itemSprites: Record<string, string>;
  /** Web-origin path (assetUrl); spritePaths are API paths (apiUrl). */
  backgroundPath: string | null;
  hexDecorationsPath: string | null;
  /** Not yet served by /api/dimensions — fixtures set them; surfaces render without when absent. */
  tier?: number;
  thumbPath?: string;
}

interface DimMetaStore {
  byId: Record<number, DimensionMeta>;
}

export const dimMeta = $state<DimMetaStore>({ byId: {} });

const inflight = new Map<number, Promise<void>>();

/** Fetch-and-cache a dimension's meta; safe to call repeatedly from render paths. */
export function ensureDimensionMeta(id: number): void {
  if (dimMeta.byId[id] || inflight.has(id)) return;
  const p = fetch(apiUrl(`/api/dimensions/${id}`))
    .then(async (res) => {
      if (!res.ok) throw new Error(`dimension meta ${id}: HTTP ${res.status}`);
      dimMeta.byId[id] = (await res.json()) as DimensionMeta;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  p.catch((err: unknown) => console.error(err));
}

export function resetDimMeta(): void {
  dimMeta.byId = {};
}
