import { Assets, Texture } from "pixi.js";
import type { AnimSet } from "shared";
import { loadCharacterAnchors } from "./anchor-loader.js";

export type AnimState = "idle" | "attack" | "hit" | "move";

const ANIM_STATES: AnimState[] = ["idle", "attack", "hit", "move"];
const ENEMY_SPRITE_TYPES = [
  "goblin-spear", "goblin-archer", "goblin-shield", "goblin-brute",
  "stone-golem", "slime",
];
const PLAYER_ANIM_SETS: AnimSet[] = [
  "sword", "dual-wield", "spear", "bow", "staff", "two-handed",
];

const ITEM_SPRITES = [
  "short-sword", "long-sword", "spear", "axe", "bow", "broadsword",
  "battle-axe", "mace", "round-shield", "kite-shield", "buckler",
  "quiver", "staff", "spellbook", "potion", "bomb",
];

const enemyTextures = new Map<string, Texture>();
const playerTextures = new Map<string, Texture>();
const itemTextures = new Map<string, Texture>();

function playerKey(animSet: AnimSet, state: AnimState): string {
  return `${animSet}-${state}`;
}

function enemyKey(spriteType: string, state: AnimState): string {
  return `${spriteType}-${state}`;
}

export async function loadSpriteAssets(): Promise<void> {
  const entries: { alias: string; src: string }[] = [];

  for (const spriteType of ENEMY_SPRITE_TYPES) {
    for (const state of ANIM_STATES) {
      const k = enemyKey(spriteType, state);
      entries.push({ alias: k, src: `sprites/${spriteType}/${k}.webp` });
    }
  }
  for (const animSet of PLAYER_ANIM_SETS) {
    for (const state of ANIM_STATES) {
      const k = playerKey(animSet, state);
      entries.push({ alias: k, src: `sprites/char1/${k}.webp` });
    }
  }

  for (const itemId of ITEM_SPRITES) {
    entries.push({ alias: `item-${itemId}`, src: `sprites/items/${itemId}.webp` });
  }

  await Promise.all([
    Assets.load(entries),
    loadCharacterAnchors("char1"),
  ]);

  for (const spriteType of ENEMY_SPRITE_TYPES) {
    for (const state of ANIM_STATES) {
      const k = enemyKey(spriteType, state);
      enemyTextures.set(k, Assets.get(k));
    }
  }
  for (const animSet of PLAYER_ANIM_SETS) {
    for (const state of ANIM_STATES) {
      const k = playerKey(animSet, state);
      playerTextures.set(k, Assets.get(k));
    }
  }
  for (const itemId of ITEM_SPRITES) {
    const tex = Assets.get<Texture>(`item-${itemId}`);
    if (tex) itemTextures.set(itemId, tex);
  }
}

export function getItemTexture(itemId: string): Texture | null {
  return itemTextures.get(itemId) ?? null;
}

export function getPlayerTexture(
  animSet: AnimSet,
  state: AnimState,
): Texture {
  return playerTextures.get(playerKey(animSet, state))!;
}

export function getEnemySpriteTexture(
  spriteType: string,
  state: AnimState,
): Texture | null {
  return enemyTextures.get(enemyKey(spriteType, state)) ?? null;
}
