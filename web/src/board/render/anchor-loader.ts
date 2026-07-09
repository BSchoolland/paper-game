import type { CharacterAnchors, AnchorSet } from "shared";

const cache = new Map<string, CharacterAnchors>();

export async function loadCharacterAnchors(
  character: string,
): Promise<CharacterAnchors | null> {
  if (cache.has(character)) return cache.get(character)!;

  try {
    const res = await fetch(`sprites/${character}/anchors.json`);
    if (!res.ok) return null;
    const data: CharacterAnchors = await res.json();
    cache.set(character, data);
    return data;
  } catch {
    return null;
  }
}

export function getFrameAnchors(
  data: CharacterAnchors,
  frameKey: string,
): Partial<AnchorSet> | null {
  return data.frames[frameKey]?.anchors ?? null;
}
