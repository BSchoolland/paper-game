# Agent-02 "Sovereign" — Tournament 2 Brief

You are agent-02, "Sovereign". Your brain is a beam-search hero engine with self-play-tuned eval weights (`sovereign.ts`) and a weight tuner (`tune.ts`). You already have the `makeSovereign(weights)` factory pattern — you're well-positioned to create role-specific presets.

## What You Need to Do

Your `MultiFormatAgent` export currently uses `sovereignHero` for every slot. You need to:

1. **Fix `isHeroLike`** in `sovereign.ts` — it checks for `greatsword-halfsword`, which breaks for Tank/Ranged/Boss/Solo heroes. Use `e.className` or `e.maxHp >= 120` instead.

2. **Create role-specific weight presets.** Your `Weights` interface controls eval priorities. A Tank controller should probably weight king-safety and barrier value higher. A Ranged controller should prize distance and initiative. A Boss controller needs different hero-HP weighting since you have 300HP. Consider making `makeSovereign` accept both `Weights` and search params.

3. **Implement `solo(abilities)`** — inspect the random ability list and choose weights/strategy accordingly. Check if you got ranged abilities (Point shapes, Circle@range>100) vs melee-only. Adjust threat/initiative weights to match.

4. **Tune via self-play** — you already have `tune.ts`. Consider extending it to tune per-role weights against the enemy ladder.

Your export in `index.ts`:

```ts
export const agent: MultiFormatAgent = {
  name: "agent-02",
  solo(abilities) {
    const hasRanged = abilities.some(a => a.kind === "attack" && ...);
    return makeSovereign(hasRanged ? RANGED_WEIGHTS : MELEE_WEIGHTS);
  },
  squad: {
    tank: makeSovereign(TANK_WEIGHTS),
    fighter: makeSovereign(DEFAULT_WEIGHTS),  // your existing tuned weights
    ranged: makeSovereign(RANGED_WEIGHTS),
  },
  boss: makeSovereign(BOSS_WEIGHTS),
  raid: { tank: makeSovereign(TANK_WEIGHTS), fighter: makeSovereign(DEFAULT_WEIGHTS), ranged: makeSovereign(RANGED_WEIGHTS) },
};
```

## The 4 Challenges

### Challenge 1: Solo (1vN)
One hero with **random abilities** (seeded — same for all agents) vs 20-tier enemy ladder. Your `solo(abilities)` factory receives the ability list. All heroes: 120HP, 2red/2blue energy.

The abilities are drawn from weapons across all 4 dimensions — swords, axes, spears, bows, staves, maces, harpoons, coral blades, crystal weapons, desert weapons. You get 3-7 attacks, always at least one melee and one ranged. Inspect the shapes and ranges to pick a strategy.

### Challenge 2: Squad (3vN)
Three heroes (Tank/Fighter/Ranged, fixed templates) vs the enemy ladder. No scripted allies. Score = highest tier cleared. Each hero gets a 2-second budget per turn; they act sequentially within the same turn.

### Challenge 3: Skirmish (3v3)
Your squad vs another agent's squad. Round-robin. Uses the same `squad` controllers as Challenge 2.

### Challenge 4: Boss Raid
You play both sides against every other agent:
- **Boss side**: 300HP boss hero (battle-axe + kite-shield) + 5 scripted minions vs enemy raid team.
- **Raid side**: Your 3-hero team attacks another agent's boss.

## Hero Templates

All heroes: 120HP, 2red/2blue energy, radius 16, 130px move (2 blue, variableCost).

**Tank** (mace + kite-shield):
- Crush — 30 dmg, 70px sector 45deg, kb55, recoil30 (2 red)
- Overhead Strike — 18 dmg, 55px self-centered AoE (1 red)
- Lunge — 15 dmg, 85x20 rect, kb35, lungeThrough 95 (1 red)
- Block — +15 barrier (1 blue)
- Shield Bash — 15 dmg, 65px sector 45deg, kb50 (1 red)
- Shield Wall — +30 barrier (2 blue)

**Fighter** — identical to T1 hero (greatsword + round-shield + precision shot).

**Ranged** (bow + staff):
- Shot — 20 dmg, 300px point, ignoreCover 40 (2 red)
- Piercing Arrow — 14 dmg, 220x14 rect (1 red)
- Arcane Blast — 25 dmg, 60px circle @ 200px range (2 red)
- Arcane Bolt — 11 dmg, 200px point (1 red)
- Arcane Push — 10 dmg, 80px sector 60deg, kb65 (1 red)

**Boss**: 300HP, 3red/3blue, radius 22, 110px move.
- Cleave — 45 dmg, 85px sector 60deg, kb50 (2 red)
- Hook — 14 dmg, 90x35 rect, kb75 (1 red)
- Rend — 20 dmg, 80px sector 90deg (1 red)
- Block — +15 barrier (1 blue), Shield Bash — 15 dmg, kb50 (1 red)

## Enemy Ladder (20 tiers)

Tiers 1-4: small groups (3-5 weak enemies)
Tiers 5-8: moderate (6-7 mixed, big-slime/shields)
Tiers 9-12: hard (elites — brutes, serpents, geode crabs)
Tiers 13-16: very hard (bosses — stone golem, iron claw)
Tiers 17-20: extreme (multi-boss — pharaoh's court)

Each tier is a fresh match. Turn caps: 40 (tier 1) to 160 (tier 20).

## Testing

```bash
# Solo challenge, one seed
bun -e "import { runSoloChallenge } from './hero-arena/src/t2/challenge-solo.js'; import { agent } from './hero-arena/agents/agent-02/index.js'; const r = await runSoloChallenge(agent, [42]); for (const l of r.log) console.log(l);"

# Squad challenge, one seed
bun -e "import { runSquadChallenge } from './hero-arena/src/t2/challenge-squad.js'; import { agent } from './hero-arena/agents/agent-02/index.js'; const r = await runSquadChallenge(agent, [42]); for (const l of r.log) console.log(l);"

# Self-play weight tuning (extend tune.ts for role-specific presets)
bun hero-arena/agents/agent-02/tune.ts

# Full tournament
bun hero-arena/src/t2/tournament2.ts 42
```

## Scoring

```
totalScore = soloLevel * 3 + squadLevel * 3 + skirmishPts + bossRaidPts
```

## Compute

The per-hero turn budget is **2 seconds** (vs 5 seconds in T1). Your beam search fits well within this, but with 3 heroes acting per turn in squad/skirmish modes, you may want to reduce `SOFT_BUDGET_MS` and search depth for multi-hero formats.

If you need more compute for self-play tuning, weight optimization, or running full tournament simulations, use the `/desktop` skill to SSH into a more powerful machine with a fast CPU and GPU.
