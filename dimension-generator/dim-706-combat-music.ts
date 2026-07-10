/**
 * Combat music for dimension 706 "Verdant Colossus" — jungle-swallowed stone-and-sorcery ruins.
 * Score only; the note-by-note PCM synthesis lives in dim-706-engine.ts (seamless loop:
 * note tails wrap-add past the buffer end, effects run two circular passes).
 *
 *   bun dimension-generator/dim-706-combat-music.ts <out.wav>
 *
 * 152 BPM, D phrygian, 48 bars (~75.8s):
 *   bars  0-7   INTRO  war-drum coil: full taiko groove, log drums, low D drone, brass hints
 *   bars  8-15  A1     the Colossus motif on low brass over a string chug
 *   bars 16-23  B      lift: G / Bb / C / Eb rise, flute counter-line, riser
 *   bars 24-31  A2     motif doubled an octave up, drum fills
 *   bars 32-39  BREAK  drums + Eb drone, flute echoes of the motif, rebuild + riser
 *   bars 40-47  A3     everything + descending flute lament; bar 47 turnaround into the loop head
 */

import { createEngine, writeWav, SR } from "./dim-706-engine.js";

const e = createEngine({ seed: 0x2f5d34, bpm: 152, bars: 48 });
const { BEAT, TOTAL, rng, secAt } = e;

const drums = e.bus();
const music = e.bus(); // bass + string chug + drone
const lead = e.bus(); // brass stabs + flute (gets the ping-pong delay)

const taiko = (t: number, vel: number, pitch = 1): void => e.taiko(drums, t, vel, pitch);
const logDrum = (t: number, midi: number, vel: number): void => e.logDrum(drums, t, midi, vel);
const conga = (t: number, vel: number, slap: boolean): void => e.conga(drums, t, vel, slap);
const shaker = (t: number, vel: number): void => e.shaker(drums, t, vel);
const gong = (t: number, vel: number, base?: number): void => e.gong(drums, t, vel, base);
const riser = (t: number, durBeats: number, vel: number): void => e.riser(drums, t, durBeats, vel);
const bass = (t: number, durBeats: number, midi: number, vel: number): void => e.bass(music, t, durBeats, midi, vel);
const chug = (t: number, midi: number, vel: number): void => e.chug(music, t, midi, vel);
const drone = (t: number, durBeats: number, rootMidi: number, vel: number): void => e.drone(music, t, durBeats, rootMidi, vel);
const stab = (t: number, durBeats: number, midi: number, vel: number): void => e.stab(lead, t, durBeats, midi, vel);
const flute = (t: number, durBeats: number, midi: number, vel: number): void => e.flute(lead, t, durBeats, midi, vel);

// ------------------------------------------------------------ the score ----

const D2 = 38;
const D3 = 50;

// The Colossus motif: two bars, phrygian, [beatOffset, lenBeats, semitonesFromRoot].
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

function playMotif(barIdx: number, root: number, vel: number, ending: keyof typeof ENDINGS, octaveDouble: boolean): void {
  for (const [b, len, st] of [...MOTIF, ...ENDINGS[ending]!]) {
    stab(secAt(barIdx, b), len, root + st, vel);
    if (octaveDouble) stab(secAt(barIdx, b), len, root + st + 12, vel * 0.55);
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

function grooveBar(barIdx: number, g: Groove): void {
  const v = g.vel ?? 1;
  const step = (s: number): number => secAt(barIdx, s / 4);
  if (g.taiko === "full") {
    for (const s of [0, 3, 6, 8, 11, 14]) taiko(step(s), (s === 0 || s === 8 ? 1 : 0.72) * v);
  } else if (g.taiko === "sparse") {
    for (const s of [0, 6, 8, 14]) taiko(step(s), (s === 0 ? 0.85 : 0.6) * v);
  }
  if (g.logs) {
    for (const [s, m, lv] of LOG_TEMPLATES[Math.floor(rng() * LOG_TEMPLATES.length)]!) logDrum(step(s), m, lv * v);
  }
  if (g.shaker) {
    for (let s = 0; s < 16; s++) shaker(step(s), (s % 4 === 0 ? 0.6 : s % 2 === 0 ? 0.45 : 0.26) * v);
  }
  if (g.conga === "back") {
    conga(step(4), 0.7 * v, false);
    conga(step(12), 0.85 * v, false);
    if (rng() < 0.5) conga(step(rng() < 0.5 ? 7 : 15), 0.3 * v, true);
  } else if (g.conga === "busy") {
    for (const [s, cv, sl] of [
      [2, 0.5, 1],
      [4, 0.7, 0],
      [7, 0.4, 1],
      [10, 0.5, 1],
      [12, 0.8, 0],
      [15, 0.35, 1],
    ] as const) {
      conga(step(s), cv * v, sl === 1);
    }
  }
  if (g.fill === "light") {
    for (let i = 0; i < 4; i++) logDrum(step(12 + i), [53, 50, 48, 45][i]!, (0.65 + i * 0.07) * v);
  } else if (g.fill === "big") {
    for (let i = 0; i < 8; i++) {
      const s = step(8 + i);
      if (i % 2 === 0) taiko(s, (0.6 + i * 0.05) * v);
      logDrum(s, [45, 48, 50, 53, 50, 53, 55, 57][i]!, (0.55 + i * 0.06) * v);
    }
  }
}

/** One bar of the driving 8th-note bass. Root-only bars use a fifth kick; D bars get the b2/b7 chug. */
function bassBar(barIdx: number, rootMidi: number, phrygian: boolean, vel: number): void {
  const offs = phrygian ? [0, 0, 0, 1, 0, 0, -2, 0] : [0, 0, 0, 0, 7, 0, 0, 0];
  for (let e = 0; e < 8; e++) {
    bass(secAt(barIdx, e * 0.5), 0.42, rootMidi + offs[e]!, (e === 0 ? 1 : 0.8) * vel);
  }
}

function chugBar(barIdx: number, rootMidi: number, vel: number): void {
  for (let e = 0; e < 8; e++) {
    const accent = e === 0 || e === 3 || e === 6 ? 1 : 0.72;
    chug(secAt(barIdx, e * 0.5), rootMidi, accent * vel);
    chug(secAt(barIdx, e * 0.5), rootMidi + 7, accent * vel * 0.7);
  }
}

// ---- INTRO (0-7): the machine patrol winds up ----
gong(0, 0.9);
drone(0, 32, D2, 1);
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
for (const b of [4, 5, 6]) stab(secAt(b, 0), 0.4, D3, 0.5);
stab(secAt(7, 3), 0.45, D3 + 1, 0.55);
stab(secAt(7, 3.5), 0.45, D3 - 2, 0.55);

// ---- A1 (8-15): the motif, stated low ----
for (let b = 8; b < 16; b++) {
  grooveBar(b, { taiko: "full", logs: true, shaker: true, conga: "back", fill: b === 15 ? "big" : b % 4 === 3 ? "light" : undefined });
  bassBar(b, D2, true, 1);
  chugBar(b, D3, 0.8);
}
playMotif(8, D3, 0.78, "A", false);
playMotif(10, D3, 0.78, "B", false);
playMotif(12, D3, 0.82, "A", false);
playMotif(14, D3, 0.85, "rise", false);

// ---- B (16-23): the lift — canopy opens, sorcery hums ----
gong(secAt(16, 0), 0.6);
const B_ROOTS = [43, 43, 46, 46, 48, 48, 51, 51]; // G, G, Bb, Bb, C, C, Eb, Eb — rising under D
for (let i = 0; i < 8; i++) {
  const b = 16 + i;
  grooveBar(b, { taiko: "full", logs: i >= 2, shaker: true, conga: "back", fill: i === 7 ? "big" : i === 3 ? "light" : undefined, vel: 0.92 });
  bassBar(b, B_ROOTS[i]! - 12, false, 0.95);
  chugBar(b, B_ROOTS[i]! + 12, 0.72);
}
for (const b of [17, 19, 21]) stab(secAt(b, 3.5), 0.45, B_ROOTS[b - 16]! + 12, 0.6);
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
for (const [b, beat, m, len] of B_FLUTE) flute(secAt(b, beat), len, m, 0.85);
riser(secAt(22, 0), 8, 0.9);

// ---- A2 (24-31): motif returns, octave-doubled ----
gong(secAt(24, 0), 0.9);
for (let b = 24; b < 32; b++) {
  grooveBar(b, { taiko: "full", logs: true, shaker: true, conga: "back", fill: b === 31 ? "big" : b % 4 === 3 ? "light" : undefined, vel: 1.05 });
  bassBar(b, D2, true, 1.05);
  chugBar(b, D3, 0.9);
}
playMotif(24, D3, 0.9, "A", true);
playMotif(26, D3, 0.9, "B", true);
playMotif(28, D3, 0.95, "A", true);
playMotif(30, D3, 0.95, "rise", true);

// ---- BREAK (32-39): the ruins breathe — Eb pedal, motif ghosts in the delay ----
gong(secAt(32, 0), 0.7, 61.7); // Bb1-ish, darker
drone(secAt(32, 0), 16, D2 + 1, 1.1); // Eb pedal: phrygian dread
drone(secAt(36, 0), 16, D2, 1.1);
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
  else bass(secAt(b, 0), 3.6, D2 + (i < 4 ? 1 : 0), 0.75);
}
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
for (const [b, beat, m, len] of BREAK_FLUTE) flute(secAt(b, beat), len, m, 0.7);
riser(secAt(38, 0), 8, 1);

// ---- A3 (40-47): full weight + flute lament, turnaround into the loop head ----
gong(secAt(40, 0), 0.9);
for (let b = 40; b < 48; b++) {
  grooveBar(b, { taiko: "full", logs: true, shaker: true, conga: "back", fill: b % 4 === 3 && b !== 47 ? "light" : undefined, vel: 1.1 });
  bassBar(b, D2, true, 1.1);
  chugBar(b, D3, 0.95);
}
playMotif(40, D3, 1, "A", true);
playMotif(42, D3, 1, "B", true);
playMotif(44, D3, 1, "A", true);
// Bars 46-47: motif body, then the turnaround — brass climbs A-Bb-C into the downbeat gong.
for (const [b, len, st] of MOTIF) {
  stab(secAt(46, b), len, D3 + st, 1);
  stab(secAt(46, b), len, D3 + st + 12, 0.55);
}
stab(secAt(47, 2), 0.9, D3 + 7, 1);
stab(secAt(47, 3), 0.45, D3 + 8, 1);
stab(secAt(47, 3.5), 0.45, D3 + 10, 1.05);
const A3_FLUTE: [number, number, number][] = [
  [40, 81, 8],
  [42, 79, 8],
  [44, 77, 8],
  [46, 75, 4],
];
for (const [b, m, len] of A3_FLUTE) flute(secAt(b, 0), len, m, 0.75);
// Big fill under the turnaround.
for (let i = 0; i < 8; i++) {
  const s = secAt(47, 2 + i * 0.25);
  if (i % 2 === 0) taiko(s, 0.65 + i * 0.05);
  logDrum(s, [45, 48, 50, 53, 55, 57, 58, 62][i]!, 0.6 + i * 0.05);
}

// ---------------------------------------------------------------- mixdown ----

console.log("mixing...");
e.pingPong(lead, BEAT * 0.75, 0.35, 0.22); // dotted-8th echoes on brass + flute

const sendL = new Float64Array(TOTAL);
const sendR = new Float64Array(TOTAL);
for (let i = 0; i < TOTAL; i++) {
  sendL[i] = drums.L[i]! * 0.09 + music.L[i]! * 0.13 + lead.L[i]! * 0.22;
  sendR[i] = drums.R[i]! * 0.09 + music.R[i]! * 0.13 + lead.R[i]! * 0.22;
}
const wet = e.reverb(sendL, sendR);

const outL = new Float64Array(TOTAL);
const outR = new Float64Array(TOTAL);
for (let i = 0; i < TOTAL; i++) {
  outL[i] = drums.L[i]! + music.L[i]! + lead.L[i]! + wet.L[i]! * 0.9;
  outR[i] = drums.R[i]! + music.R[i]! + lead.R[i]! + wet.R[i]! * 0.9;
}

// Gentle glue saturation, then normalize to -1 dBFS.
let peak = 0;
for (let i = 0; i < TOTAL; i++) {
  outL[i] = Math.tanh(outL[i]! * 0.85);
  outR[i] = Math.tanh(outR[i]! * 0.85);
  peak = Math.max(peak, Math.abs(outL[i]!), Math.abs(outR[i]!));
}
const norm = 0.891 / peak;
let sumSq = 0;
for (let i = 0; i < TOTAL; i++) {
  outL[i] = outL[i]! * norm;
  outR[i] = outR[i]! * norm;
  sumSq += outL[i]! * outL[i]! + outR[i]! * outR[i]!;
}
const rms = Math.sqrt(sumSq / (TOTAL * 2));
console.log(`duration ${(TOTAL / SR).toFixed(3)}s  peak ${(20 * Math.log10(0.891)).toFixed(1)}dBFS  rms ${(20 * Math.log10(rms)).toFixed(1)}dBFS`);

const outPath = process.argv[2];
if (!outPath) throw new Error("usage: bun dim-706-combat-music.ts <out.wav>");
await writeWav(outPath, outL, outR);
console.log(`wrote ${outPath}`);

export {};
