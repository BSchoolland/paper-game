// Batch author + upsert all 16 Verdant Colossus (dim 706) enemies.
// Each template is validated against the same zod schema the upsert CLI uses.
import { enemyTemplate } from "./auto/schemas.js";
import { withEnemySprites } from "./auto/enemy-sprites.js";
import { saveEnemyTemplate } from "../server/src/db.js";

const DIM = 706;
const PI = Math.PI;

const move = (distance: number, blue = 1) => ({ id: "move", name: "Move", kind: "move", cost: { blue }, distance });

const roster: Record<string, any> = {
  // ===================== FODDER (cost 1-2) =====================
  "mason-drone": {
    abilities: [
      move(150),
      { id: "mason-drone-claw", name: "Claw Rake", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 42, halfAngle: PI / 4 }, damage: 10, knockback: 0,
        visual: { color: 0x8fae6b, trailEffect: "slash", screenShake: 0.12 } },
    ],
    hp: 32, energy: { red: 1, blue: 1 }, collisionRadius: 11, className: "Mason Drone",
    heightMeters: 1.0, strategy: "rush", cost: 1, tags: ["melee", "swarm"],
  },
  "chisel-drone": {
    abilities: [
      move(170),
      { id: "chisel-drone-bore", name: "Chisel Bore", kind: "attack", cost: { red: 1 },
        shape: { kind: "rectangle", length: 92, width: 16 }, damage: 11, knockback: 0,
        onHit: [{ type: "applyStatus", status: "suppressed", duration: 2, value: 1 }],
        visual: { color: 0x9fbf72, trailEffect: "thrust", screenShake: 0.2 } },
    ],
    hp: 36, energy: { red: 1, blue: 2 }, collisionRadius: 11, className: "Chisel Drone",
    heightMeters: 1.15, strategy: "rush", cost: 2, tags: ["melee", "swarm"],
  },
  "rivet-drone": {
    abilities: [
      move(130),
      { id: "rivet-drone-tack", name: "Rivet Tack", kind: "attack", cost: { red: 1 },
        shape: { kind: "point", range: 175 }, damage: 13, knockback: 0,
        onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 0.3 }],
        visual: { color: 0xb0c48a, trailEffect: "projectile", screenShake: 0.1 } },
      { id: "rivet-drone-patch", name: "Patch Weld", kind: "zone", cost: { blue: 1 }, range: 130,
        zone: { effect: "heal", radius: 55, duration: 3, magnitude: 8, color: 0x7fd08a, pattern: "pulse" } },
    ],
    hp: 34, energy: { red: 1, blue: 1 }, collisionRadius: 11, className: "Rivet Drone",
    heightMeters: 1.0, strategy: "kite", cost: 2, tags: ["ranged", "swarm"],
  },
  "grout-drone": {
    abilities: [
      move(135),
      { id: "grout-drone-glob", name: "Stone Glob", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 48, halfAngle: PI / 4 }, damage: 13, knockback: 30,
        visual: { color: 0x8a9a6a, trailEffect: "splash", screenShake: 0.14 } },
      { id: "grout-drone-bulwark", name: "Raise Bulwark", kind: "zone", cost: { blue: 2 }, range: 120,
        zone: { effect: "cover", radius: 50, duration: 4, magnitude: 0, color: 0x6f7d55, pattern: "lattice" } },
    ],
    hp: 40, energy: { red: 1, blue: 1 }, collisionRadius: 12, className: "Grout Drone",
    heightMeters: 1.0, strategy: "rush", cost: 2, tags: ["melee", "swarm"],
  },

  // ===================== STANDARD (cost 3-4) =====================
  "mason-golem": {
    abilities: [
      move(112),
      { id: "mason-golem-smash", name: "Mortar Smash", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 70, halfAngle: PI / 3 }, damage: 20, knockback: 30,
        visual: { color: 0x7f9256, trailEffect: "slash", screenShake: 0.3 } },
      { id: "mason-golem-overhead", name: "Overhead Break", kind: "attack", cost: { red: 2 },
        shape: { kind: "sector", radius: 60, halfAngle: PI / 6 }, damage: 32, knockback: 45,
        wallSlamDamage: 15, visual: { color: 0x6f8248, trailEffect: "explosion", screenShake: 0.5 } },
    ],
    hp: 85, energy: { red: 2, blue: 1 }, collisionRadius: 18, className: "Mason Golem",
    heightMeters: 2.25, strategy: "rush", cost: 3, tags: ["melee"],
  },
  "stone-sentinel": {
    abilities: [
      move(92),
      { id: "stone-sentinel-slam", name: "Guard Slam", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 66, halfAngle: PI / 2.5 }, damage: 24, knockback: 45,
        visual: { color: 0x788a52, trailEffect: "slash", screenShake: 0.3 } },
      { id: "stone-sentinel-brace", name: "Brace Wall", kind: "barrier", cost: { blue: 2 }, barrierHp: 45 },
    ],
    hp: 135, energy: { red: 1, blue: 2 }, collisionRadius: 20, className: "Stone Sentinel",
    heightMeters: 2.75, strategy: "rush", cost: 4, tags: ["melee", "tank"],
  },
  "sling-golem": {
    abilities: [
      move(105),
      { id: "sling-golem-hurl", name: "Masonry Hurl", kind: "attack", cost: { red: 2 },
        shape: { kind: "point", range: 260 }, damage: 19, knockback: 15,
        visual: { color: 0x8b7355, trailEffect: "projectile", screenShake: 0.25 } },
      { id: "sling-golem-shove", name: "Rubble Shove", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 55, halfAngle: PI / 3 }, damage: 12, knockback: 35,
        visual: { color: 0x8b7355, trailEffect: "slash", screenShake: 0.2 } },
    ],
    hp: 68, energy: { red: 2, blue: 1 }, collisionRadius: 16, className: "Sling Golem",
    heightMeters: 2.5, strategy: "kite", cost: 3, tags: ["ranged"],
  },
  "shield-golem": {
    abilities: [
      move(102),
      { id: "shield-golem-shove", name: "Slab Shove", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 58, halfAngle: PI / 3 }, damage: 22, knockback: 55,
        visual: { color: 0x74854e, trailEffect: "slash", screenShake: 0.25 } },
      { id: "shield-golem-aegis", name: "Aegis Field", kind: "zone", cost: { blue: 2 }, range: 90,
        zone: { effect: "addBarrier", radius: 60, duration: 3, magnitude: 14, color: 0x4a90c2, pattern: "shield" } },
    ],
    hp: 118, energy: { red: 1, blue: 2 }, collisionRadius: 20, className: "Shield Golem",
    heightMeters: 2.75, strategy: "rush", cost: 4, tags: ["melee", "tank"],
  },

  // ===================== ELITE (cost 6-8) =====================
  "lift-golem": {
    abilities: [
      move(90),
      { id: "lift-golem-grip", name: "Gravity Grip", kind: "attack", cost: { red: 2 },
        shape: { kind: "circle", radius: 45, range: 210 }, damage: 20, knockback: 0,
        onHit: [{ type: "pull", distance: 75 }],
        visual: { color: 0x9b6fd0, trailEffect: "explosion", screenShake: 0.4 } },
      { id: "lift-golem-fling", name: "Repulse Fling", kind: "attack", cost: { red: 2 },
        shape: { kind: "sector", radius: 70, halfAngle: PI / 2 }, damage: 18, knockback: 90,
        wallSlamDamage: 20, visual: { color: 0x9b6fd0, trailEffect: "slash", screenShake: 0.5 } },
    ],
    hp: 150, energy: { red: 2, blue: 1 }, collisionRadius: 20, className: "Lift Golem",
    heightMeters: 3.0, strategy: "threat", cost: 6, tags: ["melee", "elite"],
  },
  "siege-golem": {
    abilities: [
      move(60),
      { id: "siege-golem-crush", name: "Siege Crush", kind: "attack", cost: { red: 2 },
        shape: { kind: "sector", radius: 78, halfAngle: PI / 3 }, damage: 42, knockback: 45,
        wallSlamDamage: 20, visual: { color: 0x5f6f42, trailEffect: "explosion", screenShake: 0.7 } },
      { id: "siege-golem-stomp", name: "Ground Stomp", kind: "attack", cost: { red: 2 },
        shape: { kind: "sector", radius: 90, halfAngle: PI }, damage: 28, knockback: 55,
        visual: { color: 0x5f6f42, trailEffect: "splash", screenShake: 0.8 } },
    ],
    hp: 270, energy: { red: 2, blue: 1 }, collisionRadius: 24, className: "Siege Golem",
    heightMeters: 3.5, strategy: "rush", cost: 8, tags: ["melee", "elite", "tank"],
  },
  "mortar-golem": {
    abilities: [
      move(75),
      { id: "mortar-golem-barrage", name: "Mortar Barrage", kind: "attack", cost: { red: 2 },
        shape: { kind: "circle", radius: 40, range: 250 }, damage: 24, knockback: 20,
        visual: { color: 0x8a7d4a, trailEffect: "explosion", screenShake: 0.5 } },
      { id: "mortar-golem-crack", name: "Barrel Crack", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 60, halfAngle: PI / 3 }, damage: 16, knockback: 30,
        visual: { color: 0x8a7d4a, trailEffect: "slash", screenShake: 0.25 } },
    ],
    hp: 105, energy: { red: 2, blue: 1 }, collisionRadius: 20, className: "Mortar Golem",
    heightMeters: 3.0, strategy: "kite", cost: 7, tags: ["ranged", "elite"],
  },
  "foreman-golem": {
    abilities: [
      move(85),
      { id: "foreman-golem-command", name: "Command Strike", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 72, halfAngle: PI / 3 }, damage: 22, knockback: 25,
        onHit: [{ type: "applyStatus", status: "suppressed", duration: 2, value: 1 }],
        visual: { color: 0x7d8a4e, trailEffect: "slash", screenShake: 0.35 } },
      { id: "foreman-golem-rally", name: "Rally Blare", kind: "attack", cost: { red: 2 },
        shape: { kind: "sector", radius: 80, halfAngle: PI / 2 }, damage: 26, knockback: 40,
        visual: { color: 0x7d8a4e, trailEffect: "splash", screenShake: 0.5 } },
    ],
    hp: 145, energy: { red: 2, blue: 1 }, collisionRadius: 20, className: "Foreman Golem",
    heightMeters: 3.25, strategy: "threat", cost: 7, tags: ["melee", "elite"],
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "chisel-drone", count: 2 } }],
  },

  // ===================== BOSS (cost 12+) =====================
  "stone-colossus": {
    abilities: [
      move(70),
      { id: "stone-colossus-crush", name: "Colossal Crush", kind: "attack", cost: { red: 2 },
        shape: { kind: "sector", radius: 95, halfAngle: PI / 3 }, damage: 48, knockback: 60,
        wallSlamDamage: 30, visual: { color: 0x5a6a3c, trailEffect: "explosion", screenShake: 0.9 } },
      { id: "stone-colossus-quake", name: "Quake Stomp", kind: "attack", cost: { red: 2 },
        shape: { kind: "sector", radius: 110, halfAngle: PI }, damage: 34, knockback: 70,
        visual: { color: 0x5a6a3c, trailEffect: "splash", screenShake: 1.0 } },
    ],
    hp: 420, energy: { red: 2, blue: 1 }, collisionRadius: 28, className: "Stone Colossus",
    heightMeters: 5.0, strategy: "threat", cost: 14, tags: ["melee", "boss", "tank"],
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "mason-golem", count: 2 } }],
  },
  "lift-colossus": {
    abilities: [
      move(75),
      { id: "lift-colossus-well", name: "Gravity Well", kind: "attack", cost: { red: 2 },
        shape: { kind: "circle", radius: 55, range: 240 }, damage: 30, knockback: 0,
        onHit: [{ type: "pull", distance: 95 }],
        visual: { color: 0xa869e0, trailEffect: "explosion", screenShake: 0.7 } },
      { id: "lift-colossus-nova", name: "Repulse Nova", kind: "attack", cost: { red: 2 },
        shape: { kind: "sector", radius: 95, halfAngle: PI }, damage: 28, knockback: 100,
        wallSlamDamage: 25, visual: { color: 0xa869e0, trailEffect: "splash", screenShake: 0.9 } },
    ],
    hp: 360, energy: { red: 2, blue: 1 }, collisionRadius: 28, className: "Lift Colossus",
    heightMeters: 5.0, strategy: "threat", cost: 13, tags: ["melee", "boss"],
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "chisel-drone", count: 3 } }],
  },
  "siege-colossus": {
    abilities: [
      move(80),
      { id: "siege-colossus-charge", name: "Siege Charge", kind: "attack", cost: { red: 2 },
        shape: { kind: "rectangle", length: 150, width: 30 }, damage: 45, knockback: 50,
        wallSlamDamage: 25, visual: { color: 0x596a3a, trailEffect: "explosion", screenShake: 0.9 } },
      { id: "siege-colossus-bombard", name: "Long Bombard", kind: "attack", cost: { red: 2 },
        shape: { kind: "circle", radius: 55, range: 270 }, damage: 35, knockback: 20,
        visual: { color: 0x596a3a, trailEffect: "explosion", screenShake: 0.8 } },
    ],
    hp: 400, energy: { red: 2, blue: 1 }, collisionRadius: 28, className: "Siege Colossus",
    heightMeters: 5.0, strategy: "threat", cost: 14, tags: ["melee", "boss", "tank"],
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "grout-drone", count: 3 } }],
  },
  "foreman-colossus": {
    abilities: [
      move(80),
      { id: "foreman-colossus-decree", name: "Overseer Decree", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 85, halfAngle: PI / 2.5 }, damage: 30, knockback: 40,
        onHit: [{ type: "applyStatus", status: "suppressed", duration: 2, value: 1 }],
        visual: { color: 0x7a8748, trailEffect: "slash", screenShake: 0.5 } },
      { id: "foreman-colossus-warhorn", name: "War Horn", kind: "attack", cost: { red: 2 },
        shape: { kind: "sector", radius: 100, halfAngle: PI }, damage: 24, knockback: 60,
        visual: { color: 0x7a8748, trailEffect: "splash", screenShake: 0.9 } },
    ],
    hp: 340, energy: { red: 2, blue: 1 }, collisionRadius: 26, className: "Foreman Colossus",
    heightMeters: 5.0, strategy: "threat", cost: 15, tags: ["melee", "boss"],
    effects: [
      { trigger: "onDeath", action: { type: "spawn", templateKey: "mason-drone", count: 3 } },
      { trigger: "onDeath", action: { type: "spawn", templateKey: "chisel-drone", count: 2 } },
    ],
  },
};

let ok = 0;
for (const [id, tmpl] of Object.entries(roster)) {
  const parsed = enemyTemplate.safeParse(tmpl);
  if (!parsed.success) {
    console.error(`INVALID ${id}:\n${JSON.stringify(parsed.error.issues, null, 2)}`);
    process.exit(1);
  }
  saveEnemyTemplate(id, DIM, withEnemySprites(DIM, id, parsed.data) as any);
  ok++;
}
console.log(JSON.stringify({ saved: ok, ids: Object.keys(roster) }));
