/**
 * Title catalog (docs/meta-loop/01-accounts.md §2.2). Shared so the client renders
 * title names — and later progress — with zero fetches. The server evaluates and
 * grants; DB `titles` rows seed from this array.
 */

export interface TitleDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly sortOrder: number;
  /** stat key from account_stats, or the pseudo-stat "level" (derived from xp). */
  readonly requirement: { readonly stat: string; readonly gte: number };
}

export const TITLES: readonly TitleDef[] = [
  { id: "greenhorn",   name: "Greenhorn",   description: "Win your first encounter.",  sortOrder: 0, requirement: { stat: "encounters_won", gte: 1 } },
  { id: "slayer",      name: "Slayer",      description: "Win 50 encounters.",         sortOrder: 1, requirement: { stat: "encounters_won", gte: 50 } },
  { id: "pathfinder",  name: "Pathfinder",  description: "Chart 25 hexes.",            sortOrder: 2, requirement: { stat: "hexes_charted", gte: 25 } },
  { id: "worldwalker", name: "Worldwalker", description: "Set foot in 3 dimensions.",  sortOrder: 3, requirement: { stat: "dimensions_discovered", gte: 3 } },
  { id: "veteran",     name: "Veteran",     description: "Reach level 5.",             sortOrder: 4, requirement: { stat: "level", gte: 5 } },
  { id: "unbroken",    name: "Unbroken",    description: "Survive 10 party wipes.",    sortOrder: 5, requirement: { stat: "wipes", gte: 10 } },
];

export function titleById(id: string): TitleDef {
  const t = TITLES.find((t) => t.id === id);
  if (!t) throw new Error(`titleById: unknown title "${id}"`);
  return t;
}

/** Pure earn check. `stats` = account_stats rows; level passed separately (derived from xp). */
export function earnedTitleIds(stats: Readonly<Record<string, number>>, level: number): string[] {
  const merged: Record<string, number> = { ...stats, level };
  return TITLES.filter((t) => (merged[t.requirement.stat] ?? 0) >= t.requirement.gte).map((t) => t.id);
}
