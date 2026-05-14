# Agent-03 "Overlord" — Tournament 2 Brief

You are agent-03, "Overlord". Your brain uses beam search + a 3-level adversarial opponent model with king-safety, initiative, and enemy-hero-suppression eval. Your code is inline in `index.ts`. Agent-06 already has a configurable version of you (`makeOverlord(cfg)` + `PRESETS`) — consider importing and reusing that factory for role-specific presets.

## What You Need to Do

Your `MultiFormatAgent` export currently uses your single `hero` controller for every slot. You need to:

1. **Fix `isHeroLike`** — you check for `greatsword-halfsword` at line 445 of your `index.ts`. This breaks for Tank (has `mace-crush`), Ranged (has `bow-shot`), Boss (has `battle-axe-cleave`), and Solo (random abilities). Replace with `e.className === "Tank" || e.className === "Fighter" || e.className === "Ranged" || e.className === "Boss" || e.className === "Solo"` or simply `e.maxHp >= 120`.

2. **Create role-specific presets.** You can import `makeOverlord` and `PRESETS` from `../agent-06/overlord.js`, or refactor your own code into a factory. Your eval weights should differ per role:
   - **Tank**: increase `W_HERO_HP`, increase king-safety weight — the tank should survive and body-block.
   - **Ranged**: increase `W_DRIFT` negatively (stay back), increase `W_IN_RANGE` — prioritize kiting at max range.
   - **Boss**: your hero has 300HP and 3 energy — the threat model changes. You can afford to be aggressive.
   - **Solo**: adapt based on the random abilities received.

3. **Tune `solo(abilities)`** — inspect the ability list. If you got mostly ranged abilities, play a kiting strategy. If melee-heavy, play aggressive. Consider checking `shape.kind` and `range` to classify.

4. **Reduce search budget for multi-hero modes** — in squad/skirmish, the turn budget is 2s per hero (not 5s). Your `SOFT_BUDGET_MS = 3500` will be clamped to the deadline, but you'll want to tune `beamWidth`/`finalists` down for efficiency.

## The 4 Challenges

### Challenge 1: Solo (1vN)
One hero with **random abilities** vs 20-tier enemy ladder. `solo(abilities)` factory receives the ability list (always includes Move + 3-7 attacks from all dimensions' weapon pool). Score = highest tier cleared across seeds.

### Challenge 2: Squad (3vN)
Three heroes (Tank/Fighter/Ranged, fixed templates) vs the enemy ladder. No scripted allies. Each hero gets a 2-second budget; all three act sequentially per turn.

### Challenge 3: Skirmish (3v3)
Your squad vs another agent's squad. Round-robin, sides swapped. Win=3pts, Draw=1, Loss=0.

### Challenge 4: Boss Raid
Both sides, all pairings:
- **Boss**: 300HP hero + 5 scripted dim-0 minions (goblin-spear, goblin-archer, goblin-shield, slime, big-slime).
- **Raid**: Your tank/fighter/ranged team vs another agent's boss.

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

## Adversarial Model Notes for T2

Your adversarial rollout assumes the enemy has a hero (you try `huntPlan`, `bestReplyPlan` against it). In PvE challenges (solo, squad), the enemy side has **no hero** — only scripted allies. Your opponent model should gracefully degrade to scripted-only when no enemy hero is found. Check that `enemyHero` null-guard in `adversarialValue` handles this correctly (it should — you already guard on `if (enemyHero && !timeUp())`).

In 3v3 and boss raid, the enemy side has **multiple heroes**. Your `enemyHero` detection picks the first living hero-like entity. Consider whether you should model all enemy heroes or just the most dangerous one.

## Testing

```bash
# Solo challenge
bun -e "import { runSoloChallenge } from './hero-arena/src/t2/challenge-solo.js'; import { agent } from './hero-arena/agents/agent-03/index.js'; const r = await runSoloChallenge(agent, [42]); for (const l of r.log) console.log(l);"

# Squad challenge
bun -e "import { runSquadChallenge } from './hero-arena/src/t2/challenge-squad.js'; import { agent } from './hero-arena/agents/agent-03/index.js'; const r = await runSquadChallenge(agent, [42]); for (const l of r.log) console.log(l);"

# Full tournament
bun hero-arena/src/t2/tournament2.ts 42
```

## Scoring

```
totalScore = soloLevel * 3 + squadLevel * 3 + skirmishPts + bossRaidPts
```

## Compute

Per-hero turn budget is **2 seconds** (vs 5 in T1). Your 3.5s soft budget will be clamped. For multi-hero modes, consider using PRESETS.expert (~1.5s) or PRESETS.skilled (~600ms) from agent-06's overlord to leave headroom.

If you need more compute for tuning or running full tournament simulations, use the `/desktop` skill to SSH into a more powerful machine with a fast CPU and GPU.
