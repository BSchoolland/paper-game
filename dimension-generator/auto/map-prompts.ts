/**
 * Map generation prompts — one per encounter map, keyed by encounter type.
 *
 * Style/palette comes entirely from the reference image passed to images.edit,
 * so these prompts only describe *layout and balance*. They are dimension-
 * agnostic and global: the same 24 prompts are reused for every dimension, only
 * the reference image swaps. Density is always described relative to the
 * reference (a high-wall-density map that favors close combat).
 *
 * Each prompt is self-contained — with 24 parallel single requests, no request
 * sees any other, so variety must live in concrete descriptions, never in
 * cross-references like "same as A but...".
 */
import type { EncounterType } from "../../shared/src/encounter/encounter-profiles.js";

export const MAP_PREAMBLE =
  "This is a map for my game, in the same art style and world as the reference image. " +
  "In terms of balance, the reference is an example of a high wall density map that favors close combat — use its density as the yardstick. " +
  "Do not include any characters like the player or enemies. " +
  "Keep the walkable ground light and parchment-colored and keep the minimal look of the reference — don't overwhelm with detail. " +
  "There must be a wide walkable path to most parts of the map that isn't blocked by structures or objects, or it will be unplayable. " +
  "Generate the following map:";

// Shared sub-descriptions (DRY) — inlined into the final prompt, kept in one place.
const TOWN_BASE =
  "A town that fits this world, less dense than the reference. It's inhabited — make it look like people live here decently — but draw no villager sprites.";
const CITY_BASE =
  "A city that fits this world, similar density to the reference but with clearly walkable streets throughout. It's inhabited but draw no villager sprites.";

export interface MapPrompt {
  readonly encounterType: EncounterType;
  readonly variant: number;
  readonly spec: string;
}

export const MAP_PROMPTS: readonly MapPrompt[] = [
  // wilderness ×4 — the most common combat tile, most layout variety
  { encounterType: "wilderness", variant: 0, spec: "Open spaces: far fewer obstacles than the reference — mostly open ground with just a few objects scattered around." },
  { encounterType: "wilderness", variant: 1, spec: "Fewer obstacles than the reference, spread evenly across the map. No dead ends." },
  { encounterType: "wilderness", variant: 2, spec: "Fewer obstacles than the reference, arranged in loose clusters with wide open lanes weaving between them." },
  { encounterType: "wilderness", variant: 3, spec: "A natural divider — a shallow creek bed or low ridge winding across the map with light scattered cover on either side and clear crossings. Fewer obstacles than the reference." },

  // dense-wilderness ×3 (a 4th, the dimension's own reference, is added at generation time)
  { encounterType: "dense-wilderness", variant: 0, spec: "Heavily overgrown with vegetation at similar density to the reference, but with clear walkable lanes weaving through." },
  { encounterType: "dense-wilderness", variant: 1, spec: "A dense overgrown maze at similar density to the reference, with tight winding lanes and several dead ends." },
  { encounterType: "dense-wilderness", variant: 2, spec: "Similar density to the reference, with obstacles gathered into a few thick clumps separated by wide open gaps." },

  // enemy-camp ×2
  { encounterType: "enemy-camp", variant: 0, spec: "An enemy camp: a loose cluster of tents, crates and a campfire near the center with scattered cover around it. Medium density, plenty of open ground." },
  { encounterType: "enemy-camp", variant: 1, spec: "An enemy camp with a few makeshift barricades and stake walls forming partial enclosures among the tents. Medium density, clearly walkable." },

  // ruins ×2
  { encounterType: "ruins", variant: 0, spec: "Crumbling ruined walls and broken pillars scattered across open ground. Medium density, lots of partial cover, easy to walk between." },
  { encounterType: "ruins", variant: 1, spec: "The broken footprint of an old structure — many wall fragments forming rough rooms and lanes, similar density to the reference, with clear paths through." },

  // town ×2 (share TOWN_BASE)
  { encounterType: "town", variant: 0, spec: `${TOWN_BASE} 5-6 buildings with wide dirt roads between them.` },
  { encounterType: "town", variant: 1, spec: `${TOWN_BASE} 5-6 buildings arranged around a central square, with wide streets radiating out.` },

  // city ×2 (share CITY_BASE)
  { encounterType: "city", variant: 0, spec: `${CITY_BASE} 8-12 buildings with streets and small plazas between them.` },
  { encounterType: "city", variant: 1, spec: `${CITY_BASE} 8-12 buildings along one main avenue with side streets branching off.` },

  // treasure ×2
  { encounterType: "treasure", variant: 0, spec: "A mostly open clearing with a single eye-catching feature at its heart — a treasure cache or chest on a small dais — ringed by a little scattered cover." },
  { encounterType: "treasure", variant: 1, spec: "Something creative — a natural landmark or oddity that adds life to this world (a spring, a strange formation, a hidden shrine) with a reward at its center. Mostly open and walkable." },

  // great-treasure ×1
  { encounterType: "great-treasure", variant: 0, spec: "A grand treasure site — a ruined vault or monument at the center holding the prize, framed by a ring of pillars or rubble, with open walkable approaches from several sides." },

  // great-ruins ×1
  { encounterType: "great-ruins", variant: 0, spec: "A large ruined complex — the broad footprint of a fallen structure with many standing wall segments, courtyards and lanes. Dense in places but with clear through-routes." },

  // gateway ×1 — interdimensional portal
  { encounterType: "gateway", variant: 0, spec: "A site built around a glowing interdimensional portal as its central feature, with a few outbuildings or standing stones around it. Medium density, a wide walkable approach to the portal." },

  // gateway-city ×1 — interdimensional portal
  { encounterType: "gateway-city", variant: 0, spec: "A walled city built around a great interdimensional portal — city buildings and defensive walls surrounding the glowing portal, streets leading toward it. Similar density to the reference, walkable streets throughout." },

  // boss ×1
  { encounterType: "boss", variant: 0, spec: "A boss-fight arena — a large, mostly open space with a clear arena shape and just a few objects or pillars in the middle for cover. Open walkable ground all around." },

  // calamity ×1
  { encounterType: "calamity", variant: 0, spec: "A dramatic open battlefield ringed by broken pillars or standing stones, with a few obstacles clustered at the center. Mostly open and walkable." },

  // elite-encounter ×1
  { encounterType: "elite-encounter", variant: 0, spec: "A more enclosed arena — cover objects arranged close around the center with open ground at the edges. Fully walkable." },
];

export function fullPrompt(p: MapPrompt): string {
  return `${MAP_PREAMBLE}\n\n${p.spec}`;
}
