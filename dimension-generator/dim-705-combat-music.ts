/**
 * Dimension 705 "The Sundered Crowns" — standalone combat track (control experiment).
 * One track, combat only, no stems, no verticality constraints: mid-track key modulation
 * (D minor -> F minor), violent texture cuts, and bus compression + saturation for glue.
 *
 * Run: bun dimension-generator/dim-705-combat-music.ts
 */

import { createEngine, writeWav, SR, type Bus } from "./dim-706-engine";

const BPM = 152;
const BARS = 48;
const eng = createEngine({ seed: 0x705705, bpm: BPM, bars: BARS });
const { BEAT, TOTAL, mtof, cents, rng, bus, put, secAt } = eng;

// ---------------------------------------------------------------- instruments ----

/** War horn — detuned saws + square sub, pitch scoop, opening filter, optional growl. */
function horn(b: Bus, t: number, durBeats: number, midi: number, vel: number, growl = 0): void {
  const dur = durBeats * BEAT * 0.94;
  const n = Math.round((dur + 0.12) * SR);
  const out = new Float64Array(n);
  const f0 = mtof(midi);
  const dets = [-12, 0, 11];
  const sawPs = dets.map(() => rng());
  let sqP = 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    const scoop = cents(-70 * Math.exp(-dt / 0.05));
    const vib = cents(Math.min(1, Math.max(0, (dt - 0.25) / 0.3)) * 9 * Math.sin(2 * Math.PI * 5.1 * dt));
    let s = 0;
    for (let k = 0; k < dets.length; k++) {
      sawPs[k] = sawPs[k]! + (f0 * scoop * vib * cents(dets[k]!)) / SR;
      s += 2 * (sawPs[k]! - Math.floor(sawPs[k]! + 0.5));
    }
    sqP += (f0 * scoop) / (2 * SR);
    s = s / 3 + (sqP - Math.floor(sqP) < 0.5 ? 0.32 : -0.32);
    const cutoff = dt < 0.04 ? 260 + (1500 + vel * 1500 - 260) * (dt / 0.04) : 950 + (550 + vel * 1500) * Math.exp(-(dt - 0.04) / 0.45);
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
    lp += alpha * (s - lp);
    const gr = 1 - growl * 0.35 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 31 * dt));
    const env = Math.min(1, i / (0.012 * SR)) * (dt < dur ? Math.exp(-dt / 2.5) : Math.exp(-dur / 2.5) * Math.max(0, 1 - (dt - dur) / 0.09));
    out[i] = Math.tanh(2.3 * lp * gr) * env * vel;
  }
  put(b, t, out, midi >= 65 ? 0.16 : -0.14, 0.5);
}

/** Male chant — detuned saw voices through two formant bandpasses ("oh"), slow swell. */
function chant(b: Bus, t: number, durBeats: number, midi: number, vel: number): void {
  const dur = durBeats * BEAT * 0.98;
  const n = Math.round((dur + 0.35) * SR);
  const dets = [-14, -5, 6, 13];
  const f1k = 2 * Math.sin((Math.PI * 520) / SR);
  const f2k = 2 * Math.sin((Math.PI * 880) / SR);
  for (let v = 0; v < dets.length; v++) {
    const out = new Float64Array(n);
    const drift = rng() * 6.28;
    let sawP = rng();
    let lp = 0;
    let lp1 = 0, bp1 = 0, lp2 = 0, bp2 = 0;
    const f0 = mtof(midi) * cents(dets[v]!);
    const alpha = 1 - Math.exp((-2 * Math.PI * 700) / SR);
    for (let i = 0; i < n; i++) {
      const dt = i / SR;
      const wob = cents(7 * Math.sin(2 * Math.PI * 0.35 * dt + drift));
      sawP += (f0 * wob) / SR;
      const saw = 2 * (sawP - Math.floor(sawP + 0.5));
      lp1 += f1k * bp1; const hp1 = saw - lp1 - 0.25 * bp1; bp1 += f1k * hp1;
      lp2 += f2k * bp2; const hp2 = saw - lp2 - 0.3 * bp2; bp2 += f2k * hp2;
      lp += alpha * (saw - lp);
      const env = Math.min(1, dt / 0.28) * (dt < dur ? 1 : Math.max(0, 1 - (dt - dur) / 0.3));
      out[i] = (lp * 0.5 + bp1 * 0.7 + bp2 * 0.35) * env;
    }
    put(b, t, out, (v / (dets.length - 1)) * 1.1 - 0.55, 0.14 * vel);
  }
}

/** Anvil — inharmonic steel partials + highpassed strike burst. */
function anvil(b: Bus, t: number, vel: number, pan = 0.3): void {
  const n = Math.round(1.0 * SR);
  const out = new Float64Array(n);
  const parts = [1187, 2104, 2716, 3323, 4150, 5581];
  const phases = parts.map(() => rng() * 6.28);
  let hp = 0;
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    let s = 0;
    for (let k = 0; k < parts.length; k++) {
      const wob = 1 + 0.0015 * Math.sin(2 * Math.PI * 6 * dt + k);
      s += (Math.sin(2 * Math.PI * parts[k]! * wob * dt + phases[k]!) * Math.exp(-dt / (0.55 / (k * 0.6 + 1)))) / (k * 0.7 + 1);
    }
    const nz = rng() * 2 - 1;
    hp += 0.5 * (nz - hp);
    const strike = (nz - hp) * Math.exp(-dt / 0.006) * 1.4;
    out[i] = Math.tanh(1.4 * (s * 0.55 + strike)) * Math.min(1, i / (0.0008 * SR)) * vel;
  }
  put(b, t, out, pan, 0.3);
}

/** Battle snare — 190Hz body + bandpassed rattle. */
function snare(b: Bus, t: number, vel: number): void {
  const n = Math.round(0.19 * SR);
  const out = new Float64Array(n);
  const fk = 2 * Math.sin((Math.PI * 1650) / SR);
  let phase = 0;
  let lpS = 0, bpS = 0;
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    phase += (2 * Math.PI * 190 * (1 + 0.4 * Math.exp(-dt / 0.01))) / SR;
    const nz = rng() * 2 - 1;
    lpS += fk * bpS; const hpS = nz - lpS - 0.5 * bpS; bpS += fk * hpS;
    const body = Math.sin(phase) * Math.exp(-dt / 0.035) * 0.8;
    const rattle = bpS * Math.exp(-dt / 0.07) * 1.1;
    out[i] = (body + rattle) * Math.min(1, i / (0.0006 * SR)) * vel;
  }
  put(b, t, out, -0.12, 0.5);
}

function roll(b: Bus, t: number, durBeats: number, v0: number, v1: number): void {
  const steps = Math.round(durBeats * 4);
  for (let i = 0; i < steps; i++) {
    const x = i / steps;
    snare(b, t + i * 0.25 * BEAT, (v0 + (v1 - v0) * x) * (i % 2 === 0 ? 1 : 0.72));
  }
}

/** Crash cymbal — long highpassed noise + metallic shimmer partials. */
function crash(b: Bus, t: number, vel: number): void {
  const n = Math.round(1.7 * SR);
  const out = new Float64Array(n);
  const parts = [3170, 4370, 5290, 6480];
  const phases = parts.map(() => rng() * 6.28);
  let hp = 0;
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    const nz = rng() * 2 - 1;
    hp += 0.35 * (nz - hp);
    let sh = 0;
    for (let k = 0; k < parts.length; k++) sh += Math.sin(2 * Math.PI * parts[k]! * dt + phases[k]! + 2.5 * Math.sin(2 * Math.PI * 47 * dt + k)) / (k + 1.5);
    const env = Math.min(1, i / (0.001 * SR)) * Math.exp(-dt / 0.5);
    out[i] = ((nz - hp) * 0.9 + sh * 0.25) * env * vel;
  }
  put(b, t, out, 0.05, 0.3);
}

/** Tremolo strings — rapid 16th re-strikes of the chug voice at a given pitch. */
function tremolo(b: Bus, t: number, durBeats: number, midi: number, vel: number): void {
  const steps = Math.round(durBeats * 4);
  for (let i = 0; i < steps; i++) eng.chug(b, t + i * 0.25 * BEAT, midi, vel * (0.75 + 0.25 * rng()), 0.1);
}

// ------------------------------------------------------------------- buses ----

const drums = bus();
const bassB = bus();
const strB = bus();
const brassB = bus();
const choirB = bus();
const leadB = bus(); // flute doubles / echoes
const metalB = bus(); // anvil, crash, gong, risers

// ------------------------------------------------------------------- theme ----
// The Sundered Crowns motif, D minor with a Phrygian b2 sting (Eb -> D).

type Note = [beat: number, dur: number, midi: number];

const motifCall: Note[] = [
  [0, 0.75, 62], [0.75, 0.25, 62], [1, 0.5, 65], [1.5, 0.5, 67], [2, 1, 69],
  [3, 0.5, 67], [3.5, 0.5, 65],
  [4, 0.75, 65], [4.75, 0.25, 67], [5, 1, 63], [6, 1.5, 62], [7.5, 0.5, 57],
];
const motifAnswer: Note[] = [
  [0, 0.75, 65], [0.75, 0.25, 65], [1, 0.5, 69], [1.5, 0.5, 70], [2, 1, 72],
  [3, 0.5, 70], [3.5, 0.5, 69],
  [4, 0.75, 67], [4.75, 0.25, 69], [5, 1, 61], [6, 2, 62],
];

function playHorn(bar: number, notes: Note[], vel: number, tr = 0, growl = 0): void {
  for (const [bt, dur, m] of notes) horn(brassB, secAt(bar, bt), dur, m + tr, vel, growl);
}

// -------------------------------------------------------------- percussion ----

function battery(bar: number, opts: { taiko?: boolean; gallop?: "half" | "full"; snares?: "back" | "drive"; anvilBeats?: number[]; double?: boolean }): void {
  const t = (beat: number) => secAt(bar, beat);
  if (opts.taiko !== false) {
    eng.taiko(drums, t(0), 0.95);
    eng.taiko(drums, t(2), 0.82);
    if (opts.double) {
      eng.taiko(drums, t(1), 0.72);
      eng.taiko(drums, t(3), 0.72);
    }
  }
  if (opts.gallop) {
    const qs = opts.gallop === "full" ? [0, 1, 2, 3] : [1, 3];
    for (const q of qs) {
      eng.logDrum(drums, t(q + 0.5), 45, 0.5);
      eng.logDrum(drums, t(q + 0.75), 50, 0.62);
    }
  }
  if (opts.snares === "back") {
    snare(drums, t(1), 0.9);
    snare(drums, t(3), 0.92);
    snare(drums, t(0.5), 0.24);
    snare(drums, t(2.5), 0.26);
    snare(drums, t(3.75), 0.3);
  } else if (opts.snares === "drive") {
    for (let e = 0; e < 8; e++) snare(drums, t(e * 0.5), e % 2 === 0 ? (e === 2 || e === 6 ? 0.95 : 0.6) : 0.42);
    snare(drums, t(3.75), 0.5);
  }
  for (const ab of opts.anvilBeats ?? []) anvil(metalB, t(ab), 0.85, ab % 1 === 0 ? 0.25 : -0.3);
}

// ------------------------------------------------------------ bass & chug ----

/** 8th-note bass pulse on a root, accents on beats, b2 passing tone at 8th index 5 when given. */
function bassBar(bar: number, root: number, opts: { b2?: number; lift?: boolean; velMul?: number } = {}): void {
  const vm = opts.velMul ?? 1;
  for (let e = 0; e < 8; e++) {
    let m = root;
    if (opts.b2 !== undefined && e === 5) m = opts.b2;
    if (opts.lift && e === 7) m = root + 12;
    eng.bass(bassB, secAt(bar, e * 0.5), 0.5, m, (e % 2 === 0 ? 0.9 : 0.62) * vm);
  }
}

function chugBar(bar: number, midi: number, opts: { b2?: number; velMul?: number } = {}): void {
  const vm = opts.velMul ?? 1;
  for (let e = 0; e < 8; e++) {
    let m = midi;
    if (opts.b2 !== undefined && e === 5) m = opts.b2;
    eng.chug(strB, secAt(bar, e * 0.5), m, (e % 2 === 0 ? 0.85 : 0.55) * vm);
  }
}

// =================================================================== score ====
// 48 bars @ 152 BPM = 75.8s
//  A1 0-7    theme statement, D minor
//  A2 8-15   theme harmonized, chant enters
//  B  16-23  climbing sequence Bb -> Gm -> Eb -> A(V), counter-line
//  BREAK 24-27  floor drops: drone, chant, anvil tolls, flute echo
//  BUILD 28-31  C pedal (V of Fm), rolls + riser — key pivot
//  C  32-43  climax in F minor (motif +3), double-time, Neapolitan Gb hammer
//  OUT 44-47 Fm -> Eb7 -> A7 turnaround, fill into the loop (back to Dm)

// --- A1 + A2 harmony: per-bar [bassRoot, chugMidi, b2?] -----------------------
const aChords: Array<[number, number, boolean]> = [
  [38, 50, true], [38, 50, false], [34, 46, false], [36, 48, false],
  [38, 50, true], [39, 51, false], [33, 45, false], [38, 50, false],
];

for (let rep = 0; rep < 2; rep++) {
  const base = rep * 8;
  for (let i = 0; i < 8; i++) {
    const bar = base + i;
    const [root, mid, hasB2] = aChords[i]!;
    bassBar(bar, root, { b2: hasB2 ? root + 1 : undefined, lift: i === 3 || i === 7 });
    chugBar(bar, mid, { b2: hasB2 ? mid + 1 : undefined, velMul: rep === 0 ? 0.9 : 1 });
    battery(bar, {
      gallop: "half",
      snares: "back",
      anvilBeats: i % 2 === 1 ? [1.5] : [],
      double: rep === 1 && i >= 4,
    });
  }
  // theme
  playHorn(base + 0, motifCall, rep === 0 ? 0.8 : 0.85);
  playHorn(base + 4, motifAnswer, rep === 0 ? 0.8 : 0.85);
  if (rep === 1) {
    playHorn(base + 0, motifCall, 0.5, -12);
    playHorn(base + 4, motifAnswer, 0.5, -12);
    playHorn(base + 0, motifCall, 0.42, 7);
    playHorn(base + 4, motifAnswer, 0.42, 7);
    // chant sings the roots underneath
    for (let i = 0; i < 8; i += 2) {
      const r = aChords[i]![0] + 12;
      chant(choirB, secAt(base + i, 0), 8, r, 0.5);
      chant(choirB, secAt(base + i, 0), 8, r + 7, 0.38);
    }
  }
}
crash(metalB, 0, 0.9);
crash(metalB, secAt(8, 0), 0.75);
// pickup fill into B
roll(drums, secAt(15, 3), 1, 0.35, 0.85);

// --- B: climbing sequence -----------------------------------------------------
const bChords: Array<[number, number]> = [
  [34, 46], [34, 46], [31, 43], [31, 43], [39, 51], [39, 51], [33, 45], [33, 45],
];
for (let i = 0; i < 8; i++) {
  const bar = 16 + i;
  const [root, mid] = bChords[i]!;
  bassBar(bar, root, { lift: i % 2 === 1 });
  chugBar(bar, mid, { velMul: 0.95 });
  battery(bar, { gallop: i >= 4 ? "full" : "half", snares: "back", anvilBeats: [3.5], double: i >= 4 });
}
crash(metalB, secAt(16, 0), 0.7);

const bFigure = (bar: number, a: number, bn: number, c: number, d: number, e: number, f: number, g: number): void => {
  const notes: Note[] = [[0, 0.75, a], [0.75, 0.25, a], [1, 0.5, bn], [1.5, 0.5, c], [2, 2, d], [4, 1, e], [5, 1, f], [6, 2, g]];
  for (const [bt, dur, m] of notes) {
    horn(brassB, secAt(bar, bt), dur, m, 0.82);
    eng.flute(leadB, secAt(bar, bt), dur, m + 12, 0.4);
  }
};
bFigure(16, 65, 70, 72, 74, 72, 70, 74);
bFigure(18, 67, 70, 74, 75, 74, 70, 72);
bFigure(20, 70, 75, 77, 79, 77, 75, 77);
// dominant bars: long tension tones + roll
horn(brassB, secAt(22, 0), 2, 76, 0.88);
horn(brassB, secAt(22, 2), 2, 77, 0.9);
horn(brassB, secAt(23, 0), 2, 76, 0.9, 0.6);
horn(brassB, secAt(23, 2), 2, 73, 0.92, 0.8);
eng.flute(leadB, secAt(22, 0), 4, 88, 0.35);
eng.flute(leadB, secAt(23, 0), 4, 85, 0.38);
roll(drums, secAt(23, 2), 2, 0.3, 0.95);

// --- BREAK: the field goes quiet ----------------------------------------------
eng.gong(metalB, secAt(24, 0), 0.95, 73.4); // gong on D
eng.drone(choirB, secAt(24, 0), 16, 38, 1.0);
chant(choirB, secAt(24, 0), 8, 50, 0.7);
chant(choirB, secAt(24, 0), 8, 57, 0.5);
chant(choirB, secAt(26, 0), 8, 50, 0.65);
chant(choirB, secAt(26, 0), 8, 56, 0.55); // G# against D: tritone unease before the build
for (let i = 0; i < 4; i++) {
  eng.taiko(drums, secAt(24 + i, 0), 0.55 - i * 0.05, 0.85);
  anvil(metalB, secAt(24 + i, 2), 0.6, i % 2 === 0 ? 0.4 : -0.4); // tolling steel
}
// flute remembers the motif, far away
const echo: Note[] = [[0, 0.75, 74], [0.75, 0.25, 74], [1, 0.5, 77], [1.5, 0.5, 79], [2, 2, 81]];
for (const [bt, dur, m] of echo) eng.flute(leadB, secAt(25, bt), dur, m, 0.42);

// --- BUILD on C (V of F minor): the pivot -------------------------------------
for (let i = 0; i < 4; i++) {
  const bar = 28 + i;
  const vm = 0.55 + i * 0.15;
  bassBar(bar, 36, { velMul: vm, lift: i === 3 });
  chugBar(bar, 48, { velMul: vm });
  eng.taiko(drums, secAt(bar, 0), 0.6 + i * 0.1);
  eng.taiko(drums, secAt(bar, 2), 0.6 + i * 0.1);
  if (i >= 2) battery(bar, { taiko: false, gallop: "full", snares: undefined });
}
horn(brassB, secAt(28, 0), 4, 67, 0.6);
horn(brassB, secAt(29, 0), 4, 69, 0.68);
horn(brassB, secAt(30, 0), 4, 70, 0.78, 0.4);
horn(brassB, secAt(31, 0), 4, 72, 0.88, 0.8);
chant(choirB, secAt(30, 0), 8, 48, 0.6);
chant(choirB, secAt(30, 0), 8, 55, 0.5);
roll(drums, secAt(30, 0), 8, 0.2, 1.0);
eng.riser(metalB, secAt(30, 0), 8, 1.0);

// --- CLIMAX in F minor: the war fully unchained --------------------------------
crash(metalB, secAt(32, 0), 1.0);
eng.gong(metalB, secAt(32, 0), 0.8, 87.3); // gong on F
eng.taiko(drums, secAt(32, 0), 1.0, 0.7); // sub-boom

const cChords: Array<[number, number, boolean]> = [
  [41, 53, true], [41, 53, false], [37, 49, false], [39, 51, false],
  [41, 53, true], [41, 53, false], [37, 49, false], [36, 48, false],
];
for (let i = 0; i < 8; i++) {
  const bar = 32 + i;
  const [root, mid, hasB2] = cChords[i]!;
  bassBar(bar, root, { b2: hasB2 ? root + 1 : undefined, lift: i === 7 });
  chugBar(bar, mid, { b2: hasB2 ? mid + 1 : undefined, velMul: 1.05 });
  battery(bar, {
    gallop: "full",
    snares: i >= 4 ? "drive" : "back",
    anvilBeats: [0.5, 2.5],
    double: true,
  });
}
// motif transposed +3 into F minor, growling and harmonized
playHorn(32, motifCall, 1.0, 3, 0.8);
playHorn(36, motifAnswer, 1.0, 3, 0.8);
playHorn(32, motifCall, 0.6, 3 - 12, 0.5);
playHorn(36, motifAnswer, 0.6, 3 - 12, 0.5);
playHorn(36, motifAnswer, 0.5, 3 + 7, 0.6);
crash(metalB, secAt(36, 0), 0.8);
chant(choirB, secAt(34, 0), 8, 53, 0.55);
chant(choirB, secAt(34, 0), 8, 60, 0.4);

// bars 40-43: Neapolitan hammer — Fm vs Gb major over max battery
crash(metalB, secAt(40, 0), 0.9);
const hammer: Array<[number, number, number]> = [
  [40, 41, 53], [41, 42, 54], [42, 41, 53], [43, 42, 54],
];
for (const [bar, root, mid] of hammer) {
  bassBar(bar, root, { velMul: 1.05 });
  battery(bar, { gallop: "full", snares: "drive", anvilBeats: [0.5, 1.5, 2.5], double: true });
  // dotted low horn blasts
  horn(brassB, secAt(bar, 0), 0.75, root, 1.0, 1);
  horn(brassB, secAt(bar, 0.75), 0.25, root, 0.8, 1);
  horn(brassB, secAt(bar, 1), 1, root + 7, 0.95, 1);
  horn(brassB, secAt(bar, 2), 2, root + 12, 1.0, 1);
  tremolo(strB, secAt(bar, 0), 4, mid + 12, 0.8);
  tremolo(strB, secAt(bar, 0), 4, mid + 19, 0.6);
}
chant(choirB, secAt(40, 0), 16, 53, 0.65);
chant(choirB, secAt(40, 0), 16, 60, 0.5);
roll(drums, secAt(43, 2), 2, 0.4, 1.0);

// --- OUTRO: Fm -> Eb7 -> A7 turnaround, fall back toward D ----------------------
crash(metalB, secAt(44, 0), 0.7);
bassBar(44, 41, { velMul: 0.95 });
chugBar(44, 53, { velMul: 0.9 });
battery(44, { gallop: "half", snares: "back", anvilBeats: [1.5] });
horn(brassB, secAt(44, 0), 1, 68, 0.85);
horn(brassB, secAt(44, 1), 1, 65, 0.8);
horn(brassB, secAt(44, 2), 2, 60, 0.82);

bassBar(45, 39, { velMul: 0.95 });
chugBar(45, 51, { velMul: 0.9 });
battery(45, { gallop: "half", snares: "back", anvilBeats: [3.5] });
horn(brassB, secAt(45, 0), 1, 67, 0.82);
horn(brassB, secAt(45, 1), 1, 65, 0.78);
horn(brassB, secAt(45, 2), 2, 63, 0.8);

// A7 dominant: two bars of gathering charge aimed at the loop point
for (const bar of [46, 47]) {
  bassBar(bar, 33, { velMul: 1.0, lift: bar === 47 });
  chugBar(bar, 45, { velMul: 0.95 });
  battery(bar, { gallop: "full", snares: bar === 47 ? "drive" : "back", anvilBeats: [2.5], double: bar === 47 });
}
horn(brassB, secAt(46, 0), 8, 57, 0.9, 0.5);
horn(brassB, secAt(46, 0), 8, 61, 0.85, 0.5);
horn(brassB, secAt(46, 0), 8, 64, 0.8, 0.5);
chant(choirB, secAt(46, 0), 8, 45, 0.6);
roll(drums, secAt(47, 0), 4, 0.3, 1.0);
eng.riser(metalB, secAt(47, 0), 4, 0.9);
// last-8th bass C# pushes the loop home to D
eng.bass(bassB, secAt(47, 3.5), 0.5, 37, 0.95);

// =============================================================== mix & master ==

// reverb sends
const send = bus();
for (let i = 0; i < TOTAL; i++) {
  send.L[i] = brassB.L[i]! * 0.3 + choirB.L[i]! * 0.5 + metalB.L[i]! * 0.42 + leadB.L[i]! * 0.45 + drums.L[i]! * 0.1;
  send.R[i] = brassB.R[i]! * 0.3 + choirB.R[i]! * 0.5 + metalB.R[i]! * 0.42 + leadB.R[i]! * 0.45 + drums.R[i]! * 0.1;
}
const wet = eng.reverb(send.L, send.R);
eng.pingPong(leadB, BEAT * 0.75, 0.35, 0.3);

const mixL = new Float64Array(TOTAL);
const mixR = new Float64Array(TOTAL);
for (let i = 0; i < TOTAL; i++) {
  mixL[i] = drums.L[i]! * 1.0 + bassB.L[i]! * 0.9 + strB.L[i]! * 0.85 + brassB.L[i]! * 1.0 + choirB.L[i]! * 0.8 + leadB.L[i]! * 0.6 + metalB.L[i]! * 0.9 + wet.L[i]! * 0.8;
  mixR[i] = drums.R[i]! * 1.0 + bassB.R[i]! * 0.9 + strB.R[i]! * 0.85 + brassB.R[i]! * 1.0 + choirB.R[i]! * 0.8 + leadB.R[i]! * 0.6 + metalB.R[i]! * 0.9 + wet.R[i]! * 0.8;
}

/** Stereo-linked bus compressor; envelope warmed over a full circular pass so gain is loop-continuous. */
function compress(L: Float64Array, R: Float64Array, thDb: number, ratio: number, attMs: number, relMs: number, makeupDb: number): void {
  const th = Math.pow(10, thDb / 20);
  const att = Math.exp(-1 / ((SR * attMs) / 1000));
  const rel = Math.exp(-1 / ((SR * relMs) / 1000));
  const mk = Math.pow(10, makeupDb / 20);
  let env = 0;
  const gains = new Float64Array(TOTAL);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < TOTAL; i++) {
      const x = Math.max(Math.abs(L[i]!), Math.abs(R[i]!));
      const coef = x > env ? att : rel;
      env = coef * env + (1 - coef) * x;
      if (pass === 1) gains[i] = env > th ? Math.pow(env / th, 1 / ratio - 1) : 1;
    }
  }
  for (let i = 0; i < TOTAL; i++) {
    L[i] = L[i]! * gains[i]! * mk;
    R[i] = R[i]! * gains[i]! * mk;
  }
}

compress(mixL, mixR, -11, 3.2, 6, 130, 4);

// bus saturation for glue and weight
const DRIVE = 1.5;
for (let i = 0; i < TOTAL; i++) {
  mixL[i] = Math.tanh(DRIVE * mixL[i]!);
  mixR[i] = Math.tanh(DRIVE * mixR[i]!);
}

// normalize to -0.7 dBFS: Vorbis encoding overshoots ~0.3 dB, keeping the decoded peak under -0.3
let peak = 0;
for (let i = 0; i < TOTAL; i++) peak = Math.max(peak, Math.abs(mixL[i]!), Math.abs(mixR[i]!));
const target = Math.pow(10, -0.85 / 20);
const norm = target / peak;
for (let i = 0; i < TOTAL; i++) {
  mixL[i] = mixL[i]! * norm;
  mixR[i] = mixR[i]! * norm;
}

// ------------------------------------------------------------------- output ----

const OUT_DIR = process.env.OUT_DIR ?? "/tmp/dim705-standalone";
const wavPath = `${OUT_DIR}/dim-705-war-standalone.wav`;
await writeWav(wavPath, mixL, mixR);

// stats
let sumSq = 0;
for (let i = 0; i < TOTAL; i++) sumSq += mixL[i]! * mixL[i]! + mixR[i]! * mixR[i]!;
const rms = Math.sqrt(sumSq / (2 * TOTAL));
const win = Math.round(0.25 * SR);
let minWinRms = Infinity;
for (let w = 0; w + win <= TOTAL; w += win) {
  let s = 0;
  for (let i = w; i < w + win; i++) s += mixL[i]! * mixL[i]! + mixR[i]! * mixR[i]!;
  minWinRms = Math.min(minWinRms, Math.sqrt(s / (2 * win)));
}
const seamL = Math.abs(mixL[0]! - mixL[TOTAL - 1]!);
const seamR = Math.abs(mixR[0]! - mixR[TOTAL - 1]!);
console.log(
  JSON.stringify(
    {
      wav: wavPath,
      durationSec: +(TOTAL / SR).toFixed(3),
      bars: BARS,
      bpm: BPM,
      peakDbfs: +(20 * Math.log10(peak * norm)).toFixed(2),
      rmsDbfs: +(20 * Math.log10(rms)).toFixed(2),
      minWindowRmsDbfs: +(20 * Math.log10(minWinRms)).toFixed(2),
      seamDeltaL: +seamL.toFixed(6),
      seamDeltaR: +seamR.toFixed(6),
    },
    null,
    2,
  ),
);
