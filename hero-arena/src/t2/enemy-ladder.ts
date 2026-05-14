export interface LadderTier {
  level: number;
  label: string;
  composition: Array<{ key: string; count: number; dim: 0 | 1 | 2 | 3 }>;
  maxTurns: number;
}

export const LADDER: readonly LadderTier[] = [
  // Tiers 1-4: very easy — small groups a solo hero can handle
  { level: 1,  label: "A Few Slimes",
    maxTurns: 40,
    composition: [{ key: "slime", count: 3, dim: 0 }] },

  { level: 2,  label: "Goblin Patrol",
    maxTurns: 50,
    composition: [{ key: "goblin-spear", count: 2, dim: 0 }, { key: "slime", count: 2, dim: 0 }] },

  { level: 3,  label: "Crab Beach",
    maxTurns: 60,
    composition: [{ key: "mud-crab", count: 3, dim: 1 }, { key: "dart-fish", count: 2, dim: 1 }] },

  { level: 4,  label: "Goblin Squad",
    maxTurns: 60,
    composition: [{ key: "goblin-spear", count: 2, dim: 0 }, { key: "goblin-archer", count: 1, dim: 0 }, { key: "goblin-shield", count: 1, dim: 0 }] },

  // Tiers 5-8: moderate — solo hero ceiling, squad warmup
  { level: 5,  label: "Slime Swarm",
    maxTurns: 70,
    composition: [{ key: "slime", count: 6, dim: 0 }, { key: "big-slime", count: 1, dim: 0 }] },

  { level: 6,  label: "Goblin Warband",
    maxTurns: 80,
    composition: [{ key: "goblin-spear", count: 2, dim: 0 }, { key: "goblin-archer", count: 2, dim: 0 }, { key: "goblin-shield", count: 2, dim: 0 }] },

  { level: 7,  label: "Crystal Crawlers",
    maxTurns: 80,
    composition: [{ key: "crystal-scarab", count: 2, dim: 2 }, { key: "cave-mite", count: 4, dim: 2 }] },

  { level: 8,  label: "Desert Skirmish",
    maxTurns: 90,
    composition: [{ key: "sand-skitter", count: 3, dim: 3 }, { key: "dune-jackal", count: 2, dim: 3 }, { key: "carrion-vulture", count: 2, dim: 3 }] },

  // Tiers 9-12: hard — first elites appear
  { level: 9,  label: "Goblin War Party",
    maxTurns: 100,
    composition: [{ key: "goblin-spear", count: 2, dim: 0 }, { key: "goblin-archer", count: 2, dim: 0 }, { key: "goblin-brute", count: 1, dim: 0 }] },

  { level: 10, label: "Tidal Assault",
    maxTurns: 100,
    composition: [{ key: "snapping-crab", count: 2, dim: 1 }, { key: "tidal-lurker", count: 2, dim: 1 }, { key: "dart-fish", count: 3, dim: 1 }] },

  { level: 11, label: "Elite Vanguard",
    maxTurns: 110,
    composition: [{ key: "goblin-brute", count: 2, dim: 0 }, { key: "big-slime", count: 2, dim: 0 }, { key: "goblin-shield", count: 2, dim: 0 }] },

  { level: 12, label: "Crystal Elites",
    maxTurns: 110,
    composition: [{ key: "shard-serpent", count: 2, dim: 2 }, { key: "crystal-weaver", count: 1, dim: 2 }, { key: "geode-crab", count: 2, dim: 2 }] },

  // Tiers 13-16: very hard — bosses enter
  { level: 13, label: "Stone Golem + Guard",
    maxTurns: 120,
    composition: [{ key: "stone-golem", count: 1, dim: 0 }, { key: "goblin-brute", count: 1, dim: 0 }, { key: "goblin-archer", count: 2, dim: 0 }] },

  { level: 14, label: "Sandsworn Warband",
    maxTurns: 120,
    composition: [{ key: "sandsworn-raider", count: 3, dim: 3 }, { key: "dune-reaver", count: 2, dim: 3 }] },

  { level: 15, label: "The Gemwarden",
    maxTurns: 130,
    composition: [{ key: "the-gemwarden", count: 1, dim: 2 }, { key: "crystal-weaver", count: 2, dim: 2 }, { key: "shard-serpent", count: 1, dim: 2 }] },

  { level: 16, label: "Iron Claw + Elites",
    maxTurns: 130,
    composition: [{ key: "iron-claw", count: 1, dim: 1 }, { key: "mantis-shrimp", count: 2, dim: 1 }, { key: "snapping-crab", count: 2, dim: 1 }] },

  // Tiers 17-20: extreme — multi-boss gauntlet
  { level: 17, label: "Massive Slime Pit",
    maxTurns: 140,
    composition: [{ key: "massive-slime", count: 1, dim: 0 }, { key: "big-slime", count: 2, dim: 0 }, { key: "goblin-brute", count: 2, dim: 0 }] },

  { level: 18, label: "Twin Bosses",
    maxTurns: 150,
    composition: [{ key: "stone-golem", count: 1, dim: 0 }, { key: "the-gemwarden", count: 1, dim: 2 }, { key: "goblin-brute", count: 2, dim: 0 }] },

  { level: 19, label: "Wyrm + Mycelium",
    maxTurns: 160,
    composition: [{ key: "sunscorch-wyrm", count: 1, dim: 3 }, { key: "the-mycelium", count: 1, dim: 2 }, { key: "sandsworn-raider", count: 2, dim: 3 }] },

  { level: 20, label: "Pharaoh's Court",
    maxTurns: 160,
    composition: [{ key: "pharaoh-of-the-sands", count: 1, dim: 3 }, { key: "the-false-oasis", count: 1, dim: 3 }, { key: "caravan-king", count: 1, dim: 3 }] },
];
