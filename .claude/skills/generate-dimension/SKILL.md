---
name: generate-dimension
description: Generate a new dimension end-to-end (spec, art, balanced enemies/items, maps, QA)
user_invocable: true
---

# Generate Dimension

First, briefly discuss the dimension idea with the user: settle on a name and expand their concept into a short paragraph. The land should be an interesting place to fight and the enemies (not the terrain) are the threat. Keep it light — a couple of exchanges, then build.

Then run the `generate-and-stage` workflow with the Workflow tool, passing the agreed concept as `seed`:

```
Workflow({
  scriptPath: "/home/ben/Projects/turn-based-game/dimension-generator/auto/workflows/generate-and-stage.workflow.js",
  args: { dimId: <next unused id>, dbPath: "/home/ben/Projects/turn-based-game/server/hex-discovery.sqlite", seed: "<the agreed world concept>" },
})
```

It designs the spec, generates art, balances 16 enemies and 16 weapons against the simulation tests, bakes the encounter maps, runs QA, and flips the dimension to `in_review`.

Pick `dimId` as the next unused id (existing: `dimension-generator/dimension-*-spec.json`). `dbPath` must be the running server's db so it sees the new dimension. After review, promote it with `promote.workflow.js` (same args).
