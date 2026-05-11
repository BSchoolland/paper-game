---
name: ability-balance
description: Review a weapon's abilities for depth and remake them if needed
user_invocable: true
---

# Ability Balance Review

The argument should be a weapon id (e.g. `broadsword`) or "all" to review every weapon.

Read `shared/src/core/items.ts` and `shared/src/core/types.ts`. Find the weapon and all its abilities.

To players, does this weapon feel full of depth or is it kind of a single strategy weapon? Redesign it, then for each ability, think "when will users have fun using this, and what is this ability for?"

Edit the abilities inline in `items.ts` using the `satisfies AttackAbility` pattern. Run `bun run typecheck` to verify.

All weapons should have at least 2 abilities. Uncommon and above (or any weapon that would genuinely benefit from a third tactical option) should have 3.  Don't throw in a third ability if a weapon already feels great, but if there's a genuine gap in strategy, feel free to add in a third.
