// Single place every client-side asset/API URL is built, so paths are
// normalized one way instead of six. `assetUrl` -> root-absolute path served
// from the web origin; `apiUrl` -> same, but on the game API server (which
// hosts dynamically generated content like dimension sprites).
const API_ORIGIN = `http://${window.location.hostname}:3001`;

export function assetUrl(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function apiUrl(path: string): string {
  return API_ORIGIN + assetUrl(path);
}
