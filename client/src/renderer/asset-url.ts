// Single place every client-side asset/API URL is built, so paths are
// normalized one way instead of six. `assetUrl` -> root-absolute path served
// from the web origin; `apiUrl` -> same, but on the game API server (which
// hosts dynamically generated content like dimension sprites).
const API_ORIGIN = `http://${window.location.hostname}:3001`;

// Encounter map art is too large to keep in git, so it's served from a CDN
// (CloudFront over a private S3 bucket) instead of the web origin. Masks stay
// local — only the big PNGs live here. Repoint this one constant when migrating
// the bucket (e.g. to Cloudflare R2).
const MAP_ASSET_BASE = "https://dejfnulqljp79.cloudfront.net";

export function assetUrl(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/** CDN URL for an encounter map image, given its public-relative key. */
export function mapAssetUrl(path: string): string {
  return `${MAP_ASSET_BASE}/${path.replace(/^\//, "")}`;
}

export function apiUrl(path: string): string {
  return API_ORIGIN + assetUrl(path);
}
