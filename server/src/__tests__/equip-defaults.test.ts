import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { equipTargets, type InventoryState, type ItemDefinition, type WeaponItem, type ShieldItem } from "shared";
import { ASSETS_DIR } from "../../../shared/src/paths.js";
import { computeHoldPose, withDefaultAttachments } from "../equip-defaults.js";

const itemsDir = join(ASSETS_DIR, "sprites/items");

function weapon(id: string, animSet: WeaponItem["animSet"]): WeaponItem {
  return {
    type: "weapon",
    id,
    name: id,
    description: "",
    rarity: "common",
    sprite: id,
    dimensionId: 0,
    slotCost: { hand: 1 },
    abilities: [],
    animSet,
  };
}

const shield: ShieldItem = {
  type: "shield",
  id: "round-shield",
  name: "Round Shield",
  description: "",
  rarity: "common",
  sprite: "round-shield",
  dimensionId: 0,
  slotCost: { hand: 1 },
  abilities: [],
};

describe("computeHoldPose", () => {
  it("grips a bow mid-limb: near the sprite center, on the wood (off the string diagonal)", async () => {
    const pose = await computeHoldPose(join(itemsDir, "bow.webp"), "bow-center");
    // The grip wrap sits just up-left of the bounding-box center on the limb arc.
    expect(pose.gripX).toBeGreaterThan(0.2);
    expect(pose.gripX).toBeLessThan(0.55);
    expect(pose.gripY).toBeGreaterThan(0.25);
    expect(pose.gripY).toBeLessThan(0.65);
  });

  it("grips a sword near the bottom-left handle end", async () => {
    const pose = await computeHoldPose(join(itemsDir, "short-sword.webp"), "handle-end");
    // Handle is authored bottom-left; grip is 20% up the blade axis from that end.
    expect(pose.gripX).toBeLessThan(0.5);
    expect(pose.gripY).toBeGreaterThan(0.5);
  });

  it("grips a staff near the bottom-left handle end", async () => {
    const pose = await computeHoldPose(join(itemsDir, "staff.webp"), "handle-end");
    expect(pose.gripX).toBeLessThan(0.5);
    expect(pose.gripY).toBeGreaterThan(0.5);
  });
});

describe("equipTargets", () => {
  it("routes weapon to the screen-right hand and shield to the left, bows flipped 180°", () => {
    const bow = weapon("bow", "bow");
    const targets = equipTargets([bow, shield]);
    expect(targets.get("bow")).toEqual({ boneName: "r_arm", attachEnd: "to", rotation: 180, grip: "bow-center" });
    expect(targets.get("round-shield")).toEqual({
      boneName: "l_arm",
      attachEnd: "to",
      rotation: 0,
      grip: "sprite-center",
    });
  });

  it("routes a second weapon to the free left hand", () => {
    const a = weapon("short-sword", "sword");
    const b = weapon("long-sword", "sword");
    const targets = equipTargets([a, b]);
    expect(targets.get("short-sword")!.boneName).toBe("r_arm");
    expect(targets.get("long-sword")!.boneName).toBe("l_arm");
  });
});

describe("withDefaultAttachments", () => {
  it("fills missing attachments and never touches authored ones", () => {
    const sword = weapon("short-sword", "sword");
    const authored = {
      boneName: "spine",
      attachEnd: "from" as const,
      localOffsetAlong: 0.1,
      localOffsetPerp: 0.2,
      scale: 0.3,
      rotation: 45,
      referenceFrame: "inventory-idle",
    };
    const inv: InventoryState = {
      equipped: [sword, shield] as ItemDefinition[],
      attachments: { "short-sword": authored },
    };
    const out = withDefaultAttachments(inv);
    expect(out.attachments["short-sword"]).toEqual(authored);
    const def = out.attachments["round-shield"]!;
    expect(def.boneName).toBe("l_arm");
    expect(def.attachEnd).toBe("to");
    expect(def.referenceFrame).toBe("inventory-idle");
    expect(def.scale).toBeGreaterThan(0);
  });

  it("is a no-op when every equipped item is already placed", () => {
    const sword = weapon("short-sword", "sword");
    const inv = withDefaultAttachments({ equipped: [sword] as ItemDefinition[], attachments: {} });
    expect(withDefaultAttachments(inv)).toBe(inv);
  });
});
