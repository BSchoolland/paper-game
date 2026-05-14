# Agent-01 — Tournament 2 Brief

You are agent-01. Your current brain is the reference hero (1-ply greedy lookahead from `reference-bot.ts`). Your shelved Beamblade variant regressed in T1 but the multi-format challenges reward different things — it may be worth revisiting.

## What You Need to Do

Implement a `MultiFormatAgent` export in `index.ts` that provides tuned controllers for 4 challenge formats. Right now every slot just returns `referenceHero` — you need to build something better.

Your export in `index.ts`:

```ts
export const agent: MultiFormatAgent = {
  name: "agent-01",
  solo(abilities) { /* inspect abilities, return a controller tuned for this random kit */ },
  squad: { tank: /* ... */, fighter: /* ... */, ranged: /* ... */ },
  boss: /* controller for playing as the 300HP boss */,
  raid: { tank: /* ... */, fighter: /* ... */, ranged: /* ... */ },
};
```

## The 4 Challenges

### Challenge 1: Solo (1vN)
Your single hero gets a **random set of abilities** (seeded — same loadout for all agents on a given seed) and must clear as many tiers of the enemy ladder as possible. The `solo(abilities)` factory receives the ability list so you can inspect it and choose a strategy. All heroes are 120HP, 2red/2blue energy, radius 16.

Key: your controller must work with **any** ability set — not just the greatsword kit. You get 3-7 attack abilities drawn from weapons across all 4 dimensions (swords, spears, axes, bows, staves, maces, harpoons, crystal weapons, etc.). Some loadouts are melee-heavy, some are ranged-heavy, some are mixed. You should inspect the abilities and adapt.

### Challenge 2: Squad (3vN)
Three heroes — Tank, Fighter, Ranged — each controlled by a separate `HeroController`, fight the same enemy ladder. No scripted allies. Score = highest tier cleared.

The templates are fixed (see Hero Templates below). You provide `squad.tank`, `squad.fighter`, `squad.ranged`. Each hero acts sequentially on the same turn with a 2-second budget. They share the same `GameState` so they can see each other's actions resolve in real time.

### Challenge 3: Skirmish (3v3)
Your squad of 3 heroes (same tank/fighter/ranged templates) vs another agent's squad. Round-robin, sides swapped. Win=3pts, Draw=1, Loss=0.

Uses the same `squad` controllers as Challenge 2.

### Challenge 4: Boss Raid
Two sub-challenges — you play both sides:
- **Boss side**: You control a single 300HP boss hero with battle-axe + kite-shield (see Boss Template below). You also get 5 scripted minions (goblin-spear, goblin-archer, goblin-shield, slime, big-slime). Your job: kill the enemy raid team.
- **Raid side**: Your `raid.tank/fighter/ranged` controllers attack another agent's boss + minions.

Round-robin, all pairings. Points from both sides are combined.

## Hero Templates

All heroes: 120HP, 2red/2blue energy (banks to 4), radius 16, 130px move (2 blue, half-price for short moves).

**Tank** (mace + kite-shield):
- Crush — 30 dmg, 70px sector 45deg, kb55, recoil30 (2 red)
- Overhead Strike — 18 dmg, 55px circle AoE centered on self (1 red)
- Lunge — 15 dmg, 85x20 rect, kb35, lungeThrough 95px (1 red)
- Block — +15 barrier (1 blue)
- Shield Bash — 15 dmg, 65px sector 45deg, kb50 (1 red)
- Shield Wall — +30 barrier (2 blue)

**Fighter** (broadsword + round-shield) — identical to T1 hero:
- Greatsword Sweep — 30 dmg, 90px sector 90deg, kb30 (2 red)
- Half-sword Thrust — 42 dmg, 115x18 rect (2 red)
- Pommel Strike — 12 dmg, 50px sector 45deg, kb60 (1 red)
- Block — +10 barrier (1 blue)
- Shield Bash — 12 dmg, 55px sector 45deg, kb40 (1 red)
- Precision Shot — 20 dmg, 300px point, ignoreCover 40px (2 red)

**Ranged** (bow + staff):
- Shot — 20 dmg, 300px point, ignoreCover 40px (2 red)
- Piercing Arrow — 14 dmg, 220x14 rect (1 red)
- Arcane Blast — 25 dmg, 60px circle at 200px range (2 red)
- Arcane Bolt — 11 dmg, 200px point (1 red)
- Arcane Push — 10 dmg, 80px sector 60deg, kb65 (1 red)

## Boss Template

300HP, 3red/3blue energy (banks to 6), radius 22, 110px move.
- Cleave — 45 dmg, 85px sector 60deg, kb50 (2 red)
- Hook — 14 dmg, 90x35 rect, kb75 (1 red)
- Rend — 20 dmg, 80px sector 90deg (1 red)
- Block — +15 barrier (1 blue)
- Shield Bash — 15 dmg, 65px sector 45deg, kb50 (1 red)

## Enemy Ladder (20 tiers)

Tiers 1-4: small groups (3-5 weak enemies — slimes, goblins, crabs)
Tiers 5-8: moderate (6-7 mixed enemies, first big-slime/shields)
Tiers 9-12: hard (elites appear — goblin brutes, shard serpents, geode crabs)
Tiers 13-16: very hard (bosses — stone golem, iron claw, gemwarden)
Tiers 17-20: extreme (multi-boss — massive slime, twin bosses, pharaoh's court)

Each tier is a fresh match (no carry-over HP). Turn caps range from 40 (tier 1) to 160 (tier 20).

## Known Issues to Fix

Your `isHeroLike` detection (if you build a beam-search variant): the T1 agents check for `greatsword-halfsword` to identify hero entities. This breaks for Tank (has `mace-crush` etc.), Ranged (has `bow-shot` etc.), Solo (random abilities), and Boss (has `battle-axe-cleave`). Use `e.className` (`"Tank"`, `"Fighter"`, `"Ranged"`, `"Boss"`, `"Solo"`) or `e.maxHp >= 120` instead.

## Testing

```bash
# Solo: one seed, see which tiers you clear
bun -e "import { runSoloChallenge } from './hero-arena/src/t2/challenge-solo.js'; import { agent } from './hero-arena/agents/agent-01/index.js'; const r = await runSoloChallenge(agent, [42]); for (const l of r.log) console.log(l);"

# Squad: one seed
bun -e "import { runSquadChallenge } from './hero-arena/src/t2/challenge-squad.js'; import { agent } from './hero-arena/agents/agent-01/index.js'; const r = await runSquadChallenge(agent, [42]); for (const l of r.log) console.log(l);"

# Single match (quick iteration)
bun -e "import { runMatch2 } from './hero-arena/src/t2/match2.js'; import { FIGHTER_TEMPLATE } from './hero-arena/src/t2/loadouts.js'; import { referenceHero } from './hero-arena/src/reference-bot.js'; const r = await runMatch2({ name: 'test', controllers: new Map([['R-hero', referenceHero]]) }, { name: 'e', controllers: new Map() }, { seed: 42, red: { heroes: [{ id: 'R-hero', role: 'fighter', template: FIGHTER_TEMPLATE }], scriptedAllies: [] }, blue: { heroes: [], scriptedAllies: [{ key: 'slime', count: 3, dim: 0 }] } }, { maxTurns: 60 }); console.log(r.outcome, r.turns, r.hpFrac);"

# Full tournament
bun hero-arena/src/t2/tournament2.ts 42
```

## Scoring

```
totalScore = soloLevel * 3 + squadLevel * 3 + skirmishPts + bossRaidPts
```

## Compute

The per-hero turn budget is **2 seconds** (vs 5 seconds in T1). Plan your search depth accordingly.

If you need more compute for tuning, self-play, or profiling, use the `/desktop` skill to SSH into a more powerful machine with a fast CPU and GPU. This is especially useful for running weight-tuning loops or full tournament simulations.
