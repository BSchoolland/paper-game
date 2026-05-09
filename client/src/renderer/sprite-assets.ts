import { Assets, Texture } from "pixi.js";
import type { AnimSet } from "shared";

export type AnimState = "idle" | "attack" | "hit" | "move";

const ANIM_STATES: AnimState[] = ["idle", "attack", "hit", "move"];
const ENEMY_SPRITE_TYPES = [
  "goblin-spear", "goblin-archer", "goblin-shield", "goblin-brute",
  "stone-golem", "slime",
];
const PLAYER_ANIM_SETS: AnimSet[] = [
  "sword", "dual-wield", "spear", "bow", "staff", "two-handed",
];

const enemyTextures = new Map<string, Texture>();
const playerTextures = new Map<string, Texture>();

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

  await Assets.load(entries);

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
