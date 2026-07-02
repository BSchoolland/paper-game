/**
 * Every asset/API URL the client builds, in one place. `assetUrl` -> root-absolute path on the
 * web origin (web/public); `apiUrl` -> the game server (REST: dimension meta, generated sprites);
 * `mapAssetUrl` -> the CDN that hosts encounter map art too large for git.
 */
// Dev: the game server runs on :3001, a separate origin from Vite. Prod: the server is the single
// origin (it also serves the built app), so API + WS are same-origin and pass through the TLS proxy.
const API_ORIGIN = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : window.location.origin;
const MAP_ASSET_BASE = "https://dejfnulqljp79.cloudfront.net";

export function assetUrl(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function apiUrl(path: string): string {
  return API_ORIGIN + assetUrl(path);
}

export function mapAssetUrl(path: string): string {
  return `${MAP_ASSET_BASE}/${path.replace(/^\//, "")}`;
}

export function wsUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const host = import.meta.env.DEV ? `${window.location.hostname}:3001` : window.location.host;
  return `${scheme}://${host}/ws`;
}

/** Root-absolute URL for an item's sprite image (dimension-0 items live at the root). */
export function itemSpriteUrl(item: { sprite: string; dimensionId: number }, ext: "webp" | "png" = "webp"): string {
  const prefix = item.dimensionId === 0 ? "" : `dimension-${item.dimensionId}/`;
  return assetUrl(`sprites/items/${prefix}${item.sprite}.${ext}`);
}
