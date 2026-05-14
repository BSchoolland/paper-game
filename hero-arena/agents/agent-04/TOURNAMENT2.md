# Agent-04 "Vanguard" — Tournament 2 Brief

You are agent-04, "Vanguard". Your brain uses exhaustive BFS turn enumeration + adversarial minimax with a concave (sqrt) enemy HP evaluation that naturally incentivizes focus-fire. Your code is in `vanguard.ts`.

## What You Need to Do

Your `MultiFormatAgent` export currently uses `vanguardHero` for every slot. You need to:

1. **Fix `isHeroLike`** in `vanguard.ts` — if you check for `greatsword-halfsword` to detect heroes, it will break for Tank (has `mace-crush`), Ranged (has `bow-shot`), Boss (has `battle-axe-cleave`), and Solo (random abilities). Use `e.className` (`"Tank"`, `"Fighter"`, `"Ranged"`, `"Boss"`, `"Solo"`) or `e.maxHp >= 120` instead.

2. **Create a configurable factory** like `makeVanguard(config)`. Your search params and eval weights are currently module-level constants. Wrapping them in a factory lets you create role-specific presets:
   - **Tank preset**: prioritize survival, body-blocking, barrier stacking. Lower aggression.
   - **Ranged preset**: prioritize kiting at max range, AoE value, distance maintenance.
   - **Boss preset**: account for your 300HP pool and 3 energy — more aggressive, less worried about taking hits.
   - **PvE preset**: no need for adversarial opponent modeling — the enemies are scripted. Skip the minimax and spend compute on broader BFS.

3. **Implement `solo(abilities)`** — inspect the random ability list and pick a strategy. Your focus-fire eval (sqrt HP scoring) should generalize well, but the candidate-generation code may need adjusting for non-standard abilities (e.g., ranged AoE abilities that your current melee-focused candidate generator doesn't explore).

4. **Adjust search budget** — multi-hero modes give 2s per hero (not 5s). With wide beam (28), you may need to narrow it or cut BFS depth for squad/skirmish.

## The 4 Challenges

### Challenge 1: Solo (1vN)
One hero with **random abilities** vs 20-tier enemy ladder. `solo(abilities)` receives the ability list (Move + 3-7 attacks from all dimensions). Score = highest tier cleared across seeds.

Your sqrt-HP focus-fire eval is a natural fit for PvE — finishing wounded enemies is exactly what you want against swarms.

### Challenge 2: Squad (3vN)
Three heroes (Tank/Fighter/Ranged, fixed templates) vs the enemy ladder. No scripted allies. Each hero gets 2s budget per turn, acting sequentially.

Your focus-fire eval should shine here — three heroes coordinating to focus down enemies one at a time is the optimal PvE strategy.

### Challenge 3: Skirmish (3v3)
Your squad vs another agent's squad. Round-robin. Win=3pts, Draw=1, Loss=0.

With multiple heroes on each side, coordination matters. Consider whether each hero should independently focus-fire the weakest enemy, or whether you need role-specific target priorities (e.g., ranged hero targets enemy ranged first).

### Challenge 4: Boss Raid
Both sides, all pairings:
- **Boss**: 300HP hero + 5 scripted minions vs enemy 3-hero raid team.
- **Raid**: Your tank/fighter/ranged vs another agent's boss.

As boss: your focus-fire eval should target the raid team's squishiest hero first. Your 45-damage Cleave can two-shot a 120HP hero.
As raid: coordinate to burn down the boss while managing minions. The boss has 300HP — sustained focus from 3 heroes should take it down.

## Hero Templates

All heroes: 120HP, 2red/2blue energy, radius 16, 130px move.

**Tank** (mace + kite-shield):
- Crush — 30 dmg, 70px sector 45deg, kb55, recoil30 (2 red)
- Overhead Strike — 18 dmg, 55px self-centered circle AoE (1 red)
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
# Solo challenge
bun -e "import { runSoloChallenge } from './hero-arena/src/t2/challenge-solo.js'; import { agent } from './hero-arena/agents/agent-04/index.js'; const r = await runSoloChallenge(agent, [42]); for (const l of r.log) console.log(l);"

# Squad challenge
bun -e "import { runSquadChallenge } from './hero-arena/src/t2/challenge-squad.js'; import { agent } from './hero-arena/agents/agent-04/index.js'; const r = await runSquadChallenge(agent, [42]); for (const l of r.log) console.log(l);"

# Full tournament
bun hero-arena/src/t2/tournament2.ts 42
```

## Scoring

```
totalScore = soloLevel * 3 + squadLevel * 3 + skirmishPts + bossRaidPts
```

## Compute

Per-hero turn budget is **2 seconds** (vs 5 in T1). Your exhaustive BFS with beam width 28 is the most compute-intensive approach in the field. Consider a narrower beam (12-16) for multi-hero modes, or a depth-limited search for roles where quick decisions matter more than optimal play.

If you need more compute for tuning, profiling, or running full tournament simulations, use the `/desktop` skill to SSH into a more powerful machine with a fast CPU and GPU. This is especially useful if you want to run exhaustive self-play tournaments to compare preset variations.
