/**
 * Adaptive music for dimension 706 "Verdant Colossus" — one 48-bar composition rendered as
 * three sample-aligned stems that sum to the full combat arrangement:
 *
 *   calm   jungle ambience (crickets, birds, wind), warm pads on the section harmony,
 *          kalimba statements of the Colossus motif, all the flute lines. Stands alone
 *          as exploration music.
 *   pulse  log drums, shaker, congas, the 8th-note bass ostinato — the groove skeleton.
 *   war    taikos, gongs, risers, big fills, string chug, dark drones, the motif on low brass.
 *
 * Same grid as dim-706-combat-music.ts: 152 BPM, D phrygian, 48 bars, INTRO A1 B A2 BREAK A3.
 * Every stem is a sample-exact loop (tails wrap, effects run two circular passes) and all
 * three share one engine instance, so lengths are identical by construction. All stems are
 * scaled by one common factor chosen so that NO subset of stems clips.
 *
 *   bun dimension-generator/dim-706-adaptive-music.ts <outDir>   -> dim-706-{calm,pulse,war}.wav + full-mix.wav
 */

import { createEngine, writeWav, SR, type Bus } from "./dim-706-engine.js";

const e = createEngine({ seed: 0x2f5d34, bpm: 152, bars: 48 });
const { BEAT, TOTAL, rng, secAt, put } = e;
const mtof = e.mtof;
const cents = e.cents;

// calm
const calmAmb = e.bus();
const calmPad = e.bus();
const calmMel = e.bus(); // kalimba + flute (gets the dotted-8th ping-pong)
// pulse
const pulseDrums = e.bus();
const pulseBass = e.bus();
// war
const warDrums = e.bus();
const warMusic = e.bus(); // chug + drone
const warLead = e.bus(); // brass stabs (ping-pong)

// ------------------------------------------------------- calm instruments ----

/** Warm additive pad: detuned voice pairs, slow swell. The exploration layer's harmony. */
function pad(t: number, durBeats: number, midis: number[], vel: number): void {
  const dur = durBeats * BEAT;
  const n = Math.round((dur + 1.4) * SR);
  for (const midi of midis) {
    for (const det of [-4, 4]) {
      const out = new Float64Array(n);
      const f = mtof(midi) * cents(det);
      let phase = rng() * 6.28;
      const tremF = 0.11 + rng() * 0.07;
      for (let i = 0; i < n; i++) {
        const dt = i / SR;
        phase += (2 * Math.PI * f) / SR;
        const trem = 1 + 0.12 * Math.sin(2 * Math.PI * tremF * dt + phase * 1e-9);
        const env = Math.min(1, dt / 1.4) * (dt < dur ? 1 : Math.max(0, 1 - (dt - dur) / 1.2));
        out[i] = (Math.sin(phase) + 0.35 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase)) * env * trem;
      }
      put(calmPad, t, out, det > 0 ? 0.35 : -0.35, 0.05 * vel);
    }
  }
}

/** Soft sine sub swell under the pads so the calm layer has low-end warmth on its own. */
function sub(t: number, durBeats: number, midi: number, vel: number): void {
  const dur = durBeats * BEAT;
  const n = Math.round((dur + 1.0) * SR);
  const out = new Float64Array(n);
  const f = mtof(midi);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    phase += (2 * Math.PI * f) / SR;
    const env = Math.min(1, dt / 0.9) * (dt < dur ? 1 : Math.max(0, 1 - (dt - dur) / 0.9));
    out[i] = Math.sin(phase) * env;
  }
  put(calmPad, t, out, 0, 0.15 * vel);
}

/** Kalimba pluck: fundamental + inharmonic tine partials + thumb click. */
function kalimba(t: number, midi: number, vel: number): void {
  const n = Math.round(1.1 * SR);
  const out = new Float64Array(n);
  const f = mtof(midi);
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    p1 += (2 * Math.PI * f) / SR;
    p2 += (2 * Math.PI * f * 3.93) / SR;
    p3 += (2 * Math.PI * f * 6.68) / SR;
    const atk = Math.min(1, i / (0.0012 * SR));
    const s =
      Math.sin(p1) * Math.exp(-dt / 0.55) +
      Math.sin(p2) * Math.exp(-dt / 0.09) * 0.45 +
      Math.sin(p3) * Math.exp(-dt / 0.035) * 0.22 +
      (rng() * 2 - 1) * Math.exp(-dt / 0.003) * 0.25;
    out[i] = s * atk;
  }
  put(calmMel, t, out, ((midi - 74) / 14) * 0.5 + 0.08, 0.3 * vel);
}

/** A short bird call: a few upward sine chirps, high and quiet. */
function bird(t: number, pan: number): void {
  const syllables = 2 + Math.floor(rng() * 3);
  let off = 0;
  for (let s = 0; s < syllables; s++) {
    const durS = 0.05 + rng() * 0.045;
    const n = Math.round(durS * SR);
    const out = new Float64Array(n);
    const f1 = 2600 + rng() * 1000;
    const f2 = f1 + 350 + rng() * 700;
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const f = f1 + (f2 - f1) * x;
      phase += (2 * Math.PI * f) / SR;
      const env = Math.sin(Math.PI * x) ** 1.5;
      out[i] = Math.sin(phase) * env;
    }
    put(calmAmb, t + off, out, pan, 0.045 + rng() * 0.025);
    off += durS + 0.07 + rng() * 0.09;
  }
}

/** Cricket voice: bursts of 30ish-Hz amplitude-modulated sine, scattered across the loop. */
function crickets(carrier: number, pan: number, density: number): void {
  const rate = 26 + rng() * 9;
  let t = rng() * 0.8;
  const durTotal = TOTAL / SR;
  while (t < durTotal) {
    const burst = 0.35 + rng() * 0.5;
    const n = Math.round(burst * SR);
    const out = new Float64Array(n);
    let phase = rng() * 6.28;
    for (let i = 0; i < n; i++) {
      const dt = i / SR;
      const x = i / n;
      phase += (2 * Math.PI * carrier * (1 + 0.006 * Math.sin(2 * Math.PI * 3 * dt))) / SR;
      const am = Math.max(0, Math.sin(2 * Math.PI * rate * dt)) ** 2;
      out[i] = Math.sin(phase) * am * Math.sin(Math.PI * x) ** 0.7;
    }
    put(calmAmb, t, out, pan, 0.014 + rng() * 0.008);
    t += burst + (0.5 + rng() * 1.4) / density;
  }
}

/** Full-length lowpassed noise wash. LFO cycle counts are integers so the seam is level-continuous. */
function wind(): void {
  const lfo1 = (2 * Math.PI * 5) / TOTAL;
  const lfo2 = (2 * Math.PI * 13) / TOTAL;
  let lp = 0;
  let lp2 = 0;
  for (let i = -1000; i < TOTAL; i++) {
    const nz = rng() * 2 - 1;
    lp += 0.045 * (nz - lp);
    lp2 += 0.03 * (lp - lp2);
    if (i < 0) continue;
    const sw = 0.6 + 0.28 * Math.sin(lfo1 * i) + 0.12 * Math.sin(lfo2 * i + 1.7);
    calmAmb.L[i]! += lp2 * sw * 0.055;
    calmAmb.R[i]! += lp2 * sw * 0.055 * (0.6 + 0.28 * Math.sin(lfo1 * i + 2.4) + 0.12 * Math.sin(lfo2 * i + 4.0)) * 1.4;
  }
}

// ------------------------------------------------------------ shared score ----

const D2 = 38;
const D3 = 50;
const D5 = 74;

type Fig = [number, number, number][];
const MOTIF: Fig = [
  [0, 0.45, 0],
  [0.5, 0.45, 0],
  [1, 0.95, 3],
  [2, 0.45, 1],
  [2.5, 0.45, 0],
  [3, 0.95, -2],
  [4, 0.45, 0],
  [4.5, 0.45, 0],
  [5, 0.45, 3],
  [5.5, 0.45, 5],
];
const ENDINGS: Record<string, Fig> = {
  A: [
    [6, 1.35, 7],
    [7.5, 0.45, 1],
  ],
  B: [
    [6, 0.45, 5],
    [6.5, 0.45, 3],
    [7, 0.9, 1],
  ],
  rise: [
    [6, 0.9, 7],
    [7, 0.45, 8],
    [7.5, 0.45, 10],
  ],
};

function brassMotif(barIdx: number, root: number, vel: number, ending: keyof typeof ENDINGS, octaveDouble: boolean): void {
  for (const [b, len, st] of [...MOTIF, ...ENDINGS[ending]!]) {
    e.stab(warLead, secAt(barIdx, b), len, root + st, vel);
    if (octaveDouble) e.stab(warLead, secAt(barIdx, b), len, root + st + 12, vel * 0.55);
  }
}

function kalimbaMotif(barIdx: number, vel: number, ending: keyof typeof ENDINGS): void {
  for (const [b, len, st] of [...MOTIF, ...ENDINGS[ending]!]) {
    kalimba(secAt(barIdx, b), D5 + st, vel * (len > 0.9 ? 1.1 : 1));
  }
}

interface Groove {
  taiko?: "full" | "sparse";
  logs?: boolean;
  shaker?: boolean;
  conga?: "back" | "busy";
  fill?: "light" | "big";
  vel?: number;
}

const LOG_TEMPLATES: [number, number, number][][] = [
  [
    [2, 50, 0.7],
    [7, 45, 0.6],
    [10, 53, 0.65],
  ],
  [
    [5, 48, 0.6],
    [9, 50, 0.7],
    [13, 45, 0.6],
  ],
  [
    [2, 50, 0.6],
    [6, 53, 0.7],
    [10, 48, 0.6],
    [13, 50, 0.5],
  ],
];

/** Same groove as the combat track, but routed: taikos/big fills -> war, hand percussion -> pulse. */
function grooveBar(barIdx: number, g: Groove): void {
  const v = g.vel ?? 1;
  const step = (s: number): number => secAt(barIdx, s / 4);
  if (g.taiko === "full") {
    for (const s of [0, 3, 6, 8, 11, 14]) e.taiko(warDrums, step(s), (s === 0 || s === 8 ? 1 : 0.72) * v);
  } else if (g.taiko === "sparse") {
    for (const s of [0, 6, 8, 14]) e.taiko(warDrums, step(s), (s === 0 ? 0.85 : 0.6) * v);
  }
  if (g.logs) {
    for (const [s, m, lv] of LOG_TEMPLATES[Math.floor(rng() * LOG_TEMPLATES.length)]!) e.logDrum(pulseDrums, step(s), m, lv * v);
  }
  if (g.shaker) {
    for (let s = 0; s < 16; s++) e.shaker(pulseDrums, step(s), (s % 4 === 0 ? 0.6 : s % 2 === 0 ? 0.45 : 0.26) * v);
  }
  if (g.conga === "back") {
    e.conga(pulseDrums, step(4), 0.7 * v, false);
    e.conga(pulseDrums, step(12), 0.85 * v, false);
    if (rng() < 0.5) e.conga(pulseDrums, step(rng() < 0.5 ? 7 : 15), 0.3 * v, true);
  } else if (g.conga === "busy") {
    for (const [s, cv, sl] of [
      [2, 0.5, 1],
      [4, 0.7, 0],
      [7, 0.4, 1],
      [10, 0.5, 1],
      [12, 0.8, 0],
      [15, 0.35, 1],
    ] as const) {
      e.conga(pulseDrums, step(s), cv * v, sl === 1);
    }
  }
  if (g.fill === "light") {
    for (let i = 0; i < 4; i++) e.logDrum(pulseDrums, step(12 + i), [53, 50, 48, 45][i]!, (0.65 + i * 0.07) * v);
  } else if (g.fill === "big") {
    for (let i = 0; i < 8; i++) {
      const s = step(8 + i);
      if (i % 2 === 0) e.taiko(warDrums, s, (0.6 + i * 0.05) * v);
      e.logDrum(warDrums, s, [45, 48, 50, 53, 50, 53, 55, 57][i]!, (0.55 + i * 0.06) * v);
    }
  }
}

function bassBar(barIdx: number, rootMidi: number, phrygian: boolean, vel: number): void {
  const offs = phrygian ? [0, 0, 0, 1, 0, 0, -2, 0] : [0, 0, 0, 0, 7, 0, 0, 0];
  for (let i = 0; i < 8; i++) {
    e.bass(pulseBass, secAt(barIdx, i * 0.5), 0.42, rootMidi + offs[i]!, (i === 0 ? 1 : 0.8) * vel);
  }
}

function chugBar(barIdx: number, rootMidi: number, vel: number): void {
  for (let i = 0; i < 8; i++) {
    const accent = i === 0 || i === 3 || i === 6 ? 1 : 0.72;
    e.chug(warMusic, secAt(barIdx, i * 0.5), rootMidi, accent * vel);
    e.chug(warMusic, secAt(barIdx, i * 0.5), rootMidi + 7, accent * vel * 0.7);
  }
}

const flute = (t: number, durBeats: number, midi: number, vel: number): void => e.flute(calmMel, t, durBeats, midi, vel);

/** Sparse kalimba figure over the current chord — the calm layer's background motion. */
function kalArp(barIdx: number, tones: number[], vel: number): void {
  const patterns: number[][] = [
    [0, 1.5, 2.5],
    [0.5, 2, 3],
    [0, 2, 3.5],
  ];
  const pat = patterns[Math.floor(rng() * patterns.length)]!;
  for (let k = 0; k < pat.length; k++) {
    const tone = tones[Math.floor(rng() * tones.length)]!;
    kalimba(secAt(barIdx, pat[k]!), tone, vel * (0.8 + rng() * 0.4));
  }
}

// ================================ PULSE + WAR: the combat arrangement, split ====

// ---- INTRO (0-7) ----
e.gong(warDrums, 0, 0.9);
e.drone(warMusic, 0, 32, D2, 1);
for (let b = 0; b < 8; b++) {
  grooveBar(b, {
    taiko: "full",
    logs: b >= 1,
    shaker: b >= 2,
    conga: b >= 4 ? "back" : undefined,
    fill: b === 3 ? "light" : b === 7 ? "big" : undefined,
    vel: 0.85 + b * 0.02,
  });
  if (b >= 2) bassBar(b, D2, true, 0.9);
}
for (const b of [4, 5, 6]) e.stab(warLead, secAt(b, 0), 0.4, D3, 0.5);
e.stab(warLead, secAt(7, 3), 0.45, D3 + 1, 0.55);
e.stab(warLead, secAt(7, 3.5), 0.45, D3 - 2, 0.55);

// ---- A1 (8-15) ----
for (let b = 8; b < 16; b++) {
  grooveBar(b, { taiko: "full", logs: true, shaker: true, conga: "back", fill: b === 15 ? "big" : b % 4 === 3 ? "light" : undefined });
  bassBar(b, D2, true, 1);
  chugBar(b, D3, 0.8);
}
brassMotif(8, D3, 0.78, "A", false);
brassMotif(10, D3, 0.78, "B", false);
brassMotif(12, D3, 0.82, "A", false);
brassMotif(14, D3, 0.85, "rise", false);

// ---- B (16-23) ----
e.gong(warDrums, secAt(16, 0), 0.6);
const B_ROOTS = [43, 43, 46, 46, 48, 48, 51, 51]; // G, G, Bb, Bb, C, C, Eb, Eb — rising under D
for (let i = 0; i < 8; i++) {
  const b = 16 + i;
  grooveBar(b, { taiko: "full", logs: i >= 2, shaker: true, conga: "back", fill: i === 7 ? "big" : i === 3 ? "light" : undefined, vel: 0.92 });
  bassBar(b, B_ROOTS[i]! - 12, false, 0.95);
  chugBar(b, B_ROOTS[i]! + 12, 0.72);
}
for (const b of [17, 19, 21]) e.stab(warLead, secAt(b, 3.5), 0.45, B_ROOTS[b - 16]! + 12, 0.6);
e.riser(warDrums, secAt(22, 0), 8, 0.9);

// ---- A2 (24-31) ----
e.gong(warDrums, secAt(24, 0), 0.9);
for (let b = 24; b < 32; b++) {
  grooveBar(b, { taiko: "full", logs: true, shaker: true, conga: "back", fill: b === 31 ? "big" : b % 4 === 3 ? "light" : undefined, vel: 1.05 });
  bassBar(b, D2, true, 1.05);
  chugBar(b, D3, 0.9);
}
brassMotif(24, D3, 0.9, "A", true);
brassMotif(26, D3, 0.9, "B", true);
brassMotif(28, D3, 0.95, "A", true);
brassMotif(30, D3, 0.95, "rise", true);

// ---- BREAK (32-39) ----
e.gong(warDrums, secAt(32, 0), 0.7, 61.7);
e.drone(warMusic, secAt(32, 0), 16, D2 + 1, 1.1);
e.drone(warMusic, secAt(36, 0), 16, D2, 1.1);
for (let i = 0; i < 8; i++) {
  const b = 32 + i;
  const rebuilding = i >= 4;
  grooveBar(b, {
    taiko: rebuilding ? "full" : "sparse",
    logs: rebuilding,
    shaker: rebuilding,
    conga: "busy",
    fill: i === 7 ? "big" : undefined,
    vel: rebuilding ? 0.9 : 0.7,
  });
  if (rebuilding) bassBar(b, D2, true, 0.9);
  else e.bass(pulseBass, secAt(b, 0), 3.6, D2 + (i < 4 ? 1 : 0), 0.75);
}
e.riser(warDrums, secAt(38, 0), 8, 1);

// ---- A3 (40-47) ----
e.gong(warDrums, secAt(40, 0), 0.9);
for (let b = 40; b < 48; b++) {
  grooveBar(b, { taiko: "full", logs: true, shaker: true, conga: "back", fill: b % 4 === 3 && b !== 47 ? "light" : undefined, vel: 1.1 });
  bassBar(b, D2, true, 1.1);
  chugBar(b, D3, 0.95);
}
brassMotif(40, D3, 1, "A", true);
brassMotif(42, D3, 1, "B", true);
brassMotif(44, D3, 1, "A", true);
for (const [b, len, st] of MOTIF) {
  e.stab(warLead, secAt(46, b), len, D3 + st, 1);
  e.stab(warLead, secAt(46, b), len, D3 + st + 12, 0.55);
}
e.stab(warLead, secAt(47, 2), 0.9, D3 + 7, 1);
e.stab(warLead, secAt(47, 3), 0.45, D3 + 8, 1);
e.stab(warLead, secAt(47, 3.5), 0.45, D3 + 10, 1.05);
for (let i = 0; i < 8; i++) {
  const s = secAt(47, 2 + i * 0.25);
  if (i % 2 === 0) e.taiko(warDrums, s, 0.65 + i * 0.05);
  e.logDrum(warDrums, s, [45, 48, 50, 53, 55, 57, 58, 62][i]!, 0.6 + i * 0.05);
}

// ============================== CALM: the exploration layer =====================

// Jungle ambience across the whole loop.
wind();
crickets(4150, -0.6, 1);
crickets(4750, 0.55, 0.8);
crickets(5400, 0.1, 0.55);
const BIRD_BARS = [1, 3.5, 6, 9.5, 13, 17.5, 21, 25.5, 29, 33.5, 37, 41.5, 45.5];
for (let i = 0; i < BIRD_BARS.length; i++) {
  bird(secAt(Math.floor(BIRD_BARS[i]!), (BIRD_BARS[i]! % 1) * 4 + rng()), (i % 2 === 0 ? -1 : 1) * (0.45 + rng() * 0.35));
}

// Pad harmony: the same journey the combat bass walks (D pedal, the B-section rise, Eb break).
const PADS: [number, number, number[], number][] = [
  [0, 16, [50, 57, 62], 0.75],
  [4, 16, [50, 57, 60, 65], 0.9],
  [8, 16, [50, 57, 62, 65], 0.9],
  [12, 16, [50, 55, 60, 63], 0.9],
  [16, 8, [55, 58, 62], 0.95],
  [18, 8, [58, 62, 65], 0.95],
  [20, 8, [60, 63, 67], 0.95],
  [22, 8, [63, 67, 70], 1],
  [24, 16, [57, 62, 65, 69], 0.95],
  [28, 16, [50, 57, 62, 65], 0.9],
  [32, 16, [51, 58, 63], 0.95],
  [36, 16, [50, 57, 62], 0.85],
  [40, 16, [50, 57, 62, 65], 0.95],
  [44, 16, [50, 57, 60, 65], 0.95],
];
for (const [bar, durBeats, midis, vel] of PADS) pad(secAt(bar, 0), durBeats, midis, vel);

const SUB_ROOTS = [38, 38, 38, 38, 38, 38, 38, 38, 31, 34, 36, 39, 38, 38, 38, 38, 39, 39, 38, 38, 38, 38, 38, 38];
for (let i = 0; i < 24; i++) sub(secAt(i * 2, 0), 8, SUB_ROOTS[i]!, 0.8);

// Kalimba: motif statements where the brass states it, gentle chord figures between.
kalimbaMotif(8, 0.8, "A");
kalimbaMotif(12, 0.75, "B");
kalimbaMotif(24, 0.85, "A");
kalimbaMotif(28, 0.85, "rise");
kalimbaMotif(40, 0.9, "A");
kalimbaMotif(44, 0.85, "B");
const D_TONES = [74, 69, 72, 77, 81];
const B_TONES: number[][] = [
  [67, 70, 74, 79],
  [70, 74, 77, 82],
  [72, 75, 79, 84],
  [75, 79, 82, 87],
];
for (const b of [2, 3, 4, 5, 6, 7, 10, 11, 14, 15]) kalArp(b, D_TONES, 0.5);
for (let i = 0; i < 8; i++) kalArp(16 + i, B_TONES[Math.floor(i / 2)]!, 0.55);
for (const b of [26, 27, 30, 31, 42, 43, 46, 47]) kalArp(b, D_TONES, 0.5);
for (const b of [32, 34, 36, 38]) kalArp(b, b < 36 ? [75, 70, 79, 82] : D_TONES, 0.4);

// Flute: an intro statement of the motif head, then the combat track's B / break / A3 lines.
const INTRO_FLUTE: [number, number, number, number][] = [
  [4, 0, 74, 0.45],
  [4, 0.5, 74, 0.45],
  [4, 1, 77, 1.9],
  [6, 0, 75, 0.45],
  [6, 0.5, 74, 0.45],
  [6, 1, 72, 1.9],
];
const B_FLUTE: [number, number, number, number][] = [
  [16, 0, 74, 2],
  [16, 2, 77, 1],
  [16, 3, 75, 1],
  [17, 0, 74, 2],
  [17, 2, 72, 2],
  [18, 0, 74, 1.5],
  [18, 1.5, 77, 0.5],
  [18, 2, 79, 2],
  [19, 0, 77, 2.5],
  [19, 3, 74, 1],
  [20, 0, 79, 2],
  [20, 2, 81, 1],
  [20, 3, 82, 1],
  [21, 0, 81, 2],
  [21, 2, 79, 1],
  [21, 3, 77, 1],
  [22, 0, 82, 2],
  [22, 2, 79, 1],
  [22, 3, 75, 1],
  [23, 0, 81, 4],
];
const BREAK_FLUTE: [number, number, number, number][] = [
  [33, 0, 74, 0.5],
  [33, 0.5, 74, 0.5],
  [33, 1, 77, 1.5],
  [35, 0, 75, 0.5],
  [35, 0.5, 74, 0.5],
  [35, 1, 72, 1.5],
  [37, 0, 74, 0.5],
  [37, 0.5, 74, 0.5],
  [37, 1, 79, 1.5],
];
for (const [b, beat, m, len] of INTRO_FLUTE) flute(secAt(b, beat), len, m, 0.55);
for (const [b, beat, m, len] of B_FLUTE) flute(secAt(b, beat), len, m, 0.62);
for (const [b, beat, m, len] of BREAK_FLUTE) flute(secAt(b, beat), len, m, 0.5);
const A3_FLUTE: [number, number, number][] = [
  [40, 81, 8],
  [42, 79, 8],
  [44, 77, 8],
  [46, 75, 4],
];
for (const [b, m, len] of A3_FLUTE) flute(secAt(b, 0), len, m, 0.6);

// ------------------------------------------------------------- stem mixes ----

console.log("mixing stems...");

function mixStem(parts: [Bus, number][], delayed: Bus | null, drive: number): Bus {
  if (delayed) e.pingPong(delayed, BEAT * 0.75, 0.33, 0.24);
  const sendL = new Float64Array(TOTAL);
  const sendR = new Float64Array(TOTAL);
  for (const [b, send] of parts) {
    for (let i = 0; i < TOTAL; i++) {
      sendL[i]! += b.L[i]! * send;
      sendR[i]! += b.R[i]! * send;
    }
  }
  const wet = e.reverb(sendL, sendR);
  const out = e.bus();
  for (let i = 0; i < TOTAL; i++) {
    let l = wet.L[i]! * 0.9;
    let r = wet.R[i]! * 0.9;
    for (const [b] of parts) {
      l += b.L[i]!;
      r += b.R[i]!;
    }
    out.L[i] = Math.tanh(l * drive) / drive;
    out.R[i] = Math.tanh(r * drive) / drive;
  }
  return out;
}

const calm = mixStem(
  [
    [calmAmb, 0.05],
    [calmPad, 0.2],
    [calmMel, 0.3],
  ],
  calmMel,
  0.9,
);
const pulse = mixStem(
  [
    [pulseDrums, 0.09],
    [pulseBass, 0.05],
  ],
  null,
  1.6,
);
const war = mixStem(
  [
    [warDrums, 0.09],
    [warMusic, 0.13],
    [warLead, 0.22],
  ],
  warLead,
  1.6,
);

// One common scale so NO subset of stems clips: playback sums any combination linearly.
const stems: Record<string, Bus> = { calm, pulse, war };
const names = Object.keys(stems);
let worstPeak = 0;
let worstSet = "";
for (let mask = 1; mask < 8; mask++) {
  const set = names.filter((_, k) => mask & (1 << k));
  let p = 0;
  for (let i = 0; i < TOTAL; i++) {
    let l = 0;
    let r = 0;
    for (const nm of set) {
      l += stems[nm]!.L[i]!;
      r += stems[nm]!.R[i]!;
    }
    p = Math.max(p, Math.abs(l), Math.abs(r));
  }
  if (p > worstPeak) {
    worstPeak = p;
    worstSet = set.join("+");
  }
}
const norm = 0.891 / worstPeak;
console.log(`worst subset ${worstSet} peak ${worstPeak.toFixed(3)} -> norm ${norm.toFixed(3)}`);
for (const nm of names) {
  for (let i = 0; i < TOTAL; i++) {
    stems[nm]!.L[i]! *= norm;
    stems[nm]!.R[i]! *= norm;
  }
}

function report(nm: string, b: Bus): void {
  let p = 0;
  let sumSq = 0;
  for (let i = 0; i < TOTAL; i++) {
    p = Math.max(p, Math.abs(b.L[i]!), Math.abs(b.R[i]!));
    sumSq += b.L[i]! * b.L[i]! + b.R[i]! * b.R[i]!;
  }
  const rms = Math.sqrt(sumSq / (TOTAL * 2));
  console.log(`${nm.padEnd(8)} ${TOTAL} samples  peak ${(20 * Math.log10(p)).toFixed(1)}dBFS  rms ${(20 * Math.log10(rms)).toFixed(1)}dBFS`);
}

const full = e.bus();
for (let i = 0; i < TOTAL; i++) {
  full.L[i] = calm.L[i]! + pulse.L[i]! + war.L[i]!;
  full.R[i] = calm.R[i]! + pulse.R[i]! + war.R[i]!;
}
for (const nm of names) report(nm, stems[nm]!);
report("full", full);

const outDir = process.argv[2];
if (!outDir) throw new Error("usage: bun dim-706-adaptive-music.ts <outDir>");
for (const nm of names) await writeWav(`${outDir}/dim-706-${nm}.wav`, stems[nm]!.L, stems[nm]!.R);
await writeWav(`${outDir}/dim-706-full-mix.wav`, full.L, full.R);
console.log(`wrote ${names.map((n) => `dim-706-${n}.wav`).join(", ")} + dim-706-full-mix.wav to ${outDir}`);

export {};
