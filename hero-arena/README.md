# Hero Arena

A round-robin duel between eight bots. Each bot drives **one hero** on a team; the hero's five
teammates are dumb World-0 (Greenlands) enemies — goblins and slimes, never the bosses — running
the game's stock scripted strategies (`rush` / `kite` / `threat`). Both sides field the *same* hero
kit and the *same* five allies — the only variable is the brain steering the hero. Win by wiping
the enemy team.

```
hero-arena/
  src/
    types.ts          the HeroController API — read this first
    toolkit.ts        helpers: resolveAction, pathToward, simulateScriptedTurn, board queries, basicScore, …
    loadout.ts        the fixed hero kit ("decent World 1 gear") — same for both sides
    arena.ts          builds a mirrored arena for a given seed (map + 2 heroes + 5 allies each)
    match.ts          plays one match (hero brains + scripted allies + endTurn), enforces the rules
    reference-bot.ts  the default hero (a decent 1-ply-lookahead bot) + a dumb `baseline`
    registry.ts       name → HeroController for all eight agents (+ `baseline`)
    harness.ts        CLI: run/replay ONE match
    tournament.ts     CLI: run the whole round robin, print standings
  agents/
    agent-01/ … agent-08/
        index.ts      each exports `hero: HeroController` — starts as the reference bot; replace it
```

## Write your bot

Edit `agents/<you>/index.ts`. Keep the export named `hero`. You may add more files in your folder
and import them. Your `HeroController` is:

```ts
import type { HeroController } from "../../src/types.js";
export const hero: HeroController = (ctx) => {
  // ctx.state    — the board at the start of YOUR hero's turn (read-only, do not mutate)
  // ctx.heroId   — your hero's entity id; ctx.state.entities.get(heroId)!.teamId is your side
  // ctx.deadlineMs — Date.now() by which to return (5s/turn; cooperative — poll it if you search)
  // ctx.turnIndex  — how many turns your side has taken (1-based)
  // return: the sequence of `{type:"ability", entityId: heroId, ...}` actions to take this turn,
  //         in order, with NO `endTurn`. Return [] to pass.
  return [];
};
```

What the harness does for you: drops any action that isn't your hero's; drops any action the
engine rejects (unaffordable / out of range / into a wall / no-op); caps you at a sane action
count (energy bounds it anyway). So be optimistic — a bad action is a no-op, not a crash. If your
bot throws or runs >3× over budget, your hero forfeits that turn (it just passes); milder overruns
are logged. Module-level state persists for a whole match (one controller instance per match); be
deterministic (or seed any RNG from `ctx.state`) if you want reproducible replays.

### The toolkit (`src/toolkit.ts`)

Everything wraps the real engine and never mutates anything — state in, (new) state or value out.

- `resolveAction(s, action)` / `tryAction(s, action)` — apply an action; the latter returns `null`
  on rejection. Use this to verify candidates and do lookahead.
- `pathToward(s, entityId, target, maxDistance?)` — A* a reachable point toward `target`, capped
  to the entity's move range (status-adjusted) unless you override `maxDistance`.
- `simulateScriptedTurn(s)` — play `s.activeTeam`'s whole turn as if every unit (including its
  hero) were scripted, then `endTurn`. Your opponent's brain is invisible — "assume they're
  scripted" is the safe baseline for lookahead. Returns the resulting state.
- `simulateMyAlliesTurn(s, heroId)` — run only your dumb allies' scripted turn (not your hero, not
  `endTurn`). Apply your candidate hero actions first, then call this to see how the turn ends —
  handy if you want to *orchestrate* your allies (set up their rush to land a kill, etc.).
- board queries: `livingEnemies`, `livingAllies`, `livingTeam`, `nearest`, `dist`, `centroid`,
  `entity`, `teamOf`.
- abilities: `moveAbility`, `attackAbilities`, `attackRange`, `aimAt`, `attackHits`.
- `basicScore(s, team)` — a plain HP%+alive-count leaf eval. Fine as a default; the interesting
  bots will weight the hero above the interchangeable allies, value clustering enemies for ally
  AoE, value damage prevented by tanking, etc.

You can also import anything from `../../shared/src/index.js` directly (the engine: `resolveAction`
under the hood, `canAffordAbility`, vec math, `ShapeKind`, all the types, …).

## Test your bot — the same way the tournament does

```bash
bun hero-arena/src/harness.ts agent-01 baseline      # vs the dumb baseline (sanity check)
bun hero-arena/src/harness.ts agent-01 agent-01      # MIRROR — fight yourself (self-play)
bun hero-arena/src/harness.ts agent-01 agent-02 42   # head to head, seed 42
bun hero-arena/src/harness.ts agent-01 agent-03 7 200  # seed 7, 200-turn cap
```

`harness.ts` prints a turn-by-turn log (every hero action; allies summarised; rule violations and
over-budget turns flagged), the winner, and timing. It also writes `client/public/replay.json` —
open **`http://localhost:5173/?mode=replay`** to scrub the match visually (`.` step a frame,
`Enter` play a turn, `[` / `]` change speed).

Run the whole tournament:

```bash
bun hero-arena/src/tournament.ts            # default seeds 1 7 42
bun hero-arena/src/tournament.ts 1 2 3 4 5  # your own seed set
```

Every pairing plays each seed twice (sides swapped, since red moves first). Scoring: win 3, draw
1, loss 0; turn-cap draws broken by team HP%. Standings tie-break: head-to-head points → total
HP%-margin → heroes-kept. It also prints the W/D/L matrix.

## The hero kit (frozen)

A *normal* World-0 adventurer — 120 HP, 2 red + 2 blue energy per turn (each banks to 4),
collision radius 16. Loadout: a two-handed greatsword (the broadsword's moves), a round shield,
and a long-range precision bow shot. Move costs blue, attacks cost red, so most turns you can
reposition *and* swing.

| id | what | cost |
|---|---|---|
| `move` | 130px (1 blue if you travel ≤65px, else 2 blue) | 1–2 blue |
| `greatsword-sweep` | 30 dmg, 90px / 90° sector, knockback 30 | 2 red |
| `greatsword-halfsword` | 42 dmg, 115×18 rect, no knockback — your big single-target hit | 2 red |
| `greatsword-pommel` | 12 dmg, 50px / 45° sector, **knockback 60** | 1 red |
| `shield-block` | +10 barrier (a small turn-1 buffer) | 1 blue |
| `shield-bash` | 12 dmg, 55px / 45° sector, knockback 40 | 1 red |
| `precision-shot` | 20 dmg, point target at 300px, sees 40px past cover | 2 red |

Knockback resolves through the engine's real physics — slam an enemy into a wall, edge, or
another unit and the throw is cut short for bonus damage. Use `tryAction` to see exactly where
everyone ends up. There's no friendly fire (AoE only ever hits the other team), so clustering the
enemies is pure upside for your allies. The five dumb allies are plain World-0 (Greenlands)
enemies — a couple of goblins, a shield goblin, a couple of slimes (never the Stone Golem or
Massive Slime bosses) — each running its seeded strategy; the same five back both heroes.
