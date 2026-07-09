// Batch author + upsert all 16 The Escapement (dim 708) enemies.
// Validated against the same zod schema the upsert CLI uses.
import { enemyTemplate } from "./auto/schemas.js";
import { withEnemySprites } from "./auto/enemy-sprites.js";
import { saveEnemyTemplate } from "../server/src/db.js";

const DIM = 708;
const PI = Math.PI;

const move = (distance: number, blue = 1) => ({ id: "move", name: "Move", kind: "move", cost: { blue }, distance });

const roster: Record<string, any> = {
  // ===================== FODDER (cost 1-2) =====================
  "cog-crawler": {
    abilities: [
      move(155),
      { id: "cog-crawler-bite", name: "Gear-Tooth Bite", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 40, halfAngle: PI / 4 }, damage: 12, knockback: 0,
        visual: { color: 0xb08a3c, trailEffect: "slash", screenShake: 0.12 } },
    ],
    hp: 34, energy: { red: 1, blue: 1 }, collisionRadius: 11, className: "Cog Crawler",
    heightMeters: 1.0, strategy: "rush", cost: 1, tags: ["melee", "swarm"],
  },
  "ratchet-hound": {
    abilities: [
      move(175),
      { id: "ratchet-hound-lunge", name: "Ratchet Lunge", kind: "attack", cost: { red: 1 },
        shape: { kind: "rectangle", length: 78, width: 16 }, damage: 16, knockback: 10, lungeThrough: 20,
        visual: { color: 0x9c8748, trailEffect: "thrust", screenShake: 0.18 } },
      { id: "ratchet-hound-snap", name: "Snapping Bite", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 44, halfAngle: PI / 4 }, damage: 14, knockback: 0,
        visual: { color: 0x9c8748, trailEffect: "slash", screenShake: 0.14 } },
    ],
    hp: 42, energy: { red: 1, blue: 2 }, collisionRadius: 12, className: "Ratchet Hound",
    heightMeters: 1.2, strategy: "rush", cost: 2, tags: ["melee", "swarm"],
  },
  "winder-acolyte": {
    abilities: [
      move(120),
      { id: "winder-acolyte-flask", name: "Oil Flask", kind: "attack", cost: { red: 1 },
        shape: { kind: "point", range: 165 }, damage: 15, knockback: 0,
        visual: { color: 0x6b4a1f, trailEffect: "projectile", screenShake: 0.1 } },
      { id: "winder-acolyte-slick", name: "Burning Slick", kind: "zone", cost: { red: 1 }, range: 150,
        zone: { effect: "damage", radius: 58, duration: 4, magnitude: 12, color: 0xd06a1e, pattern: "spikes" } },
    ],
    hp: 40, energy: { red: 2, blue: 1 }, collisionRadius: 12, className: "Winder Acolyte",
    heightMeters: 1.75, strategy: "kite", cost: 2, tags: ["ranged", "swarm"],
  },
  "chime-bat": {
    abilities: [
      move(185),
      { id: "chime-bat-dive", name: "Chiming Dive", kind: "attack", cost: { red: 1 },
        shape: { kind: "rectangle", length: 62, width: 14 }, damage: 13, knockback: 8, lungeThrough: 15,
        visual: { color: 0xc9a94e, trailEffect: "thrust", screenShake: 0.12 } },
    ],
    hp: 28, energy: { red: 1, blue: 2 }, collisionRadius: 10, className: "Chime Bat",
    heightMeters: 1.0, strategy: "rush", cost: 1, tags: ["melee", "swarm"],
  },

  // ===================== STANDARD (cost 3-4) =====================
  "winder-zealot": {
    abilities: [
      move(120),
      { id: "winder-zealot-swing", name: "Spanner Swing", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 56, halfAngle: 0.9 }, damage: 26, knockback: 32,
        visual: { color: 0x8f7a3e, trailEffect: "slash", screenShake: 0.28 } },
      { id: "winder-zealot-overhead", name: "Cranking Overhead", kind: "attack", cost: { red: 2 },
        shape: { kind: "rectangle", length: 70, width: 22 }, damage: 38, knockback: 20, wallSlamDamage: 16,
        visual: { color: 0x8f7a3e, trailEffect: "explosion", screenShake: 0.45 } },
    ],
    hp: 85, energy: { red: 2, blue: 1 }, collisionRadius: 15, className: "Winder Zealot",
    heightMeters: 2.0, strategy: "rush", cost: 3, tags: ["melee"],
  },
  "watchman": {
    abilities: [
      move(100),
      { id: "watchman-sweep", name: "Halberd Sweep", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 72, halfAngle: 1.0 }, damage: 25, knockback: 26,
        visual: { color: 0xb59a55, trailEffect: "slash", screenShake: 0.3 } },
      { id: "watchman-thrust", name: "Halberd Thrust", kind: "attack", cost: { red: 1 },
        shape: { kind: "rectangle", length: 112, width: 16 }, damage: 32, knockback: 12,
        onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 0.4 }],
        visual: { color: 0xb59a55, trailEffect: "thrust", screenShake: 0.32 } },
    ],
    hp: 115, energy: { red: 2, blue: 1 }, collisionRadius: 16, className: "Watchman",
    heightMeters: 2.25, strategy: "rush", cost: 4, tags: ["melee", "tank"],
  },
  "rivet-gunner": {
    abilities: [
      move(110),
      { id: "rivet-gunner-burst", name: "Rivet Burst", kind: "attack", cost: { red: 1 },
        shape: { kind: "point", range: 175 }, damage: 22, knockback: 0,
        visual: { color: 0xa8933f, trailEffect: "projectile", screenShake: 0.12 } },
      { id: "rivet-gunner-spray", name: "Suppressive Spray", kind: "attack", cost: { red: 2 },
        shape: { kind: "sector", radius: 110, halfAngle: 0.5 }, damage: 18, knockback: 0,
        onHit: [{ type: "applyStatus", status: "suppressed", duration: 2, value: 1 }],
        visual: { color: 0xa8933f, trailEffect: "projectile", screenShake: 0.2 } },
    ],
    hp: 74, energy: { red: 2, blue: 1 }, collisionRadius: 14, className: "Rivet Gunner",
    heightMeters: 1.75, strategy: "kite", cost: 3, tags: ["ranged"],
  },
  "brass-guard": {
    abilities: [
      move(80),
      { id: "brass-guard-bash", name: "Shield Bash", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 46, halfAngle: PI / 5 }, damage: 22, knockback: 40, wallSlamDamage: 14,
        visual: { color: 0x8a8f6a, trailEffect: "slash", screenShake: 0.3 } },
      { id: "brass-guard-wall", name: "Tower Shield", kind: "barrier", cost: { blue: 1 }, barrierHp: 55 },
      { id: "brass-guard-cover", name: "Shielding Line", kind: "zone", cost: { blue: 2 }, range: 90,
        zone: { effect: "addBarrier", radius: 85, duration: 3, magnitude: 22, color: 0xc8c078, pattern: "shield" } },
    ],
    hp: 135, energy: { red: 1, blue: 2 }, collisionRadius: 18, className: "Brass Guard",
    heightMeters: 2.25, strategy: "rush", cost: 4, tags: ["melee", "tank"],
  },

  // ===================== ELITE (cost 5-6) =====================
  "winder-priest": {
    abilities: [
      move(115),
      { id: "winder-priest-key", name: "Key-Turn Strike", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 52, halfAngle: PI / 4 }, damage: 26, knockback: 20,
        onHit: [{ type: "applyStatus", status: "winded", duration: 2, value: 1 }],
        visual: { color: 0x7a6a3a, trailEffect: "slash", screenShake: 0.24 } },
      { id: "winder-priest-mend", name: "Winding Mend", kind: "zone", cost: { blue: 2 }, range: 130,
        zone: { effect: "heal", radius: 62, duration: 3, magnitude: 12, color: 0xf0d060, pattern: "pulse" } },
      { id: "winder-priest-overwind", name: "Overwind Ward", kind: "zone", cost: { blue: 2 }, range: 110,
        zone: { effect: "addBarrier", radius: 70, duration: 3, magnitude: 20, color: 0xe0cf8a, pattern: "shield" } },
    ],
    hp: 120, energy: { red: 1, blue: 3 }, collisionRadius: 15, className: "Winder Priest",
    heightMeters: 2.25, strategy: "kite", cost: 5, tags: ["ranged", "elite"],
  },
  "piston-golem": {
    abilities: [
      move(70),
      { id: "piston-golem-smash", name: "Piston Smash", kind: "attack", cost: { red: 2 },
        shape: { kind: "point", range: 48 }, damage: 56, knockback: 24, wallSlamDamage: 26,
        visual: { color: 0x9a7d3c, trailEffect: "explosion", screenShake: 0.8 } },
      { id: "piston-golem-pound", name: "Ground Pound", kind: "attack", cost: { red: 2 },
        shape: { kind: "sector", radius: 68, halfAngle: 1.2 }, damage: 30, knockback: 44,
        visual: { color: 0x9a7d3c, trailEffect: "explosion", screenShake: 0.6 } },
    ],
    hp: 205, energy: { red: 3, blue: 1 }, collisionRadius: 22, className: "Piston Golem",
    heightMeters: 3.0, strategy: "rush", cost: 6, tags: ["melee", "tank", "elite"],
  },
  "steam-lancer": {
    abilities: [
      move(205),
      { id: "steam-lancer-charge", name: "Steam Charge", kind: "attack", cost: { red: 2 },
        shape: { kind: "rectangle", length: 150, width: 18 }, damage: 38, knockback: 16, lungeThrough: 45,
        visual: { color: 0x9fb0b6, trailEffect: "thrust", screenShake: 0.6 } },
      { id: "steam-lancer-thrust", name: "Lance Thrust", kind: "attack", cost: { red: 1 },
        shape: { kind: "rectangle", length: 100, width: 14 }, damage: 24, knockback: 12,
        visual: { color: 0x9fb0b6, trailEffect: "thrust", screenShake: 0.3 } },
    ],
    hp: 105, energy: { red: 2, blue: 2 }, collisionRadius: 15, className: "Steam Lancer",
    heightMeters: 2.0, strategy: "rush", cost: 5, tags: ["melee", "elite"],
  },
  "sweeper": {
    abilities: [
      move(110),
      { id: "sweeper-blade", name: "Sweeping Blade", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 86, halfAngle: 1.55 }, damage: 32, knockback: 30,
        visual: { color: 0xb0863a, trailEffect: "slash", screenShake: 0.4 } },
      { id: "sweeper-sparks", name: "Spark Spray", kind: "zone", cost: { red: 2 }, range: 120,
        zone: { effect: "damage", radius: 56, duration: 3, magnitude: 13, color: 0xffb040, pattern: "spikes" } },
    ],
    hp: 130, energy: { red: 2, blue: 1 }, collisionRadius: 18, className: "Sweeper",
    heightMeters: 2.0, strategy: "rush", cost: 5, tags: ["melee", "elite"],
  },

  // ===================== BOSS (cost 7+) =====================
  "shepherd-engine": {
    abilities: [
      move(90),
      { id: "shepherd-engine-plow", name: "Plow Sweep", kind: "attack", cost: { red: 2 },
        shape: { kind: "rectangle", length: 180, width: 58 }, damage: 44, knockback: 58, wallSlamDamage: 28,
        visual: { color: 0x8a6f34, trailEffect: "explosion", screenShake: 0.9 } },
      { id: "shepherd-engine-grind", name: "Grinding Advance", kind: "attack", cost: { red: 2 },
        shape: { kind: "rectangle", length: 140, width: 40 }, damage: 30, knockback: 20, lungeThrough: 30,
        onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 0.5 }],
        visual: { color: 0x8a6f34, trailEffect: "thrust", screenShake: 0.7 } },
      { id: "shepherd-engine-debris", name: "Debris Crush", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 92, halfAngle: 1.2 }, damage: 34, knockback: 40,
        visual: { color: 0x8a6f34, trailEffect: "explosion", screenShake: 0.6 } },
    ],
    hp: 420, energy: { red: 3, blue: 1 }, collisionRadius: 28, className: "Shepherd Engine",
    heightMeters: 5.0, strategy: "threat", cost: 13, tags: ["melee", "boss"],
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "cog-crawler", count: 3 } }],
  },
  "foreman": {
    abilities: [
      move(90),
      { id: "foreman-slam", name: "Work-Order Slam", kind: "attack", cost: { red: 2 },
        shape: { kind: "sector", radius: 74, halfAngle: 1.1 }, damage: 32, knockback: 34,
        visual: { color: 0x9c8340, trailEffect: "explosion", screenShake: 0.55 } },
      { id: "foreman-rivets", name: "Rivet Volley", kind: "attack", cost: { red: 1 },
        shape: { kind: "point", range: 190 }, damage: 22, knockback: 0,
        visual: { color: 0x9c8340, trailEffect: "projectile", screenShake: 0.14 } },
      { id: "foreman-repair", name: "Repair Field", kind: "zone", cost: { blue: 2 }, range: 140,
        zone: { effect: "heal", radius: 72, duration: 4, magnitude: 14, color: 0xf0d060, pattern: "pulse" } },
    ],
    hp: 300, energy: { red: 2, blue: 2 }, collisionRadius: 24, className: "Foreman",
    heightMeters: 3.5, strategy: "threat", cost: 11, tags: ["melee", "boss"],
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "ratchet-hound", count: 3 } }],
  },
  "winder-prophet": {
    abilities: [
      move(110),
      { id: "winder-prophet-lash", name: "Gear-Crown Lash", kind: "attack", cost: { red: 1 },
        shape: { kind: "sector", radius: 62, halfAngle: 1.0 }, damage: 28, knockback: 24,
        onHit: [{ type: "applyStatus", status: "suppressed", duration: 2, value: 1 }],
        visual: { color: 0x7a6a3a, trailEffect: "slash", screenShake: 0.4 } },
      { id: "winder-prophet-spring", name: "Churning Spring", kind: "zone", cost: { blue: 2 }, range: 130,
        zone: { effect: "heal", radius: 66, duration: 4, magnitude: 16, color: 0xf0d060, pattern: "pulse" } },
      { id: "winder-prophet-fervor", name: "Fervor Ward", kind: "zone", cost: { blue: 2 }, range: 120,
        zone: { effect: "addBarrier", radius: 82, duration: 3, magnitude: 26, color: 0xe0cf8a, pattern: "shield" } },
    ],
    hp: 280, energy: { red: 2, blue: 3 }, collisionRadius: 20, className: "Winder Prophet",
    heightMeters: 2.5, strategy: "threat", cost: 11, tags: ["ranged", "boss"],
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "winder-acolyte", count: 3 } }],
  },
  "coil-colossus": {
    abilities: [
      move(90),
      { id: "coil-colossus-lash", name: "Spring-Steel Lash", kind: "attack", cost: { red: 2 },
        shape: { kind: "rectangle", length: 200, width: 20 }, damage: 36, knockback: 20,
        onHit: [{ type: "pull", distance: 70 }],
        visual: { color: 0xb0b6bd, trailEffect: "thrust", screenShake: 0.7 } },
      { id: "coil-colossus-uncoil", name: "Uncoil Sweep", kind: "attack", cost: { red: 2 },
        shape: { kind: "sector", radius: 110, halfAngle: 1.3 }, damage: 30, knockback: 42,
        visual: { color: 0xb0b6bd, trailEffect: "slash", screenShake: 0.6 } },
      { id: "coil-colossus-snap", name: "Spring Snap", kind: "attack", cost: { red: 1 },
        shape: { kind: "rectangle", length: 160, width: 16 }, damage: 30, knockback: 14,
        onHit: [{ type: "applyStatus", status: "slowed", duration: 2, value: 0.4 }],
        visual: { color: 0xb0b6bd, trailEffect: "thrust", screenShake: 0.45 } },
    ],
    hp: 305, energy: { red: 3, blue: 2 }, collisionRadius: 26, className: "Coil Colossus",
    heightMeters: 5.0, strategy: "threat", cost: 12, tags: ["ranged", "boss"],
    effects: [{ trigger: "onDeath", action: { type: "spawn", templateKey: "chime-bat", count: 3 } }],
  },
};

let ok = 0;
for (const [id, tpl] of Object.entries(roster)) {
  const parsed = enemyTemplate.safeParse(tpl);
  if (!parsed.success) {
    console.error(`INVALID ${id}:\n${JSON.stringify(parsed.error.issues, null, 2)}`);
    process.exit(1);
  }
  saveEnemyTemplate(id, DIM, withEnemySprites(DIM, id, parsed.data) as any);
  ok++;
}
console.log(JSON.stringify({ saved: ok, ids: Object.keys(roster) }));
