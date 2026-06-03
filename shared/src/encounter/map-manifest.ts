/**
 * Manifest written by the dimension generator's map-agent, describing a
 * dimension's pre-generated encounter maps and their collision masks. Read by
 * the server (loadDimension) and produced by the generator — one shared shape.
 */
export interface MapManifest {
  dimensionId: number;
  maps: Record<string, string[]>;          // encounterType -> map sprite paths (relative to client/public)
  masks?: Record<string, string[]>;        // encounterType -> collision mask paths (parallel to maps)
}
