import { Assets, Texture } from "pixi.js";

export type UnitType = "warrior" | "spearman" | "archer";
export type AnimState = "idle" | "attack" | "hit" | "move";
export type TeamColor = "red" | "blue";

const UNIT_TYPES: UnitType[] = ["warrior", "spearman", "archer"];
const ANIM_STATES: AnimState[] = ["idle", "attack", "hit", "move"];
const TEAMS: TeamColor[] = ["red", "blue"];

const textures = new Map<string, Texture>();

function key(team: TeamColor, unit: UnitType, state: AnimState): string {
  return `${team}-${unit}-${state}`;
}

export async function loadSpriteAssets(): Promise<void> {
  const entries: { alias: string; src: string }[] = [];
  for (const team of TEAMS) {
    for (const unit of UNIT_TYPES) {
      for (const state of ANIM_STATES) {
        const k = key(team, unit, state);
        entries.push({ alias: k, src: `sprites/${k}.webp` });
      }
    }
  }

  await Assets.load(entries);
  for (const { alias } of entries) {
    textures.set(alias, Assets.get(alias));
  }
}

export function getSpriteTexture(
  team: TeamColor,
  unit: UnitType,
  state: AnimState
): Texture {
  return textures.get(key(team, unit, state))!;
}

const WEAPON_TO_UNIT: Record<string, UnitType> = {
  "short-sword": "warrior",
  spear: "spearman",
  bow: "archer",
};

export function weaponToUnitType(weaponId: string): UnitType {
  return WEAPON_TO_UNIT[weaponId] ?? "warrior";
}
